/**
 * OneBot TUI 配置向导
 * openclaw onebot setup
 */
import { cancel as clackCancel, confirm as clackConfirm, isCancel, note as clackNote, outro as clackOutro, select as clackSelect, text as clackText, } from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
const OPENCLAW_HOME = join(homedir(), ".openclaw");
const CONFIG_PATH = join(OPENCLAW_HOME, "openclaw.json");
function guardCancel(v) {
    if (isCancel(v)) {
        clackCancel("已取消。");
        process.exit(0);
    }
    return v;
}
export async function runOneBotSetup() {
    const type = guardCancel(await clackSelect({
        message: "连接类型",
        options: [
            { value: "forward-websocket", label: "forward-websocket（正向，主动连接 OneBot）" },
            { value: "backward-websocket", label: "backward-websocket（反向，OneBot 连接本机）" },
        ],
        initialValue: process.env.ONEBOT_WS_TYPE === "backward-websocket" ? "backward-websocket" : "forward-websocket",
    }));
    const host = guardCancel(await clackText({
        message: "主机地址",
        initialValue: process.env.ONEBOT_WS_HOST || "127.0.0.1",
    }));
    const portStr = guardCancel(await clackText({
        message: "端口",
        initialValue: process.env.ONEBOT_WS_PORT || "3001",
    }));
    const accessToken = guardCancel(await clackText({
        message: "Access Token（可选，留空回车跳过）",
        initialValue: process.env.ONEBOT_WS_ACCESS_TOKEN || "",
    }));
    const renderMarkdownToPlain = guardCancel(await clackConfirm({
        message: "是否将机器人回复中的 Markdown 渲染为纯文本再发送？（去除 **、# 等标记，推荐开启）",
        initialValue: true,
    }));
    const longMessageMode = guardCancel(await clackSelect({
        message: "长消息处理模式（单次回复超过阈值时）：",
        options: [
            { value: "normal", label: "正常发送（分段发送）" },
            { value: "og_image", label: "生成图片发送（需安装 node-html-to-image）" },
            { value: "forward", label: "合并转发发送（发给自己后打包转发）" },
        ],
        initialValue: "normal",
    }));
    const longMessageThreshold = guardCancel(await clackText({
        message: "长消息阈值（字符数，超过则启用上述模式）",
        initialValue: "300",
    }));
    let existing = {};
    if (existsSync(CONFIG_PATH)) {
        try {
            existing = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
        }
        catch { }
    }
    const prevOnebot = (existing.channels || {}).onebot;
    const whitelistInitial = Array.isArray(prevOnebot?.whitelistUserIds)
        ? prevOnebot.whitelistUserIds.join(", ")
        : "";
    const whitelistInput = guardCancel(await clackText({
        message: "白名单 QQ 号（逗号分隔，留空则所有人可回复）",
        initialValue: whitelistInitial,
    }));
    const port = parseInt(String(portStr).trim(), 10);
    if (!Number.isFinite(port)) {
        console.error("端口必须为数字");
        process.exit(1);
    }
    const channels = existing.channels || {};
    const thresholdNum = parseInt(String(longMessageThreshold).trim(), 10);
    const whitelistIds = (String(whitelistInput).trim().split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).map((s) => (/^\d+$/.test(s) ? Number(s) : null)).filter((n) => n != null));
    channels.onebot = {
        ...(channels.onebot || {}),
        type,
        host: String(host).trim(),
        port,
        ...(accessToken?.trim() ? { accessToken: String(accessToken).trim() } : {}),
        enabled: true,
        requireMention: true,
        renderMarkdownToPlain,
        longMessageMode,
        longMessageThreshold: Number.isFinite(thresholdNum) ? thresholdNum : 300,
        ...(whitelistIds.length > 0 ? { whitelistUserIds: whitelistIds } : {}),
    };
    const next = { ...existing, channels };
    writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf-8");
    clackNote(`配置已保存到 ${CONFIG_PATH}`, "完成");
    clackOutro("运行 openclaw gateway restart 使配置生效");
}
