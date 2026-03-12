import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { getOneBotConfig } from "../config.js";
import { sendGroupMsg, sendPrivateMsg } from "../connection.js";
import { resolveVoiceProfile } from "../voice-tts.js";

const _PLUGIN_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const VOICE_STATE_FILE = join(_PLUGIN_ROOT, "voice-state.json");
const VOICE_MODES = new Set(["off", "always", "inbound"]);

function compactVoiceText(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/^@\S+\s*/g, "")
        .replace(/[`"'“”‘’（）()【】\[\]{}<>《》、，,。.!！?？:：;；/\\\-_]+/g, "")
        .replace(/\s+/g, "");
}

function readVoiceState() {
    try {
        if (!existsSync(VOICE_STATE_FILE)) {
            return { sessions: {} };
        }
        const parsed = JSON.parse(readFileSync(VOICE_STATE_FILE, "utf8"));
        const sessions = parsed?.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {};
        return { sessions };
    }
    catch {
        return { sessions: {} };
    }
}

function writeVoiceState(state) {
    const next = {
        sessions: state?.sessions && typeof state.sessions === "object" ? state.sessions : {},
    };
    const tmpPath = `${VOICE_STATE_FILE}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    renameSync(tmpPath, VOICE_STATE_FILE);
}

function normalizeVoiceMode(mode) {
    const normalized = String(mode ?? "").trim().toLowerCase();
    if (normalized === "on" || normalized === "true" || normalized === "always") {
        return "always";
    }
    if (normalized === "auto" || normalized === "inbound" || normalized === "audio") {
        return "inbound";
    }
    if (normalized === "off" || normalized === "false" || normalized === "text" || normalized === "none") {
        return "off";
    }
    return null;
}

function describeVoiceMode(mode) {
    switch (mode) {
        case "always":
            return "始终语音";
        case "inbound":
            return "仅当你发语音时回语音";
        default:
            return "关闭";
    }
}

function formatVoiceProfileLabel(agentId) {
    const profile = resolveVoiceProfile(agentId);
    const provider = String(profile?.provider ?? "edge").trim();
    const voice = String(profile?.referenceId ?? profile?.voiceId ?? profile?.voice ?? "").trim();
    return voice ? `${provider}:${voice}` : provider;
}

function looksLikeVoiceStatusIntent(input) {
    const compact = compactVoiceText(input);
    if (!compact) {
        return false;
    }
    if (compact.includes("语音状态")) {
        return true;
    }
    return compact.includes("会发语音") || compact.includes("用语音聊天吗") || compact.includes("语音回复吗");
}

function looksLikeVoiceInboundIntent(input) {
    const compact = compactVoiceText(input);
    if (!compact || !compact.includes("语音")) {
        return false;
    }
    return compact.includes("只在我发语音时") || compact.includes("我发语音你就") || compact.includes("仅在我发语音时");
}

function looksLikeVoiceOffIntent(input) {
    const compact = compactVoiceText(input);
    if (!compact) {
        return false;
    }
    return compact.includes("别发语音了")
        || compact.includes("不要语音了")
        || compact.includes("关闭语音")
        || compact.includes("关掉语音")
        || compact.includes("恢复文字聊天")
        || compact.includes("改回文字聊天")
        || compact.includes("不用语音了");
}

function looksLikeVoiceOnIntent(input) {
    const compact = compactVoiceText(input);
    if (!compact || !compact.includes("语音")) {
        return false;
    }
    return compact.includes("用语音和我聊天")
        || compact.includes("用语音回复我")
        || compact.includes("都用语音")
        || compact.includes("请用语音")
        || compact.includes("开启语音聊天")
        || compact.includes("开始语音聊天");
}

export function resolveNaturalVoiceCommandText(input) {
    const text = String(input ?? "").trim();
    if (!text || text.startsWith("/")) {
        return null;
    }
    if (looksLikeVoiceStatusIntent(text)) {
        return "/voice status";
    }
    if (looksLikeVoiceInboundIntent(text)) {
        return "/voice inbound";
    }
    if (looksLikeVoiceOffIntent(text)) {
        return "/voice off";
    }
    if (looksLikeVoiceOnIntent(text)) {
        return "/voice on";
    }
    return null;
}

export function getVoiceMode(sessionId) {
    const key = String(sessionId ?? "").trim().toLowerCase();
    if (!key) {
        return "off";
    }
    const state = readVoiceState();
    const mode = normalizeVoiceMode(state.sessions?.[key]);
    return mode && VOICE_MODES.has(mode) ? mode : "off";
}

export function setVoiceMode(sessionId, mode) {
    const key = String(sessionId ?? "").trim().toLowerCase();
    if (!key) {
        return "off";
    }
    const normalized = normalizeVoiceMode(mode) ?? "off";
    const state = readVoiceState();
    if (normalized === "off") {
        delete state.sessions[key];
    }
    else {
        state.sessions[key] = normalized;
    }
    writeVoiceState(state);
    return normalized;
}

function parseVoiceCommand(cmdText) {
    const match = String(cmdText ?? "").trim().match(/^\/voice(?:\s+([^\s]+))?/i);
    if (!match) {
        return null;
    }
    const rawAction = String(match[1] ?? "status").trim().toLowerCase();
    if (!rawAction || rawAction === "status" || rawAction === "show") {
        return "status";
    }
    const mode = normalizeVoiceMode(rawAction);
    if (mode) {
        return mode;
    }
    return "status";
}

async function replyToMessage(api, msg, text) {
    const isGroup = msg.message_type === "group";
    const groupId = msg.group_id;
    const userId = msg.user_id;
    const getConfig = () => getOneBotConfig(api);
    if (isGroup && groupId) {
        await sendGroupMsg(groupId, text, getConfig, msg.message_id);
        return;
    }
    if (userId) {
        await sendPrivateMsg(userId, text, getConfig);
    }
}

export async function handleVoiceChat(api, msg, cmdText, options = {}) {
    const action = parseVoiceCommand(cmdText);
    if (!action) {
        return { handled: false };
    }
    const sessionId = String(options.sessionId ?? "").trim().toLowerCase();
    const agentId = String(options.agentId ?? "").trim() || "life-normal";
    const currentMode = getVoiceMode(sessionId);
    if (action === "status") {
        await replyToMessage(api, msg, [
            `当前会话语音模式：${describeVoiceMode(currentMode)} (${currentMode})`,
            `当前人格音色：${formatVoiceProfileLabel(agentId)}`,
            "",
            "用法：/voice on | /voice off | /voice inbound | /voice status",
        ].join("\n"));
        return { handled: true };
    }
    const nextMode = setVoiceMode(sessionId, action);
    const modeLabel = describeVoiceMode(nextMode);
    const voiceLabel = formatVoiceProfileLabel(agentId);
    const extra = nextMode === "always"
        ? "后续文本回复会优先转成语音发送。"
        : nextMode === "inbound"
            ? "只有当你发语音时，我才会回语音。"
            : "后续恢复普通文字回复。";
    await replyToMessage(api, msg, [
        `已切换当前会话语音模式：${modeLabel} (${nextMode})`,
        `当前人格音色：${voiceLabel}`,
        extra,
    ].join("\n"));
    return { handled: true, mode: nextMode };
}
