/**
 * Agent 工具注册
 * 供 OpenClaw cron 等场景下，AI 调用 OneBot 能力
 */
import WebSocket from "ws";
import { loadScript } from "./load-script.js";
import { getWs, sendPrivateMsg, sendGroupMsg, sendGroupFace, sendPrivateFace, sendGroupMface, sendPrivateMface, sendGroupImage, sendPrivateImage, uploadGroupFile, uploadPrivateFile, getGroupMsgHistory, getGroupInfo, getStrangerInfo, getGroupMemberInfo, getAvatarUrl, deleteMsg, setMsgEmojiLike, getLastSentMessageId, getLastInboundMessageId, getRecentMfaceByIndex, listRecentMface, fetchCustomFace, } from "./connection.js";
import { getRenderMarkdownToPlain } from "./config.js";
import { markdownToPlain } from "./markdown.js";
import { readFileSync } from "fs";
import { join } from "path";
import { getActiveReplyTarget, getFallbackDeliveryTarget, setFallbackDeliveryTarget, resolveTargetForReply } from "./reply-context.js";
const CRON_JOBS_PATH = join(process.env.HOME ?? "/home/hzhang", ".openclaw", "cron", "jobs.json");
/**
 * 从 cron sessionKey 提取 jobId，再从 jobs.json 反查 delivery.to
 * sessionKey 格式: agent:lifeagent:cron:<jobId>:run:<runId>
 */
function resolveCronDeliveryTarget(sessionKey) {
    if (!sessionKey) return null;
    const m = sessionKey.match(/cron:([0-9a-f-]+)/i);
    if (!m) return null;
    const jobId = m[1];
    try {
        const data = JSON.parse(readFileSync(CRON_JOBS_PATH, "utf-8"));
        const job = data.jobs?.find(j => j.id === jobId);
        const to = job?.delivery?.to;
        if (to && job?.delivery?.channel === "onebot") return to;
    } catch { }
    return null;
}
/**
 * 将普通 tool 包装成 factory，从 ctx.sessionKey 中提取 cron delivery.to
 * 作为 fallbackDeliveryTarget，使 onebot 工具在 cron 场景下也能自动解析 target
 */
function wrapToolWithCronFallback(tool) {
    return (ctx) => {
        const cronTarget = resolveCronDeliveryTarget(ctx?.sessionKey);
        if (cronTarget) setFallbackDeliveryTarget(cronTarget);
        return tool;
    };
}

