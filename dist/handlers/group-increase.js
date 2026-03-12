/**
 * 新成员入群欢迎
 *
 * 支持：
 * 1. 简单文本模板（message），占位符：{name}、{userId}、{groupName}、{groupId}、{avatarUrl}
 * 2. 自定义 command：在 cwd 下用系统 shell 执行命令，通过环境变量传入上下文
 *    命令自行负责发送（如调用 openclaw message send），或向 stdout 输出 JSON 行供本 handler 发送
 */
import { sendGroupMsg, sendGroupImage, getStrangerInfo, getGroupMemberInfo, getGroupInfo, getAvatarUrl, } from "../connection.js";
import { getRenderMarkdownToPlain } from "../config.js";
import { markdownToPlain } from "../markdown.js";
import { resolve } from "path";
import { spawn } from "child_process";
async function resolveContext(groupId, userId) {
    const [groupInfo, memberInfo] = await Promise.all([
        getGroupInfo(groupId),
        getGroupMemberInfo(groupId, userId),
    ]);
    const groupName = groupInfo?.group_name ?? String(groupId);
    let userName;
    if (memberInfo) {
        userName = (memberInfo.card || memberInfo.nickname || "").trim() || memberInfo.nickname || String(userId);
    }
    else {
        const stranger = await getStrangerInfo(userId);
        userName = stranger?.nickname?.trim() || String(userId);
    }
    return {
        groupId,
        groupName,
        userId,
        userName,
        avatarUrl: getAvatarUrl(userId),
    };
}
function applyTemplate(template, ctx) {
    return template
        .replace(/\{name\}/g, ctx.userName)
        .replace(/\{userId\}/g, String(ctx.userId))
        .replace(/\{groupName\}/g, ctx.groupName)
        .replace(/\{groupId\}/g, String(ctx.groupId))
        .replace(/\{avatarUrl\}/g, ctx.avatarUrl);
}
function escapeForShell(s) {
    const str = String(s);
    if (process.platform === "win32") {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return '"' + str.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}
function runCommand(command, cwd, args, env) {
    const fullCmd = `${command} --userId ${args.userId} --username ${escapeForShell(args.username)} --groupId ${args.groupId}`;
    return new Promise((resolvePromise) => {
        const isWin = process.platform === "win32";
        const shell = isWin ? "cmd.exe" : "sh";
        const shellArg = isWin ? "/c" : "-c";
        const child = spawn(shell, [shellArg, fullCmd], {
            cwd,
            env: { ...process.env, ...env },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (d) => { stdout += d.toString(); });
        child.stderr?.on("data", (d) => { stderr += d.toString(); });
        child.on("close", (code) => {
            resolvePromise({ stdout, stderr, code });
        });
    });
}
function parseCommandOutput(stdout) {
    const line = stdout.trim().split("\n").pop();
    if (!line)
        return null;
    try {
        const data = JSON.parse(line);
        return {
            text: typeof data.text === "string" ? data.text : undefined,
            imagePath: typeof data.imagePath === "string" ? data.imagePath : undefined,
            imageUrl: typeof data.imageUrl === "string" ? data.imageUrl : undefined,
        };
    }
    catch {
        return null;
    }
}
export async function handleGroupIncrease(api, msg) {
    const cfg = api.config;
    const gi = cfg?.channels?.onebot?.groupIncrease;
    if (!gi?.enabled)
        return;
    const groupId = msg.group_id;
    const userId = msg.user_id;
    let ctx;
    try {
        ctx = await resolveContext(groupId, userId);
    }
    catch (e) {
        api.logger?.error?.(`[onebot] groupIncrease resolveContext failed: ${e?.message}`);
        return;
    }
    let result = {};
    const command = gi?.command?.trim();
    const cwd = gi?.cwd?.trim();
    if (command && cwd) {
        const env = {
            GROUP_ID: String(ctx.groupId),
            GROUP_NAME: ctx.groupName,
            USER_ID: String(ctx.userId),
            USER_NAME: ctx.userName,
            AVATAR_URL: ctx.avatarUrl,
        };
        const args = {
            userId: String(ctx.userId),
            username: ctx.userName,
            groupId: String(ctx.groupId),
        };
        try {
            const { stdout, stderr, code } = await runCommand(command, resolve(cwd), args, env);
            if (stderr)
                api.logger?.warn?.(`[onebot] groupIncrease command stderr: ${stderr}`);
            if (code !== 0)
                api.logger?.warn?.(`[onebot] groupIncrease command exit code: ${code}`);
            const parsed = parseCommandOutput(stdout);
            if (parsed && (parsed.text || parsed.imagePath || parsed.imageUrl)) {
                result = parsed;
            }
        }
        catch (e) {
            api.logger?.error?.(`[onebot] groupIncrease command failed: ${e?.message}`);
        }
    }
    const message = gi?.message;
    if (message?.trim() && !result.text && !command) {
        result.text = applyTemplate(message, ctx);
    }
    let text = (result.text ?? "").trim();
    if (text && getRenderMarkdownToPlain(cfg))
        text = markdownToPlain(text);
    const imagePath = result.imagePath?.trim();
    const imageUrl = result.imageUrl?.trim();
    if (!text && !imagePath && !imageUrl)
        return;
    try {
        if (text)
            await sendGroupMsg(groupId, text);
        if (imagePath) {
            const baseDir = cwd || process.cwd();
            const abs = imagePath.startsWith("file://") || imagePath.startsWith("http://") || imagePath.startsWith("https://")
                ? imagePath
                : resolve(baseDir, imagePath);
            await sendGroupImage(groupId, abs);
        }
        if (imageUrl && !imagePath)
            await sendGroupImage(groupId, imageUrl);
        api.logger?.info?.(`[onebot] sent group welcome to ${groupId} for user ${userId} (${ctx.userName})`);
    }
    catch (e) {
        api.logger?.error?.(`[onebot] group welcome failed: ${e?.message}`);
    }
}
