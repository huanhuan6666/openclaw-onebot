/**
 * 入站消息处理
 */
import { getOneBotConfig } from "../config.js";
import { getRawText, getTextFromSegments, getReplyMessageId, getTextFromMessageContent, getTextFromMessageContentWithoutMedia, getRecordSegments, getImageSegments, isMentioned, } from "../message.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const _HIST_DEBUG_LOG = "/home/hzhang/.openclaw/extensions/openclaw-onebot/history-debug.log";
function _histDebug(msg) { try { fs.appendFileSync(_HIST_DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`); } catch {} }
const _PLUGIN_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const _PROMPT_TAP_DIR = path.join(_PLUGIN_ROOT, "prompt-debug");
const _PROMPT_TAP_JSONL = path.join(_PROMPT_TAP_DIR, "dispatches.jsonl");
function _safeId(value) {
    const normalized = String(value ?? "unknown").trim();
    const safe = normalized.replace(/[^a-zA-Z0-9._-]/g, "_");
    return safe.slice(0, 160) || "unknown";
}
function _sanitizeTapValue(value, seen = new WeakSet()) {
    if (value === null || value === undefined)
        return value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        return value;
    if (typeof value === "bigint")
        return value.toString();
    if (value instanceof Date)
        return value.toISOString();
    if (value instanceof Error)
        return { name: value.name, message: value.message, stack: value.stack };
    if (typeof value === "function")
        return `[Function ${value.name || "anonymous"}]`;
    if (typeof value !== "object")
        return String(value);
    if (seen.has(value))
        return "[Circular]";
    seen.add(value);
    if (Array.isArray(value))
        return value.map((item) => _sanitizeTapValue(item, seen));
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
        out[key] = _sanitizeTapValue(nested, seen);
    }
    return out;
}
function _stringifyTapBody(value) {
    if (typeof value === "string")
        return value;
    if (value === null || value === undefined)
        return "";
    try {
        return JSON.stringify(_sanitizeTapValue(value), null, 2);
    }
    catch {
        return String(value);
    }
}
function _writePromptTap(record) {
    try {
        fs.mkdirSync(_PROMPT_TAP_DIR, { recursive: true });
        const capturedAt = new Date();
        const baseName = `${capturedAt.toISOString().replace(/[:.]/g, "-")}--${_safeId(record?.sessionId)}--${_safeId(record?.messageSid ?? record?.rawMessageId)}`;
        const detailPath = path.join(_PROMPT_TAP_DIR, `${baseName}.json`);
        const detailRecord = {
            capturedAt: capturedAt.toISOString(),
            ..._sanitizeTapValue(record),
        };
        const summaryRecord = {
            capturedAt: detailRecord.capturedAt,
            sessionId: detailRecord.sessionId,
            sessionKey: detailRecord.sessionKey,
            agentId: detailRecord.agentId,
            groupId: detailRecord.groupId,
            userId: detailRecord.userId,
            triggerKind: detailRecord.triggerKind,
            historyCount: detailRecord.historyCount,
            rawMessageText: detailRecord.rawMessageText,
            bodyChars: typeof detailRecord.bodyText === "string" ? detailRecord.bodyText.length : undefined,
            detailPath,
        };
        fs.writeFileSync(detailPath, `${JSON.stringify(detailRecord, null, 2)}\n`, "utf8");
        fs.appendFileSync(_PROMPT_TAP_JSONL, `${JSON.stringify(summaryRecord)}\n`, "utf8");
    }
    catch (error) {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        _histDebug(`PROMPT_TAP_ERROR: ${message}`);
    }
}
import { getGatewayConfig, getRenderMarkdownToPlain, getCollapseDoubleNewlines, getWhitelistUserIds } from "../config.js";
import { markdownToPlain, collapseDoubleNewlines } from "../markdown.js";
import { markdownToImage } from "../og-image.js";
import { sendPrivateMsg, sendGroupMsg, sendPrivateImage, sendGroupImage, sendGroupForwardMsg, sendPrivateForwardMsg, setMsgEmojiLike, setInputStatus, getMsg, rememberLastInboundMessage, rememberRecentMface, } from "../connection.js";
import { setActiveReplyTarget, clearActiveReplyTarget, setActiveReplySessionId, setForwardSuppressDelivery, setActiveReplySelfId, setActiveReplyMessageId, consumeActiveReplyMessageId } from "../reply-context.js";
import { loadPluginSdk, getSdk } from "../sdk.js";
import { handleGroupIncrease } from "./group-increase.js";
import { handleSwitchSoul, resolveNaturalSwitchCommandText, resolveSwitchScopedSessionId } from "./switch-soul.js";
import { handleVoiceChat, resolveNaturalVoiceCommandText, getVoiceMode } from "./voice-chat.js";
import { sendPrivateRecord, sendGroupRecord } from "../connection.js";
import { synthesizeVoiceReply } from "../voice-tts.js";
import { enrichPendingHistoryImageEntries } from "../pending-media-description.js";
const DEFAULT_HISTORY_LIMIT = 20;
const AUDIO_MEDIA_EXT_RE = /\.(amr|silk|mp3|wav|ogg|opus|m4a|aac|flac|webm)(?:$|[?#])/i;
const DEFAULT_VOICE_REPLY_MAX_CHARS = 100;
const PRIVATE_TYPING_PULSE_INTERVAL_MS = 4000;
export const sessionHistories = new Map();
/** forward 模式下待处理的会话，用于定期清理未完成的缓冲 */
const forwardPendingSessions = new Map();
/** 每个 replySessionId 已发送的 chunk 数量，用于支持多次 final（如工具调用后追加内容） */
const lastSentChunkCountBySession = new Map();
const FORWARD_PENDING_TTL_MS = 5 * 60 * 1000; // 5 分钟
const FORWARD_CLEANUP_INTERVAL_MS = 60 * 1000; // 每分钟清理一次
function cleanupForwardPendingSessions() {
    const now = Date.now();
    const toDelete = [];
    for (const [id, ts] of forwardPendingSessions) {
        if (now - ts > FORWARD_PENDING_TTL_MS)
            toDelete.push(id);
    }
    for (const id of toDelete)
        forwardPendingSessions.delete(id);
}
let forwardCleanupTimer = null;
export function startForwardCleanupTimer() {
    if (forwardCleanupTimer)
        return;
    forwardCleanupTimer = setInterval(cleanupForwardPendingSessions, FORWARD_CLEANUP_INTERVAL_MS);
}
/** 群聊活跃插话（模式 C）状态 */
const groupActivityStateByGroupId = new Map();
const GROUP_ACTIVITY_STALE_TTL_MS = 2 * 60 * 60 * 1000;
function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    const base = Number.isFinite(n) ? n : fallback;
    const withMin = min == null ? base : Math.max(min, base);
    return max == null ? withMin : Math.min(max, withMin);
}
function parseNumericIds(values) {
    if (!Array.isArray(values))
        return [];
    return values
        .map((v) => {
        if (typeof v === "number" && Number.isFinite(v))
            return Math.trunc(v);
        if (typeof v === "string" && /^\d+$/.test(v.trim()))
            return Number(v.trim());
        return NaN;
    })
        .filter((v) => Number.isFinite(v));
}
function getGroupActivityInterjectConfig(cfg) {
    const raw = cfg?.channels?.onebot?.activityInterject ?? {};
    return {
        enabled: raw?.enabled === true,
        groupIds: parseNumericIds(raw?.groupIds),
        mentionActivates: raw?.mentionActivates === undefined ? true : Boolean(raw?.mentionActivates),
        heatActivates: raw?.heatActivates === undefined ? true : Boolean(raw?.heatActivates),
        activeWindowMs: clampNumber(raw?.activeWindowMs, 10 * 60 * 1000, 60 * 1000, 60 * 60 * 1000),
        heatWindowMs: clampNumber(raw?.heatWindowMs, 45 * 1000, 10 * 1000, 5 * 60 * 1000),
        heatMessageThreshold: clampNumber(raw?.heatMessageThreshold, 8, 2, 100),
        heatUniqueUsersThreshold: clampNumber(raw?.heatUniqueUsersThreshold, 3, 1, 30),
        minGapMs: clampNumber(raw?.minGapMs, 3 * 60 * 1000, 10 * 1000, 60 * 60 * 1000),
        maxRepliesPerWindow: clampNumber(raw?.maxRepliesPerWindow, 2, 1, 20),
        randomChance: clampNumber(raw?.randomChance, 0.2, 0, 1),
        recentContextSize: clampNumber(raw?.recentContextSize, 8, 3, 30),
        recentContextMaxChars: clampNumber(raw?.recentContextMaxChars, 360, 100, 3000),
        minMessageLength: clampNumber(raw?.minMessageLength, 2, 1, 50),
        debugPrompt: raw?.debugPrompt === true,
        debugPromptMaxChars: clampNumber(raw?.debugPromptMaxChars, 1200, 200, 10000),
        interjectInstruction: typeof raw?.interjectInstruction === "string"
            ? raw.interjectInstruction.trim()
            : "群聊正在热聊。请自然地插一句简短、有价值的话（1-2句，尽量不超过40字），别重复他人原话，不要自称机器人。",
    };
}
function cleanupGroupActivityState(now) {
    const staleBefore = now - GROUP_ACTIVITY_STALE_TTL_MS;
    for (const [groupId, state] of groupActivityStateByGroupId) {
        if ((state.lastSeenAt ?? 0) < staleBefore) {
            groupActivityStateByGroupId.delete(groupId);
        }
    }
}
function getOrCreateGroupActivityState(groupId) {
    const key = String(groupId);
    let state = groupActivityStateByGroupId.get(key);
    if (!state) {
        state = {
            events: [],
            recentMessages: [],
            activeUntil: 0,
            windowStartedAt: 0,
            interjectCountInWindow: 0,
            lastInterjectAt: 0,
            lastSeenAt: 0,
        };
        groupActivityStateByGroupId.set(key, state);
    }
    return state;
}
function observeGroupActivityMessage(state, now, userId, text, cfg) {
    state.lastSeenAt = now;
    state.events.push({ timestamp: now, userId: Number(userId ?? 0) });
    const eventCutoff = now - cfg.heatWindowMs;
    while (state.events.length > 0 && (state.events[0]?.timestamp ?? 0) < eventCutoff) {
        state.events.shift();
    }
    const compactText = String(text ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 140);
    if (compactText) {
        state.recentMessages.push({
            timestamp: now,
            userId: Number(userId ?? 0),
            text: compactText,
        });
    }
    const keepRecent = Math.max(cfg.recentContextSize * 5, 30);
    if (state.recentMessages.length > keepRecent) {
        state.recentMessages.splice(0, state.recentMessages.length - keepRecent);
    }
    if (state.activeUntil > 0 && now > state.activeUntil) {
        state.activeUntil = 0;
        state.windowStartedAt = 0;
        state.interjectCountInWindow = 0;
    }
}
function activateGroupActivityWindow(state, now, cfg) {
    const wasActive = state.activeUntil > now;
    state.activeUntil = now + cfg.activeWindowMs;
    if (!wasActive) {
        state.windowStartedAt = now;
        state.interjectCountInWindow = 0;
    }
    return !wasActive;
}
function maybeActivateByHeat(state, now, cfg) {
    if (!cfg.heatActivates)
        return false;
    if (state.activeUntil > now)
        return false;
    if (state.events.length < cfg.heatMessageThreshold)
        return false;
    const users = new Set(state.events.map((e) => String(e.userId)));
    if (users.size < cfg.heatUniqueUsersThreshold)
        return false;
    activateGroupActivityWindow(state, now, cfg);
    return true;
}
function shouldInterjectByActivity(state, now, messageText, cfg) {
    if (state.activeUntil <= now)
        return false;
    if (state.interjectCountInWindow >= cfg.maxRepliesPerWindow)
        return false;
    if (state.lastInterjectAt > 0 && now - state.lastInterjectAt < cfg.minGapMs)
        return false;
    const compact = String(messageText ?? "").replace(/\s+/g, "").trim();
    if (compact.length < cfg.minMessageLength)
        return false;
    if (/^[\p{P}\p{S}]+$/u.test(compact))
        return false;
    if (Math.random() > cfg.randomChance)
        return false;
    return true;
}
function markActivityInterject(state, now) {
    state.interjectCountInWindow += 1;
    state.lastInterjectAt = now;
}
function buildActivityRecentContext(state, currentUserId, currentText, cfg) {
    const recent = state.recentMessages.slice(-Math.max(cfg.recentContextSize + 4, cfg.recentContextSize));
    const normalizedCurrent = String(currentText ?? "").replace(/\s+/g, " ").trim();
    const lines = [];
    for (const item of recent) {
        if (!item?.text)
            continue;
        if (item.userId === Number(currentUserId) && item.text === normalizedCurrent)
            continue;
        lines.push(`${item.userId}: ${item.text}`);
    }
    const selected = lines.slice(-cfg.recentContextSize);
    let joined = selected.join("\n");
    if (joined.length > cfg.recentContextMaxChars) {
        joined = joined.slice(joined.length - cfg.recentContextMaxChars);
    }
    return joined;
}
function buildActivityInterjectPrompt(messageText, recentContext, cfg) {
    const blocks = [];
    if (recentContext) {
        blocks.push("[群聊最近消息（供参考）]", recentContext);
    }
    blocks.push("[当前消息]", messageText, "[任务]", cfg.interjectInstruction);
    return blocks.join("\n");
}
function buildGroupContinuationAwareBody(body, options) {
    if (typeof body !== "string")
        return body;
    if (!options?.hasRecentHistory)
        return body;
    const blocks = [
        "[群聊规则]",
        "若当前消息简短或像追问，优先承接 recent context；否则直接回答当前消息。",
    ];
    blocks.push("", body);
    return blocks.join("\n");
}
function buildGroupContinuationCurrentMessage(messageText, recentEntries, options) {
    if (!Array.isArray(recentEntries) || recentEntries.length === 0)
        return messageText;
    const blocks = [
        "[承接前文回复]",
        `当前触发你的消息：${messageText}`,
    ];
    if (options?.triggerKind === "mention") {
        blocks.push("触发方式：@你");
    }
    else if (options?.triggerKind === "activity") {
        blocks.push("触发方式：群聊活跃");
    }
    return blocks.join("\n");
}
function isUsableInboundMediaPath(value) {
    const normalized = String(value ?? "").trim();
    if (!normalized)
        return false;
    if (/^[a-zA-Z]:[\\/]/.test(normalized))
        return false;
    return normalized.startsWith("/") || normalized.startsWith("file://");
}
function resolveInboundAudioMedia(msg) {
    const records = getRecordSegments(msg);
    if (!Array.isArray(records) || records.length === 0)
        return [];
    return records
        .map((record) => {
        const url = typeof record?.url === "string" ? record.url.trim() : "";
        const pathValue = typeof record?.path === "string" ? record.path.trim() : (typeof record?.file === "string" ? record.file.trim() : "");
        if (url) {
            return {
                kind: "audio",
                source: "url",
                value: url,
                mime: typeof record?.mime === "string" && record.mime.trim() ? record.mime.trim() : "audio/amr",
                index: Number.isFinite(Number(record?.index)) ? Number(record.index) : 0,
            };
        }
        if (isUsableInboundMediaPath(pathValue)) {
            return {
                kind: "audio",
                source: "path",
                value: pathValue,
                mime: typeof record?.mime === "string" && record.mime.trim() ? record.mime.trim() : "audio/amr",
                index: Number.isFinite(Number(record?.index)) ? Number(record.index) : 0,
            };
        }
        return null;
    })
        .filter((entry) => Boolean(entry?.value));
}
function resolveInboundImageMedia(msg) {
    const images = getImageSegments(msg);
    if (!Array.isArray(images) || images.length === 0)
        return [];
    return images
        .map((image) => {
        const url = typeof image?.url === "string" ? image.url.trim() : "";
        const pathValue = typeof image?.path === "string" ? image.path.trim() : (typeof image?.file === "string" ? image.file.trim() : "");
        if (url) {
            return {
                kind: "image",
                source: "url",
                value: url,
                mime: typeof image?.mime === "string" && image.mime.trim() ? image.mime.trim() : "image/jpeg",
                index: Number.isFinite(Number(image?.index)) ? Number(image.index) : 0,
            };
        }
        if (isUsableInboundMediaPath(pathValue)) {
            return {
                kind: "image",
                source: "path",
                value: pathValue,
                mime: typeof image?.mime === "string" && image.mime.trim() ? image.mime.trim() : "image/jpeg",
                index: Number.isFinite(Number(image?.index)) ? Number(image.index) : 0,
            };
        }
        return null;
    })
        .filter((entry) => Boolean(entry?.value));
}
function appendInboundMediaPlaceholders(text, media) {
    const normalized = String(text ?? "").trim();
    const placeholders = [];
    const audioCount = Number(media?.audioCount ?? 0);
    const imageCount = Number(media?.imageCount ?? 0);
    if (audioCount > 0) {
        placeholders.push(audioCount > 1 ? `<media:audio> (${audioCount} clips)` : "<media:audio>");
    }
    if (imageCount > 0) {
        placeholders.push(imageCount > 1 ? `<media:image> (${imageCount} images)` : "<media:image>");
    }
    if (placeholders.length === 0)
        return normalized;
    return normalized ? `${normalized}\n${placeholders.join("\n")}` : placeholders.join("\n");
}
function getVoiceReplyMaxChars(cfg) {
    const value = Number(cfg?.channels?.onebot?.voiceReplyMaxChars);
    if (Number.isFinite(value) && value > 0) {
        return Math.max(1, Math.trunc(value));
    }
    return DEFAULT_VOICE_REPLY_MAX_CHARS;
}
function countVoiceReplyChars(text) {
    return String(text ?? "")
        .replace(/\s+/g, "")
        .trim().length;
}
function looksLikeAudioMedia(mediaUrl, mediaType) {
    const url = String(mediaUrl ?? "").trim();
    const type = String(mediaType ?? "").trim().toLowerCase();
    if (!url && !type)
        return false;
    if (type.startsWith("audio/"))
        return true;
    return AUDIO_MEDIA_EXT_RE.test(url);
}
export async function processInboundMessage(api, msg) {
    await loadPluginSdk();
    const { buildPendingHistoryContextFromMap, recordPendingHistoryEntry, clearHistoryEntriesIfEnabled } = getSdk();
    const runtime = api.runtime;
    if (!runtime?.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher) {
        api.logger?.warn?.("[onebot] runtime.channel.reply not available");
        return;
    }
    let cfg = getGatewayConfig(api) ?? api.config;
    const config = getOneBotConfig(cfg);
    if (!config) {
        api.logger?.warn?.("[onebot] not configured");
        return;
    }
    const selfId = msg.self_id ?? 0;
    if (msg.user_id != null && Number(msg.user_id) === Number(selfId)) {
        return;
    }
    const inboundImageMedia = resolveInboundImageMedia(msg);
    const inboundAudioMedia = resolveInboundAudioMedia(msg);
    const inboundMedia = [...inboundImageMedia, ...inboundAudioMedia].sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));
    const hasInboundImage = inboundImageMedia.length > 0;
    const hasInboundAudio = inboundAudioMedia.length > 0;
    const replyId = getReplyMessageId(msg);
    let messageText;
    if (replyId != null) {
        const directText = getTextFromMessageContentWithoutMedia(msg.message).trim() || getTextFromSegments(msg).trim();
        const userText = appendInboundMediaPlaceholders(directText || (!hasInboundAudio && !hasInboundImage ? getRawText(msg) : ""), {
            audioCount: inboundAudioMedia.length,
            imageCount: inboundImageMedia.length,
        });
        try {
            const quoted = await getMsg(replyId);
            const quotedText = quoted ? getTextFromMessageContent(quoted.message) : "";
            const senderLabel = quoted?.sender?.nickname ?? quoted?.sender?.user_id ?? "某人";
            messageText = quotedText.trim()
                ? `[引用 ${String(senderLabel)} 的消息：${quotedText.trim()}]\n${userText}`
                : userText;
        }
        catch {
            messageText = userText;
        }
    }
    else {
        const directText = getTextFromMessageContentWithoutMedia(msg.message).trim() || getTextFromSegments(msg).trim();
        messageText = appendInboundMediaPlaceholders(directText || (!hasInboundAudio && !hasInboundImage ? getRawText(msg) : ""), {
            audioCount: inboundAudioMedia.length,
            imageCount: inboundImageMedia.length,
        });
    }
    if (!messageText?.trim()) {
        api.logger?.info?.(`[onebot] ignoring empty message`);
        return;
    }
    const isGroup = msg.message_type === "group";
    const onebotCfg = cfg?.channels?.onebot ?? {};
    const requireMention = onebotCfg?.requireMention ?? true;
    const userId = msg.user_id;
    const groupId = msg.group_id;
    const mentionedInGroup = isGroup ? isMentioned(msg, selfId) : false;
    const senderDisplay = String(msg.sender?.card ?? msg.sender?.nickname ?? userId ?? "未知用户").trim() || String(userId ?? "未知用户");
    const inboundMessageId = Number(msg.message_id);
    if (Number.isFinite(inboundMessageId) && inboundMessageId > 0) {
        if (isGroup && groupId != null) {
            rememberLastInboundMessage("group", Number(groupId), inboundMessageId);
        }
        else if (!isGroup && userId != null) {
            rememberLastInboundMessage("user", Number(userId), inboundMessageId);
        }
    }
    const segments = Array.isArray(msg.message) ? msg.message : [];
    for (const seg of segments) {
        if (seg?.type !== "mface" && seg?.type !== "image")
            continue;
        const data = { ...(seg?.data ?? {}), type: seg?.type };
        if (isGroup && groupId != null) {
            rememberRecentMface("group", Number(groupId), data);
        }
        else if (!isGroup && userId != null) {
            rememberRecentMface("user", Number(userId), data);
        }
    }
    const activityCfg = getGroupActivityInterjectConfig(cfg);
    const now = Date.now();
    let allowByActivityInterject = false;
    const baseSessionId = isGroup
        ? `onebot:group:${groupId}`.toLowerCase()
        : `onebot:${userId}`.toLowerCase();
    const sessionId = resolveSwitchScopedSessionId(baseSessionId);
    const GROUP_HISTORY_LIMIT = 50;
    if (isGroup && activityCfg.enabled && groupId != null) {
        const numericGroupId = Number(groupId);
        const groupAllowed = activityCfg.groupIds.length === 0 || activityCfg.groupIds.includes(numericGroupId);
        if (groupAllowed) {
            cleanupGroupActivityState(now);
            const state = getOrCreateGroupActivityState(numericGroupId);
            observeGroupActivityMessage(state, now, userId, messageText, activityCfg);
            if (mentionedInGroup && activityCfg.mentionActivates) {
                if (activateGroupActivityWindow(state, now, activityCfg)) {
                    api.logger?.info?.(`[onebot] activity window activated by @mention in group ${numericGroupId}`);
                }
            }
            if (!mentionedInGroup && maybeActivateByHeat(state, now, activityCfg)) {
                api.logger?.info?.(`[onebot] activity window activated by heat in group ${numericGroupId}`);
            }
            if (!mentionedInGroup && requireMention && shouldInterjectByActivity(state, now, messageText, activityCfg)) {
                allowByActivityInterject = true;
                markActivityInterject(state, now);
                api.logger?.info?.(`[onebot] activity interject triggered in group ${numericGroupId} (${state.interjectCountInWindow}/${activityCfg.maxRepliesPerWindow})`);
            }
        }
    }
    const shouldDispatchGroup = !isGroup || !requireMention || mentionedInGroup || allowByActivityInterject;
    if (isGroup && !shouldDispatchGroup) {
        if (recordPendingHistoryEntry) {
            const _beforeCount = (sessionHistories.get(sessionId) ?? []).length;
            _histDebug(`RECORD: sessionId=${sessionId}, sender=${senderDisplay}, body=${String(messageText).slice(0, 120)}, beforeCount=${_beforeCount}`);
            recordPendingHistoryEntry({
                historyMap: sessionHistories,
                historyKey: sessionId,
                entry: {
                    sender: senderDisplay,
                    body: messageText,
                    rawBody: messageText,
                    media: {
                        images: inboundImageMedia,
                    },
                    timestamp: Date.now(),
                    messageId: `onebot-${Date.now()}`,
                },
                limit: GROUP_HISTORY_LIMIT,
            });
            const _afterCount = (sessionHistories.get(sessionId) ?? []).length;
            _histDebug(`RECORDED: ${_beforeCount} -> ${_afterCount} entries`);
        }
        api.logger?.info?.(`[onebot] ignoring group message without @mention`);
        return;
    }
    const gi = onebotCfg?.groupIncrease;
    // 测试欢迎：@ 机器人并发送 /group-increase，模拟当前发送者入群，触发欢迎（使用该人的 id、nickname 等）
    // 使用 getTextFromSegments 提取纯文本，避免 raw_message 中 [CQ:at,qq=xxx] 等 CQ 码导致匹配失败
    const cmdText = getTextFromSegments(msg).trim() || getTextFromMessageContent(msg.message).trim() || messageText.trim();
    const switchCmdText = /^\s*\/(?:switch|persona|personas)(?:\s|$)/i.test(cmdText)
        ? cmdText
        : resolveNaturalSwitchCommandText(cmdText) ?? null;
    const voiceCmdText = /^\s*\/voice(?:\s|$)/i.test(cmdText)
        ? cmdText
        : resolveNaturalVoiceCommandText(cmdText) ?? null;
    const groupIncreaseTrigger = isGroup && mentionedInGroup && /^\/group-increase\s*$/i.test(cmdText) && gi?.enabled;
    if (groupIncreaseTrigger) {
        const fakeMsg = {
            post_type: "notice",
            notice_type: "group_increase",
            group_id: msg.group_id,
            user_id: msg.user_id,
        };
        await handleGroupIncrease(api, fakeMsg);
        return;
    }
    // /switch <persona> — 切换 SOUL.md 人格模板（无需 LLM；私聊直达，群聊支持 @ 或活跃插话触发）
    if ((!isGroup || mentionedInGroup || allowByActivityInterject || !requireMention)
        && typeof switchCmdText === "string"
        && /^\s*\/(?:switch|persona|personas)(?:\s|$)/i.test(switchCmdText)) {
        const switchResult = await handleSwitchSoul(api, msg, switchCmdText);
        if (switchResult?.handled) {
            if (switchResult?.nextCfg) {
                cfg = switchResult.nextCfg;
            }
            if (typeof switchResult?.continueWithText === "string" && switchResult.continueWithText.trim()) {
                messageText = switchResult.continueWithText.trim();
            }
            else {
                return;
            }
        }
    }
    const whitelist = getWhitelistUserIds(cfg);
    if (whitelist.length > 0 && !whitelist.includes(Number(userId))) {
        const denyMsg = "权限不足，请向管理员申请权限";
        const getConfig = () => getOneBotConfig(api);
        try {
            if (msg.message_type === "group" && msg.group_id)
                await sendGroupMsg(msg.group_id, denyMsg, getConfig);
            else
                await sendPrivateMsg(userId, denyMsg, getConfig);
        }
        catch (_) { }
        api.logger?.info?.(`[onebot] user ${userId} not in whitelist, denied`);
        return;
    }
    const route = runtime.channel.routing?.resolveAgentRoute?.({
        cfg,
        sessionKey: sessionId,
        channel: "onebot",
        accountId: config.accountId ?? "default",
        peer: isGroup
            ? { kind: "group", id: String(groupId ?? "") }
            : { kind: "direct", id: String(userId ?? "") },
    }) ?? { agentId: "main" };
    if ((!isGroup || mentionedInGroup || allowByActivityInterject || !requireMention)
        && typeof voiceCmdText === "string"
        && /^\s*\/voice(?:\s|$)/i.test(voiceCmdText)) {
        const voiceResult = await handleVoiceChat(api, msg, voiceCmdText, {
            agentId: route.agentId ?? "main",
            sessionId: baseSessionId,
        });
        if (voiceResult?.handled) {
            return;
        }
    }
    const canonicalSessionKey = `agent:${String(route.agentId ?? "main").toLowerCase()}:${sessionId}`.toLowerCase();
    const storePath = runtime.channel.session?.resolveStorePath?.(cfg?.session?.store, {
        agentId: route.agentId,
    }) ?? "";
    const envelopeOptions = runtime.channel.reply?.resolveEnvelopeFormatOptions?.(cfg) ?? {};
    const chatType = isGroup ? "group" : "direct";
    const fromLabel = isGroup ? `group:${groupId}` : senderDisplay;
    const pendingHistoryEntries = isGroup ? (sessionHistories.get(sessionId) ?? []) : [];
    if (isGroup && pendingHistoryEntries.length > 0) {
        await enrichPendingHistoryImageEntries(pendingHistoryEntries, api.logger, {
            maxEntries: 3,
            maxImagesPerEntry: 2,
            maxChars: 240,
            cfg,
            accountId: config.accountId ?? "default",
            channel: "onebot",
            chatType,
            sessionKey: canonicalSessionKey,
            agentId: route.agentId ?? "main",
        });
    }
    const effectiveMessageText = isGroup
        ? buildGroupContinuationCurrentMessage(messageText, pendingHistoryEntries, {
            triggerKind: mentionedInGroup ? "mention" : allowByActivityInterject ? "activity" : "group",
        })
        : messageText;
    const formattedBody = runtime.channel.reply?.formatInboundEnvelope?.({
        channel: "OneBot",
        from: fromLabel,
        timestamp: Date.now(),
        body: effectiveMessageText,
        chatType,
        sender: { name: senderDisplay, id: String(userId) },
        envelope: envelopeOptions,
    }) ?? { content: [{ type: "text", text: effectiveMessageText }] };
    const historyLimit = isGroup ? GROUP_HISTORY_LIMIT : DEFAULT_HISTORY_LIMIT;
    const baseBody = buildPendingHistoryContextFromMap
        ? buildPendingHistoryContextFromMap({
            historyMap: sessionHistories,
            historyKey: sessionId,
            limit: historyLimit,
            currentMessage: formattedBody,
            formatEntry: (entry) => runtime.channel.reply?.formatInboundEnvelope?.({
                channel: "OneBot",
                from: isGroup ? `group:${groupId}` : entry.sender,
                timestamp: entry.timestamp,
                body: entry.body,
                chatType,
                senderLabel: entry.sender,
                envelope: envelopeOptions,
            }) ?? { content: [{ type: "text", text: entry.body }] },
        })
        : formattedBody;
    const groupHistoryCount = pendingHistoryEntries.length;
    const body = isGroup
        ? buildGroupContinuationAwareBody(baseBody, {
            hasRecentHistory: groupHistoryCount > 0,
            triggerKind: mentionedInGroup ? "mention" : allowByActivityInterject ? "activity" : "group",
        })
        : baseBody;
    // 私聊在此记录历史（群聊已在前面统一记录，不重复）
    if (!isGroup && recordPendingHistoryEntry) {
        recordPendingHistoryEntry({
            historyMap: sessionHistories,
            historyKey: sessionId,
            entry: {
                sender: senderDisplay,
                body: messageText,
                timestamp: Date.now(),
                messageId: `onebot-${Date.now()}`,
            },
            limit: DEFAULT_HISTORY_LIMIT,
        });
    }
    // 回复目标（参考 openclaw-feishu）：群聊用 group:群号，私聊用 user:用户号
    // To / OriginatingTo / ConversationLabel 均表示「发送目标」，Agent 的 message 工具会据此选择 target
    const replyTarget = isGroup ? `onebot:group:${groupId}` : `onebot:${userId}`;
    const ctxPayload = {
        Body: body,
        BodyForAgent: body,
        BodyForCommands: messageText,
        RawBody: messageText,
        CommandBody: messageText,
        From: isGroup ? `onebot:group:${groupId}` : `onebot:${userId}`,
        To: replyTarget,
        SessionKey: canonicalSessionKey,
        AccountId: config.accountId ?? "default",
        ChatType: chatType,
        ConversationLabel: replyTarget, // 与 Feishu 一致：表示会话/回复目标，群聊时为 group:群号，非 SenderId
        SenderName: senderDisplay,
        SenderId: String(userId),
        Provider: "onebot",
        Surface: "onebot",
        MessageSid: `onebot-${Date.now()}`,
        Timestamp: Date.now(),
        OriginatingChannel: "onebot",
        OriginatingTo: replyTarget,
        CommandAuthorized: true,
        DeliveryContext: {
            channel: "onebot",
            to: replyTarget,
            accountId: config.accountId ?? "default",
        },
        _onebot: { userId, groupId, isGroup },
    };
    const voiceMode = getVoiceMode(baseSessionId);
    const voiceReplyMaxChars = getVoiceReplyMaxChars(cfg);
    const shouldReplyAsVoice = voiceMode === "always" || (voiceMode === "inbound" && hasInboundAudio);
    const mediaPathEntries = inboundMedia.filter((entry) => entry.source === "path");
    if (inboundMedia.length > 0) {
        ctxPayload.MediaUrls = inboundMedia.map((entry) => entry.value);
        ctxPayload.MediaTypes = inboundMedia.map((entry) => entry.mime);
        ctxPayload.MediaUrl = inboundMedia[0]?.value;
        ctxPayload.MediaType = inboundMedia[0]?.mime;
        if (mediaPathEntries.length > 0) {
            ctxPayload.MediaPaths = mediaPathEntries.map((entry) => entry.value);
            ctxPayload.MediaPath = mediaPathEntries[0]?.value;
        }
    }
    _writePromptTap({
        source: "onebot-dispatch",
        messageType: msg.message_type,
        rawMessageId: msg.message_id,
        messageSid: ctxPayload.MessageSid,
        triggerKind: mentionedInGroup ? "mention" : allowByActivityInterject ? "activity" : isGroup ? "group" : "direct",
        mentionedInGroup,
        allowByActivityInterject,
        isGroup,
        groupId,
        userId,
        senderDisplay,
        sessionId,
        sessionKey: canonicalSessionKey,
        agentId: route.agentId ?? "main",
        replyTarget,
        storePath,
        historyLimit,
        historyCount: pendingHistoryEntries.length,
        voiceMode,
        voiceReplyMaxChars,
        shouldReplyAsVoice,
        inboundImageMedia,
        pendingHistoryEntries,
        inboundMedia,
        inboundAudioMedia,
        rawMessageText: messageText,
        effectiveMessageText,
        formattedBody,
        formattedBodyText: _stringifyTapBody(formattedBody),
        baseBody,
        baseBodyText: _stringifyTapBody(baseBody),
        body,
        bodyText: _stringifyTapBody(body),
        ctxPayload,
    });
    if (runtime.channel.session?.recordInboundSession) {
        await runtime.channel.session.recordInboundSession({
            storePath,
            sessionKey: canonicalSessionKey,
            ctx: ctxPayload,
            updateLastRoute: !isGroup ? { sessionKey: canonicalSessionKey, channel: "onebot", to: String(userId), accountId: config.accountId ?? "default" } : undefined,
            onRecordError: (err) => api.logger?.warn?.(`[onebot] recordInboundSession: ${err}`),
        });
    }
    if (runtime.channel.activity?.record) {
        runtime.channel.activity.record({ channel: "onebot", accountId: config.accountId ?? "default", direction: "inbound" });
    }
    const getConfig = () => getOneBotConfig(api);
    const thinkingEmojiId = onebotCfg.thinkingEmojiId ?? 60;
    const userMessageId = msg.message_id;
    let emojiAdded = false;
    let privateTypingPulseTimer = null;
    let privateTypingStopped = false;
    const clearEmojiReaction = async () => {
        if (emojiAdded && userMessageId != null) {
            try {
                await setMsgEmojiLike(userMessageId, thinkingEmojiId, false);
            }
            catch { }
            emojiAdded = false;
        }
    };
    const stopPrivateTypingIndicator = () => {
        privateTypingStopped = true;
        if (privateTypingPulseTimer) {
            clearInterval(privateTypingPulseTimer);
            privateTypingPulseTimer = null;
        }
    };
    const pulsePrivateTypingIndicator = async () => {
        if (privateTypingStopped || isGroup || !userId)
            return;
        try {
            await setInputStatus(userId, 1, getConfig, api.logger);
        }
        catch (error) {
            stopPrivateTypingIndicator();
            api.logger?.warn?.(`[onebot] set_input_status failed: ${error?.message ?? error}`);
        }
    };
    if (!isGroup && userId) {
        await pulsePrivateTypingIndicator();
        if (!privateTypingStopped) {
            privateTypingPulseTimer = setInterval(() => {
                void pulsePrivateTypingIndicator();
            }, PRIVATE_TYPING_PULSE_INTERVAL_MS);
        }
    }
    if (userMessageId != null) {
        try {
            await setMsgEmojiLike(userMessageId, thinkingEmojiId, true);
            emojiAdded = true;
        }
        catch {
            api.logger?.warn?.("[onebot] setMsgEmojiLike failed (maybe OneBot doesn't support it)");
        }
    }
    // DEBUG: log history state and constructed body
    const _debugHistoryEntries = sessionHistories.get(sessionId);
    _histDebug(`DISPATCH: sessionId=${sessionId}, historyEntries=${_debugHistoryEntries ? _debugHistoryEntries.length : 0}`);
    if (_debugHistoryEntries?.length) {
        for (const _e of _debugHistoryEntries) {
            _histDebug(`  ENTRY: sender=${_e.sender}, body=${String(_e.body).slice(0, 120)}`);
        }
    }
    _histDebug(`BODY (first 800 chars): ${String(body).slice(0, 800)}`);
    api.logger?.info?.(`[onebot] dispatching message for session ${sessionId}`);
    const longMessageMode = onebotCfg.longMessageMode ?? "normal";
    const longMessageThreshold = onebotCfg.longMessageThreshold ?? 300;
    const replySessionId = `onebot-reply-${Date.now()}-${sessionId}`;
    setActiveReplyTarget(replyTarget);
    setActiveReplySessionId(replySessionId);
    setActiveReplySelfId(selfId);
    setActiveReplyMessageId(isGroup && Number.isFinite(Number(userMessageId)) ? Number(userMessageId) : null);
    if (longMessageMode === "forward" && !shouldReplyAsVoice)
        setForwardSuppressDelivery(true);
    const deliveredChunks = [];
    let chunkIndex = 0;
    const onReplySessionEnd = onebotCfg.onReplySessionEnd;
    const doSendChunk = async (effectiveIsGroup, effectiveGroupId, uid, text, mediaUrl, options = {}) => {
        const { audioAsVoice = false, mediaType, sendText = true } = options;
        const isAudioMedia = Boolean(mediaUrl) && (audioAsVoice || looksLikeAudioMedia(mediaUrl, mediaType));
        if (text && sendText) {
            if (effectiveIsGroup && effectiveGroupId)
                await sendGroupMsg(effectiveGroupId, text, getConfig, consumeActiveReplyMessageId());
            else if (uid)
                await sendPrivateMsg(uid, text, getConfig);
        }
        if (mediaUrl) {
            if (isAudioMedia) {
                if (effectiveIsGroup && effectiveGroupId)
                    await sendGroupRecord(effectiveGroupId, mediaUrl, getConfig, null, api.logger);
                else if (uid)
                    await sendPrivateRecord(uid, mediaUrl, getConfig, api.logger);
            }
            else if (effectiveIsGroup && effectiveGroupId) {
                await sendGroupImage(effectiveGroupId, mediaUrl, api.logger, getConfig);
            }
            else if (uid) {
                await sendPrivateImage(uid, mediaUrl, api.logger, getConfig);
            }
        }
    };
    const finishReplySession = async () => {
        lastSentChunkCountBySession.set(replySessionId, deliveredChunks.length);
        if (clearHistoryEntriesIfEnabled) {
            _histDebug(`CLEAR: sessionId=${sessionId}, had ${(sessionHistories.get(sessionId) ?? []).length} entries`);
            clearHistoryEntriesIfEnabled({
                historyMap: sessionHistories,
                historyKey: sessionId,
                limit: historyLimit,
            });
        }
        if (onReplySessionEnd) {
            const ctx = {
                replySessionId,
                sessionId,
                to: replyTarget,
                chunks: deliveredChunks.map(({ index, text: t, mediaUrl: m }) => ({ index, text: t, mediaUrl: m })),
                userMessage: messageText,
            };
            if (typeof onReplySessionEnd === "function") {
                await onReplySessionEnd(ctx);
            }
            else if (typeof onReplySessionEnd === "string" && onReplySessionEnd.trim()) {
                const { loadScript } = await import("../load-script.js");
                const mod = await loadScript(onReplySessionEnd.trim());
                const fn = mod?.default ?? mod?.onReplySessionEnd;
                if (typeof fn === "function")
                    await fn(ctx);
            }
        }
    };
    try {
        await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctxPayload,
            cfg,
            dispatcherOptions: {
                deliver: async (payload, info) => {
                    await clearEmojiReaction();
                    const p = payload;
                    const replyText = typeof p === "string" ? p : (p?.text ?? p?.body ?? "");
                    const mediaUrl = typeof p === "string" ? undefined : (p?.mediaUrl ?? p?.mediaUrls?.[0]);
                    const mediaType = typeof p === "string" ? undefined : (p?.mediaType ?? p?.mediaTypes?.[0]);
                    const audioAsVoice = typeof p === "string" ? false : Boolean(p?.audioAsVoice);
                    const trimmed = (replyText || "").trim();
                    const hasReplyText = Boolean(trimmed) && trimmed !== "NO_REPLY" && !trimmed.endsWith("NO_REPLY");
                    if (!hasReplyText && !mediaUrl && info.kind !== "final")
                        return;
                    stopPrivateTypingIndicator();
                    const { userId: uid, groupId: gid, isGroup: ig } = ctxPayload._onebot || {};
                    const sessionKey = String(ctxPayload.SessionKey ?? sessionId);
                    const groupMatch = sessionKey.match(/^onebot:group:(\d+)$/i);
                    const effectiveIsGroup = groupMatch != null || Boolean(ig);
                    const effectiveGroupId = (groupMatch ? parseInt(groupMatch[1], 10) : undefined) ?? gid;
                    const usePlain = getRenderMarkdownToPlain(cfg);
                    let textPlain = hasReplyText ? (usePlain ? markdownToPlain(trimmed) : trimmed) : "";
                    if (getCollapseDoubleNewlines(cfg))
                        textPlain = collapseDoubleNewlines(textPlain);
                    const mediaIsAudio = Boolean(mediaUrl) && looksLikeAudioMedia(mediaUrl, mediaType);
                    if (hasReplyText || mediaUrl) {
                        deliveredChunks.push({
                            index: chunkIndex++,
                            text: mediaIsAudio && audioAsVoice ? undefined : textPlain || undefined,
                            rawText: mediaIsAudio && audioAsVoice ? undefined : (hasReplyText ? trimmed : undefined),
                            mediaUrl: mediaUrl || undefined,
                            mediaType: mediaType || undefined,
                            audioAsVoice,
                        });
                    }
                    const shouldSendNow = longMessageMode === "normal";
                    if (shouldReplyAsVoice) {
                        try {
                            if (mediaUrl) {
                                await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, "", mediaUrl, {
                                    audioAsVoice,
                                    mediaType,
                                    sendText: false,
                                });
                            }
                            if (info.kind !== "final") {
                                return;
                            }
                            const lastSentCount = lastSentChunkCountBySession.get(replySessionId) ?? 0;
                            const chunksToSend = deliveredChunks.slice(lastSentCount);
                            const voiceText = chunksToSend
                                .map((chunk) => chunk.rawText ?? chunk.text ?? "")
                                .filter(Boolean)
                                .join("\n\n")
                                .trim();
                            if (voiceText) {
                                if (countVoiceReplyChars(voiceText) > voiceReplyMaxChars) {
                                    await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, voiceText);
                                }
                                else {
                                    const ttsResult = await synthesizeVoiceReply({
                                        agentId: route.agentId ?? "main",
                                        cfg,
                                        text: voiceText,
                                        context: {
                                            triggerKind: mentionedInGroup ? "mention" : allowByActivityInterject ? "activity" : effectiveIsGroup ? "group" : "direct",
                                            userMessage: messageText,
                                            recentHistory: pendingHistoryEntries.slice(-4),
                                        },
                                    });
                                    if (ttsResult?.success && ttsResult.audioPath) {
                                        await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, "", ttsResult.audioPath, {
                                            audioAsVoice: true,
                                            mediaType: "audio/mpeg",
                                            sendText: false,
                                        });
                                    }
                                    else {
                                        api.logger?.warn?.(`[onebot] voice reply synthesis failed: ${ttsResult?.error ?? "unknown error"}`);
                                        await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, voiceText);
                                    }
                                }
                            }
                            await finishReplySession();
                        }
                        catch (e) {
                            api.logger?.error?.(`[onebot] voice deliver failed: ${e?.message}`);
                        }
                        return;
                    }
                    // forward 模式且非最后一条：仅暂存，绝不发送，等 final 时再统一处理
                    if (longMessageMode === "forward" && info.kind !== "final") {
                        forwardPendingSessions.set(replySessionId, Date.now());
                        return;
                    }
                    if (info.kind === "final" && longMessageMode === "forward") {
                        forwardPendingSessions.delete(replySessionId);
                    }
                    try {
                        if (shouldSendNow) {
                            await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, textPlain, mediaUrl, {
                                audioAsVoice,
                                mediaType,
                            });
                        }
                        if (info.kind === "final") {
                            const lastSentCount = lastSentChunkCountBySession.get(replySessionId) ?? 0;
                            const chunksToSend = deliveredChunks.slice(lastSentCount);
                            if (chunksToSend.length === 0)
                                return;
                            const totalLen = deliveredChunks.reduce((s, c) => s + (c.rawText ?? c.text ?? "").length, 0);
                            const isLong = totalLen > longMessageThreshold;
                            const isIncremental = lastSentCount > 0;
                            if (isIncremental) {
                                setForwardSuppressDelivery(false);
                                for (const c of chunksToSend) {
                                    if (c.text || c.mediaUrl)
                                        await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, c.text ?? "", c.mediaUrl, {
                                            audioAsVoice: Boolean(c.audioAsVoice),
                                            mediaType: c.mediaType,
                                        });
                                }
                            }
                            else if (!shouldSendNow && (longMessageMode === "og_image" || longMessageMode === "forward")) {
                                if (isLong && longMessageMode === "og_image") {
                                    const fullRaw = deliveredChunks.map((c) => c.rawText ?? c.text ?? "").join("\n\n");
                                    if (fullRaw.trim()) {
                                        try {
                                            const imgUrl = await markdownToImage(fullRaw);
                                            if (imgUrl) {
                                                if (effectiveIsGroup && effectiveGroupId)
                                                    await sendGroupImage(effectiveGroupId, imgUrl, api.logger, getConfig);
                                                else if (uid)
                                                    await sendPrivateImage(uid, imgUrl, api.logger, getConfig);
                                            }
                                            else {
                                                api.logger?.warn?.("[onebot] og_image: node-html-to-image not installed, falling back to normal send");
                                                setForwardSuppressDelivery(false);
                                                for (const c of deliveredChunks) {
                                                    if (c.text || c.mediaUrl)
                                                        await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, c.text ?? "", c.mediaUrl);
                                                }
                                            }
                                        }
                                        catch (e) {
                                            api.logger?.error?.(`[onebot] og_image failed: ${e?.message}`);
                                            setForwardSuppressDelivery(false);
                                            for (const c of deliveredChunks) {
                                                if (c.text || c.mediaUrl)
                                                    await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, c.text ?? "", c.mediaUrl);
                                            }
                                        }
                                    }
                                }
                                else if (isLong && longMessageMode === "forward") {
                                    try {
                                        const nodes = [];
                                        for (const c of deliveredChunks) {
                                            if (c.mediaUrl) {
                                                const mid = await sendPrivateImage(selfId, c.mediaUrl, api.logger, getConfig);
                                                if (mid)
                                                    nodes.push({ type: "node", data: { id: String(mid) } });
                                            }
                                            else if (c.text) {
                                                const mid = await sendPrivateMsg(selfId, c.text, getConfig);
                                                if (mid)
                                                    nodes.push({ type: "node", data: { id: String(mid) } });
                                            }
                                        }
                                        if (nodes.length > 0) {
                                            if (effectiveIsGroup && effectiveGroupId)
                                                await sendGroupForwardMsg(effectiveGroupId, nodes, getConfig);
                                            else if (uid)
                                                await sendPrivateForwardMsg(uid, nodes, getConfig);
                                        }
                                    }
                                    catch (e) {
                                        api.logger?.error?.(`[onebot] forward failed: ${e?.message}`);
                                        setForwardSuppressDelivery(false);
                                        for (const c of deliveredChunks) {
                                            if (c.text || c.mediaUrl)
                                                await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, c.text ?? "", c.mediaUrl);
                                        }
                                    }
                                }
                                else {
                                    setForwardSuppressDelivery(false);
                                    for (const c of deliveredChunks) {
                                        if (c.text || c.mediaUrl)
                                            await doSendChunk(effectiveIsGroup, effectiveGroupId, uid, c.text ?? "", c.mediaUrl, {
                                                audioAsVoice: Boolean(c.audioAsVoice),
                                                mediaType: c.mediaType,
                                            });
                                    }
                                }
                            }
                            await finishReplySession();
                        }
                    }
                    catch (e) {
                        api.logger?.error?.(`[onebot] deliver failed: ${e?.message}`);
                    }
                },
                onError: async (err, info) => {
                    api.logger?.error?.(`[onebot] ${info?.kind} reply failed: ${err}`);
                    stopPrivateTypingIndicator();
                    await clearEmojiReaction();
                },
            },
            replyOptions: { disableBlockStreaming: true },
        });
    }
    catch (err) {
        stopPrivateTypingIndicator();
        await clearEmojiReaction();
        api.logger?.error?.(`[onebot] dispatch failed: ${err?.message}`);
        try {
            const { userId: uid, groupId: gid, isGroup: ig } = ctxPayload._onebot || {};
            if (ig && gid)
                await sendGroupMsg(gid, `处理失败: ${err?.message?.slice(0, 80) || "未知错误"}`);
            else if (uid)
                await sendPrivateMsg(uid, `处理失败: ${err?.message?.slice(0, 80) || "未知错误"}`);
        }
        catch (_) { }
    }
    finally {
        stopPrivateTypingIndicator();
        setForwardSuppressDelivery(false);
        setActiveReplySelfId(null);
        setActiveReplyMessageId(null);
        lastSentChunkCountBySession.delete(replySessionId);
        forwardPendingSessions.delete(replySessionId);
        setActiveReplySessionId(null);
        clearActiveReplyTarget();
    }
}