export const onebotClient = {
    sendGroupMsg,
    sendGroupFace,
    sendGroupMface,
    sendGroupImage,
    sendPrivateMsg,
    sendPrivateFace,
    sendPrivateMface,
    sendPrivateImage,
    deleteMsg,
    setMsgEmojiLike,
    getGroupMsgHistory,
    getGroupInfo,
    getStrangerInfo,
    getGroupMemberInfo,
    getAvatarUrl,
};
function parseToolTarget(rawTarget) {
    const fallback = getActiveReplyTarget() ?? getFallbackDeliveryTarget() ?? "";
    const raw = (String(rawTarget ?? "").trim() || fallback);
    const resolved = resolveTargetForReply(raw).replace(/^(onebot|qq|lagrange):/i, "").trim();
    if (!resolved) {
        throw new Error("缺少 target，且当前无活跃会话目标");
    }
    if (/^group:\d+$/i.test(resolved)) {
        return { type: "group", id: parseInt(resolved.slice(6), 10) };
    }
    if (/^user:\d+$/i.test(resolved)) {
        return { type: "user", id: parseInt(resolved.slice(5), 10) };
    }
    if (/^\d+$/.test(resolved)) {
        const active = String(getActiveReplyTarget() ?? "").replace(/^(onebot|qq|lagrange):/i, "").trim().toLowerCase();
        if (active === `group:${resolved}`)
            return { type: "group", id: parseInt(resolved, 10) };
        if (active === `user:${resolved}`)
            return { type: "user", id: parseInt(resolved, 10) };
        throw new Error(`target "${resolved}" 有歧义，请使用 group:${resolved} 或 user:${resolved}`);
    }
    throw new Error(`非法 target: ${rawTarget}`);
}
function normalizeCustomFaceEntry(raw) {
    let value = raw;
    if (typeof value === "string") {
        const s = value.trim();
        if (!s)
            return null;
        if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
            try {
                value = JSON.parse(s);
            }
            catch {
                value = s;
            }
        }
        if (typeof value === "string") {
            return { kind: "image", image: value };
        }
    }
    if (!value || typeof value !== "object")
        return null;
    const emojiId = String(value?.emoji_id ?? value?.emojiId ?? value?.id ?? "").trim();
    const emojiPackageId = String(value?.emoji_package_id ?? value?.emojiPackageId ?? value?.package_id ?? value?.packageId ?? "").trim();
    if (emojiId && emojiPackageId) {
        const key = value?.key == null ? undefined : String(value.key);
        const summary = value?.summary == null ? undefined : String(value.summary);
        return {
            kind: "mface",
            emoji_id: emojiId,
            emoji_package_id: emojiPackageId,
            ...(key ? { key } : {}),
            ...(summary ? { summary } : {}),
        };
    }
    const image = String(value?.url ?? value?.file ?? value?.path ?? "").trim();
    if (image) {
        const summary = value?.summary == null ? undefined : String(value.summary);
        return { kind: "image", image, ...(summary ? { summary } : {}) };
    }
    return null;
}
function resolveMessageIdForDelete(params) {
    const explicit = Number(params?.message_id);
    if (Number.isFinite(explicit) && explicit > 0) {
        return explicit;
    }
    const target = parseToolTarget(params?.target);
    const latestSent = getLastSentMessageId(target.type, target.id);
    if (latestSent && latestSent > 0) {
        return latestSent;
    }
    throw new Error("未提供有效 message_id，且找不到该会话最近一条机器人消息");
}
function resolveMessageIdForEmoji(params) {
    const explicit = Number(params?.message_id);
    if (Number.isFinite(explicit) && explicit > 0) {
        return explicit;
    }
    const target = parseToolTarget(params?.target);
    // 点赞默认优先“最近收到的用户消息”
    const latestInbound = getLastInboundMessageId(target.type, target.id);
    if (latestInbound && latestInbound > 0) {
        return latestInbound;
    }
    const latestSent = getLastSentMessageId(target.type, target.id);
    if (latestSent && latestSent > 0) {
        return latestSent;
    }
    throw new Error("未提供有效 message_id，且找不到该会话最近消息");
}
export function registerTools(api) {
    if (typeof api.registerTool !== "function")
        return;
    // 包装 registerTool：所有 onebot 工具自动注入 cron delivery fallback
    const origRegisterTool = api.registerTool.bind(api);
    const registerTool = (tool) => origRegisterTool(wrapToolWithCronFallback(tool));
    registerTool({
        name: "onebot_send_text",
        description: "通过 OneBot 发送文本消息。target 格式：user:QQ号 或 group:群号；可省略，默认当前会话目标",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "user:123456 或 group:789012" },
                text: { type: "string", description: "要发送的文本" },
            },
            required: ["text"],
        },
        async execute(_id, params) {
            const w = getWs();
            if (!w || w.readyState !== WebSocket.OPEN) {
                return { content: [{ type: "text", text: "OneBot 未连接" }] };
            }
            const cfg = api?.config;
            const textToSend = getRenderMarkdownToPlain(cfg) ? markdownToPlain(params.text) : params.text;
            try {
                const target = parseToolTarget(params.target);
                let messageId;
                if (target.type === "group")
                    messageId = await sendGroupMsg(target.id, textToSend);
                else
                    messageId = await sendPrivateMsg(target.id, textToSend);
                const resultText = messageId != null ? `发送成功，message_id=${messageId}` : "发送成功";
                return { content: [{ type: "text", text: resultText }] };
            }
            catch (e) {
                return { content: [{ type: "text", text: `发送失败: ${e?.message}` }] };
            }
        },
    });
    registerTool({
        name: "onebot_send_image",
        description: "通过 OneBot 发送图片。target 格式：user:QQ号 或 group:群号（可省略，默认当前会话目标）。image 为本地路径(file://)或 URL 或 base64://",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string" },
                image: { type: "string", description: "图片路径或 URL" },
            },
            required: ["image"],
        },
        async execute(_id, params) {
            const w = getWs();
            if (!w || w.readyState !== WebSocket.OPEN) {
                return { content: [{ type: "text", text: "OneBot 未连接" }] };
            }
            try {
                const target = parseToolTarget(params.target);
                let messageId;
                if (target.type === "group")
                    messageId = await sendGroupImage(target.id, params.image);
                else
                    messageId = await sendPrivateImage(target.id, params.image);
                const resultText = messageId != null ? `图片发送成功，message_id=${messageId}` : "图片发送成功";
                return { content: [{ type: "text", text: resultText }] };
            }
            catch (e) {
                return { content: [{ type: "text", text: `发送失败: ${e?.message}` }] };
            }
        },
    });
    registerTool({
        name: "onebot_send_face",
        description: "通过 OneBot 发送 QQ 标准表情（face）。target 可省略，默认当前会话目标；face_id 为 QQ 表情 ID",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "可选，user:QQ号 或 group:群号；省略则用当前会话目标" },
                face_id: { type: "number", description: "QQ 标准表情 ID，例如 14（微笑）" },
            },
            required: ["face_id"],
        },
        async execute(_id, params) {
            const w = getWs();
            if (!w || w.readyState !== WebSocket.OPEN) {
                return { content: [{ type: "text", text: "OneBot 未连接" }] };
            }
            const faceId = Number(params.face_id);
            if (!Number.isFinite(faceId) || faceId < 0) {
                return { content: [{ type: "text", text: "发送失败: 非法 face_id" }] };
            }
            try {
                const target = parseToolTarget(params.target);
                let messageId;
                if (target.type === "group")
                    messageId = await sendGroupFace(target.id, faceId);
                else
                    messageId = await sendPrivateFace(target.id, faceId);
                const resultText = messageId != null ? `表情发送成功，message_id=${messageId}` : "表情发送成功";
                return { content: [{ type: "text", text: resultText }] };
            }
            catch (e) {
                return { content: [{ type: "text", text: `发送失败: ${e?.message}` }] };
            }
        },
    });
    registerTool({
        name: "onebot_send_mface",
        description: "通过 OneBot 发送 QQ 商城/收藏表情（mface）。可直接传 emoji_id+emoji_package_id，或传 index（第几个）从最近记录/官方收藏列表发送",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "可选，user:QQ号 或 group:群号；省略则用当前会话目标" },
                emoji_id: { type: "string", description: "mface 的 emoji_id（字符串）" },
                emoji_package_id: { type: "string", description: "mface 的 emoji_package_id（字符串）" },
                key: { type: "string", description: "可选，mface key" },
                summary: { type: "string", description: "可选，显示摘要" },
                index: { type: "number", description: "可选，第几个收藏表情（1-based）。不传 emoji_id 时使用该索引" },
            },
            required: [],
        },
        async execute(_id, params) {
            const w = getWs();
            if (!w || w.readyState !== WebSocket.OPEN) {
                return { content: [{ type: "text", text: "OneBot 未连接" }] };
            }
            try {
                const target = parseToolTarget(params.target);
                const emojiId = String(params.emoji_id ?? "").trim();
                const emojiPackageId = String(params.emoji_package_id ?? "").trim();
                let mface;
                if (emojiId && emojiPackageId) {
                    mface = {
                        emoji_id: emojiId,
                        emoji_package_id: emojiPackageId,
                        ...(params.key ? { key: String(params.key) } : {}),
                        ...(params.summary ? { summary: String(params.summary) } : {}),
                    };
                }
                else {
                    const idxRaw = params.index == null ? 1 : Number(params.index);
                    if (!Number.isFinite(idxRaw) || idxRaw <= 0) {
                        return { content: [{ type: "text", text: "发送失败: 请提供有效 index（>=1）或 emoji_id+emoji_package_id" }] };
                    }
                    const idx = Math.trunc(idxRaw);
                    const fromCache = getRecentMfaceByIndex(target.type, target.id, idx);
                    if (fromCache) {
                        mface = fromCache;
                    }
                    else {
                        const custom = await fetchCustomFace(Math.max(idx, 30));
                        const normalized = custom
                            .map(normalizeCustomFaceEntry)
                            .filter((it) => it != null);
                        const fromApi = normalized[idx - 1];
                        if (!fromApi) {
                            return { content: [{ type: "text", text: `发送失败: 当前会话缓存和官方收藏列表里都没有第 ${idx} 个表情。` }] };
                        }
                        mface = fromApi;
                    }
                }
                let messageId;
                if (mface.kind === "image") {
                    if (target.type === "group")
                        messageId = await sendGroupImage(target.id, mface.image);
                    else
                        messageId = await sendPrivateImage(target.id, mface.image);
                }
                else {
                    if (target.type === "group")
                        messageId = await sendGroupMface(target.id, mface);
                    else
                        messageId = await sendPrivateMface(target.id, mface);
                }
                const resultText = messageId != null ? `收藏表情发送成功，message_id=${messageId}` : "收藏表情发送成功";
                return { content: [{ type: "text", text: resultText }] };
            }
            catch (e) {
                return { content: [{ type: "text", text: `发送失败: ${e?.message}` }] };
            }
        },
    });
    registerTool({
        name: "onebot_list_recent_mface",
        description: "列出当前会话（或指定 target）最近记录的收藏表情（mface）；若本地缓存为空则尝试读取官方收藏列表",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "可选，user:QQ号 或 group:群号；省略则用当前会话目标" },
                limit: { type: "number", description: "返回条数，默认 10" },
            },
            required: [],
        },
        async execute(_id, params) {
            const w = getWs();
            if (!w || w.readyState !== WebSocket.OPEN) {
                return { content: [{ type: "text", text: "OneBot 未连接" }] };
            }
            try {
                const target = parseToolTarget(params.target);
                const limit = params.limit == null ? 10 : Number(params.limit);
                let list = listRecentMface(target.type, target.id, limit);
                let source = "cache";
                if (list.length === 0) {
                    const custom = await fetchCustomFace(limit == null ? 10 : Math.max(1, Math.trunc(Number(limit) || 10)));
                    list = custom.map(normalizeCustomFaceEntry).filter((it) => it != null);
                    source = "custom_face_api";
                }
                if (list.length === 0) {
                    return { content: [{ type: "text", text: "暂无收藏表情记录（缓存与官方列表都为空）。" }] };
                }
                const lines = list.map((it, i) => {
                    if (it.kind === "image") {
                        return `${i + 1}. type=image, image=${it.image}${it.summary ? `, summary=${it.summary}` : ""}`;
                    }
                    return `${i + 1}. type=mface, emoji_id=${it.emoji_id}, emoji_package_id=${it.emoji_package_id}${it.key ? `, key=${it.key}` : ""}${it.summary ? `, summary=${it.summary}` : ""}`;
                });
                return { content: [{ type: "text", text: `source=${source}\n${lines.join("\n")}` }] };
            }
            catch (e) {
                return { content: [{ type: "text", text: `获取失败: ${e?.message}` }] };
            }
        },
    });
    registerTool({
        name: "onebot_upload_file",
        description: "通过 OneBot 上传文件到群或私聊。target: user:QQ号 或 group:群号（可省略，默认当前会话目标）。file 为本地绝对路径，name 为显示文件名",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string" },
                file: { type: "string" },
                name: { type: "string" },
            },
            required: ["file", "name"],
        },
        async execute(_id, params) {
            const w = getWs();
            if (!w || w.readyState !== WebSocket.OPEN) {
                return { content: [{ type: "text", text: "OneBot 未连接" }] };
            }
            try {
                const target = parseToolTarget(params.target);
                if (target.type === "group")
                    await uploadGroupFile(target.id, params.file, params.name);
                else
                    await uploadPrivateFile(target.id, params.file, params.name);
                return { content: [{ type: "text", text: "文件上传成功" }] };
            }
            catch (e) {
                return { content: [{ type: "text", text: `上传失败: ${e?.message}` }] };
            }
        },
    });
    registerTool({
        name: "onebot_delete_msg",
        description: "撤回一条消息。可传 message_id；若省略则默认撤回当前会话里最近一条机器人消息",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "可选，user:QQ号 或 group:群号；省略则用当前会话目标" },
                message_id: { type: "number", description: "待撤回的消息 ID" },
            },
            required: [],
        },
        async execute(_id, params) {
            const w = getWs();
            if (!w || w.readyState !== WebSocket.OPEN) {
                return { content: [{ type: "text", text: "OneBot 未连接" }] };
            }
            try {
                const messageId = resolveMessageIdForDelete(params);
                await deleteMsg(messageId);
                return { content: [{ type: "text", text: `撤回成功，message_id=${messageId}` }] };
            }
            catch (e) {
                return { content: [{ type: "text", text: `撤回失败: ${e?.message}` }] };
            }
        },
    });
    registerTool({
        name: "onebot_set_msg_emoji_like",
        description: "对一条消息添加/取消表情回应（点赞）。默认 emoji_id=60，is_set=true；message_id 省略时优先使用当前会话最近一条用户消息",
        parameters: {
            type: "object",
            properties: {
                target: { type: "string", description: "可选，user:QQ号 或 group:群号；省略则用当前会话目标" },
                message_id: { type: "number", description: "目标消息 ID" },
                emoji_id: { type: "number", description: "表情 ID，默认 60（点赞）" },
                is_set: { type: "boolean", description: "true 添加，false 取消，默认 true" },
            },
            required: [],
        },
        async execute(_id, params) {
            const w = getWs();
            if (!w || w.readyState !== WebSocket.OPEN) {
                return { content: [{ type: "text", text: "OneBot 未连接" }] };
            }
            const emojiId = params.emoji_id == null ? 60 : Number(params.emoji_id);
            if (!Number.isFinite(emojiId) || emojiId <= 0) {
                return { content: [{ type: "text", text: "设置失败: 非法 emoji_id" }] };
            }
            const isSet = params.is_set == null ? true : Boolean(params.is_set);
            try {
                const messageId = resolveMessageIdForEmoji(params);
                await setMsgEmojiLike(messageId, emojiId, isSet);
                return { content: [{ type: "text", text: isSet ? `点赞成功，message_id=${messageId}` : `已取消点赞，message_id=${messageId}` }] };
            }
            catch (e) {
                return { content: [{ type: "text", text: `设置失败: ${e?.message}` }] };
            }
        },
    });
    registerTool({
        name: "onebot_get_group_msg_history",
        description: "获取群聊历史消息（需 Lagrange.Core，go-cqhttp 可能不支持）。用于定时总结、日报等场景",
        parameters: {
            type: "object",
            properties: {
                group_id: { type: "number", description: "群号" },
                count: { type: "number", description: "获取条数，默认 50" },
                message_seq: { type: "number", description: "可选，起始消息序号" },
                message_id: { type: "number", description: "可选，起始消息 ID" },
            },
            required: ["group_id"],
        },
        async execute(_id, params) {
            const w = getWs();
            if (!w || w.readyState !== WebSocket.OPEN) {
                return { content: [{ type: "text", text: "OneBot 未连接" }] };
            }
            try {
                const msgs = await getGroupMsgHistory(params.group_id, {
                    count: params.count ?? 50,
                    message_seq: params.message_seq,
                    message_id: params.message_id,
                });
                const summary = msgs.map((m) => {
                    const text = typeof m.message === "string" ? m.message : JSON.stringify(m.message);
                    const nick = m.sender?.nickname ?? m.sender?.user_id ?? "?";
                    return `[${new Date(m.time * 1000).toISOString()}] ${nick}: ${text.slice(0, 200)}`;
                });
                return { content: [{ type: "text", text: summary.join("\n") || "无历史消息" }] };
            }
            catch (e) {
                return { content: [{ type: "text", text: `获取失败: ${e?.message}` }] };
            }
        },
    });
    registerTool({
        name: "onebot_run_script",
        description: "执行用户配置的 JS/TS 脚本（.mjs/.ts/.mts），脚本可调用 OneBot API（获取群历史、发图等）。用于定时任务中实现自定义逻辑（如 OG 图片生成、日报汇总）",
        parameters: {
            type: "object",
            properties: {
                scriptPath: { type: "string", description: "脚本路径，相对 process.cwd() 或绝对路径，支持 .mjs/.ts/.mts，如 ./daily-summary.mjs 或 ./daily-summary.ts" },
                groupIds: { type: "array", items: { type: "number" }, description: "要处理的群号列表" },
            },
            required: ["scriptPath"],
        },
        async execute(_id, params) {
            const w = getWs();
            if (!w || w.readyState !== WebSocket.OPEN) {
                return { content: [{ type: "text", text: "OneBot 未连接" }] };
            }
            try {
                const mod = await loadScript(params.scriptPath);
                const fn = mod?.default ?? mod?.run ?? mod?.execute;
                if (typeof fn !== "function") {
                    return { content: [{ type: "text", text: `脚本未导出 default/run/execute 函数` }] };
                }
                const ctx = {
                    onebot: onebotClient,
                    groupIds: params.groupIds ?? [],
                };
                const result = await fn(ctx);
                const out = result != null ? String(result) : "执行完成";
                return { content: [{ type: "text", text: out }] };
            }
            catch (e) {
                return { content: [{ type: "text", text: `脚本执行失败: ${e?.message}` }] };
            }
        },
    });
}
