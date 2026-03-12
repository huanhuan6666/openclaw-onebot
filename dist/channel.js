/**
 * OneBot Channel 插件定义
 * 仿照 openclaw-feishu channel.ts 结构，接入 OneBot v11 协议（QQ/Lagrange.Core/go-cqhttp）
 *
 * 对应 Lagrange.onebot context.ts 的 API：
 * - sendPrivateMsg / sendGroupMsg / sendMsg
 * - sendGroupImage / sendPrivateImage（图片）
 * - deleteMsg / getMsg / getGroupMsgHistory
 * - uploadGroupFile / uploadPrivateFile
 */
import { getOneBotConfig, listAccountIds } from "./config.js";
import { sendTextMessage, sendMediaMessage } from "./send.js";
const meta = {
    id: "onebot",
    label: "OneBot",
    selectionLabel: "OneBot (QQ/Lagrange)",
    docsPath: "/channels/onebot",
    docsLabel: "onebot",
    blurb: "OneBot v11 protocol via WebSocket (go-cqhttp, Lagrange.Core)",
    aliases: ["qq", "lagrange", "cqhttp"],
    order: 85,
};
function normalizeOneBotMessagingTarget(raw) {
    const trimmed = raw?.trim();
    if (!trimmed)
        return undefined;
    return trimmed.replace(/^(onebot|qq|lagrange):/i, "").trim();
}
function parseTarget(to) {
    const t = to.replace(/^(onebot|qq|lagrange):/i, "").trim();
    if (!t)
        return null;
    if (t.startsWith("group:")) {
        const id = parseInt(t.slice(6), 10);
        if (isNaN(id))
            return null;
        return { type: "group", id };
    }
    const rawId = t.replace(/^user:/, "");
    const id = parseInt(rawId, 10);
    if (isNaN(id))
        return null;
    if (rawId === t && !t.includes(":")) {
        return { type: id > 100000000 ? "user" : "group", id };
    }
    return { type: "user", id };
}
export const OneBotChannelPlugin = {
    id: "onebot",
    meta: {
        ...meta,
        id: meta.id,
        label: meta.label,
        selectionLabel: meta.selectionLabel,
        docsPath: meta.docsPath,
        blurb: meta.blurb,
        aliases: meta.aliases,
    },
    capabilities: {
        chatTypes: ["direct", "group"],
        media: true,
        reactions: false,
        threads: false,
        polls: false,
    },
    reload: { configPrefixes: ["channels.onebot"] },
    config: {
        listAccountIds: (cfg) => listAccountIds(cfg),
        resolveAccount: (cfg, accountId) => {
            const id = accountId ?? "default";
            const acc = cfg?.channels?.onebot?.accounts?.[id];
            if (acc)
                return { accountId: id, ...acc };
            const ch = cfg?.channels?.onebot;
            if (ch?.host)
                return { accountId: id, ...ch };
            return { accountId: id };
        },
    },
    groups: {
        resolveRequireMention: () => true,
    },
    messaging: {
        normalizeTarget: normalizeOneBotMessagingTarget,
        targetResolver: {
            looksLikeId: (raw) => {
                const trimmed = raw.trim();
                if (!trimmed)
                    return false;
                return /^group:\d+$/.test(trimmed) || /^user:\d+$/.test(trimmed) || /^\d{6,}$/.test(trimmed);
            },
            hint: "user:<QQ号> 或 group:<群号>",
        },
    },
    outbound: {
        deliveryMode: "direct",
        chunker: (text, limit) => {
            if (!text)
                return [];
            if (limit <= 0 || text.length <= limit)
                return [text];
            const chunks = [];
            let remaining = text;
            while (remaining.length > limit) {
                const window = remaining.slice(0, limit);
                const lastNewline = window.lastIndexOf("\n");
                const lastSpace = window.lastIndexOf(" ");
                let breakIdx = lastNewline > 0 ? lastNewline : lastSpace;
                if (breakIdx <= 0)
                    breakIdx = limit;
                const rawChunk = remaining.slice(0, breakIdx);
                const chunk = rawChunk.trimEnd();
                if (chunk.length > 0)
                    chunks.push(chunk);
                const brokeOnSeparator = breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
                const nextStart = Math.min(remaining.length, breakIdx + (brokeOnSeparator ? 1 : 0));
                remaining = remaining.slice(nextStart).trimStart();
            }
            if (remaining.length)
                chunks.push(remaining);
            return chunks;
        },
        chunkerMode: "text",
        textChunkLimit: 4000,
        resolveTarget: ({ to }) => {
            const t = to?.trim();
            if (!t)
                return { ok: false, error: new Error("OneBot requires --to <user_id|group_id>") };
            return { ok: true, to: t };
        },
        sendText: async ({ to, text, accountId, cfg }) => {
            const api = cfg ? { config: cfg } : globalThis.__onebotApi;
            const config = getOneBotConfig(api, accountId);
            if (!config) {
                return { channel: "onebot", ok: false, messageId: "", error: new Error("OneBot not configured") };
            }
            const getConfig = () => getOneBotConfig(api, accountId);
            try {
                const result = await sendTextMessage(to, text, getConfig, cfg);
                if (!result.ok) {
                    return { channel: "onebot", ok: false, messageId: "", error: new Error(result.error) };
                }
                return { channel: "onebot", ok: true, messageId: result.messageId ?? "" };
            }
            catch (e) {
                return { channel: "onebot", ok: false, messageId: "", error: e instanceof Error ? e : new Error(String(e)) };
            }
        },
        sendMedia: async (params) => {
            const { to, text, accountId, cfg } = params;
            const mediaUrl = params.mediaUrl ?? params.media;
            const api = cfg ? { config: cfg } : globalThis.__onebotApi;
            const config = getOneBotConfig(api, accountId);
            if (!config) {
                return { channel: "onebot", ok: false, messageId: "", error: new Error("OneBot not configured") };
            }
            if (!mediaUrl?.trim()) {
                return { channel: "onebot", ok: false, messageId: "", error: new Error("mediaUrl is required") };
            }
            const getConfig = () => getOneBotConfig(api, accountId);
            try {
                const result = await sendMediaMessage(to, mediaUrl, text, getConfig, cfg, {
                    audioAsVoice: Boolean(params.audioAsVoice),
                    mediaType: params.mediaType,
                });
                if (!result.ok) {
                    return { channel: "onebot", ok: false, messageId: "", error: new Error(result.error) };
                }
                return { channel: "onebot", ok: true, messageId: result.messageId ?? "" };
            }
            catch (e) {
                return { channel: "onebot", ok: false, messageId: "", error: e instanceof Error ? e : new Error(String(e)) };
            }
        },
    },
};
