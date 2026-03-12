/**
 * OneBot 消息解析
 */
import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
const _PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const _FACE_MAP_FILE = path.join(_PLUGIN_ROOT, "face-map.json");
let _faceMapCache = null;
let _faceMapMtimeMs = -1;
function loadFaceMap() {
    try {
        if (!existsSync(_FACE_MAP_FILE)) {
            _faceMapCache = null;
            _faceMapMtimeMs = -1;
            return null;
        }
        const st = statSync(_FACE_MAP_FILE);
        if (_faceMapCache && st.mtimeMs === _faceMapMtimeMs)
            return _faceMapCache;
        const raw = JSON.parse(readFileSync(_FACE_MAP_FILE, "utf8"));
        const entries = Object.entries(raw && typeof raw === "object" ? raw : {}).map(([id, label]) => [String(id), String(label ?? "").trim()]);
        _faceMapCache = new Map(entries.filter(([, label]) => label));
        _faceMapMtimeMs = st.mtimeMs;
        return _faceMapCache;
    }
    catch {
        return _faceMapCache;
    }
}
function formatFacePlaceholder(idValue) {
    const id = String(idValue ?? "").trim();
    if (!id)
        return "[表情]";
    const label = loadFaceMap()?.get(id);
    return label ? `[表情:${label}(${id})]` : `[表情:${id}]`;
}
function decodeHtmlEntities(value) {
    if (typeof value !== "string")
        return "";
    return value.replace(/&amp;/gi, "&").trim();
}
function extractFileExtension(value) {
    const normalized = decodeHtmlEntities(value);
    if (!normalized)
        return "";
    try {
        const url = new URL(normalized);
        const format = decodeHtmlEntities(url.searchParams.get("format") ?? "");
        if (format)
            return format.replace(/^\./, "").toLowerCase();
        const extFromPath = path.extname(url.pathname ?? "").replace(/^\./, "").toLowerCase();
        if (extFromPath)
            return extFromPath;
    }
    catch { }
    return path.extname(normalized).replace(/^\./, "").toLowerCase();
}
function inferRecordMime(record) {
    const explicit = decodeHtmlEntities(record?.mime ?? record?.content_type ?? "");
    if (explicit)
        return explicit;
    const ext = extractFileExtension(record?.url ?? record?.file ?? record?.path ?? "");
    switch (ext) {
        case "amr":
            return "audio/amr";
        case "silk":
            return "audio/silk";
        case "mp3":
        case "mpeg":
            return "audio/mpeg";
        case "wav":
            return "audio/wav";
        case "ogg":
        case "opus":
            return "audio/ogg";
        case "m4a":
        case "mp4":
            return "audio/mp4";
        case "aac":
            return "audio/aac";
        case "flac":
            return "audio/flac";
        case "webm":
            return "audio/webm";
        default:
            return "audio/amr";
    }
}
function inferImageMime(image) {
    const explicit = decodeHtmlEntities(image?.mime ?? image?.content_type ?? "");
    if (explicit)
        return explicit;
    const ext = extractFileExtension(image?.url ?? image?.file ?? image?.path ?? "");
    switch (ext) {
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "png":
            return "image/png";
        case "gif":
            return "image/gif";
        case "webp":
            return "image/webp";
        case "bmp":
            return "image/bmp";
        case "heic":
        case "heif":
            return "image/heic";
        case "avif":
            return "image/avif";
        default:
            return "image/jpeg";
    }
}
function parseRecordSegmentsFromRawMessage(rawMessage) {
    if (typeof rawMessage !== "string" || !rawMessage.includes("[CQ:record,"))
        return [];
    const matches = [...rawMessage.matchAll(/\[CQ:record,([^\]]+)\]/g)];
    return matches.map((match, index) => {
        const data = {};
        for (const part of String(match[1] ?? "").split(/,(?=[a-zA-Z_][a-zA-Z0-9_]*=)/)) {
            const eqIndex = part.indexOf("=");
            if (eqIndex <= 0)
                continue;
            const key = part.slice(0, eqIndex).trim();
            const value = part.slice(eqIndex + 1).trim();
            data[key] = decodeHtmlEntities(value);
        }
        return {
            url: data.url || undefined,
            file: data.file || undefined,
            path: data.path || undefined,
            mime: inferRecordMime(data),
            index,
        };
    }).filter((entry) => Boolean(entry.url || entry.path || entry.file));
}
function parseImageSegmentsFromRawMessage(rawMessage) {
    if (typeof rawMessage !== "string" || !rawMessage.includes("[CQ:image,"))
        return [];
    const matches = [...rawMessage.matchAll(/\[CQ:image,([^\]]+)\]/g)];
    return matches.map((match, index) => {
        const data = {};
        for (const part of String(match[1] ?? "").split(/,(?=[a-zA-Z_][a-zA-Z0-9_]*=)/)) {
            const eqIndex = part.indexOf("=");
            if (eqIndex <= 0)
                continue;
            const key = part.slice(0, eqIndex).trim();
            const value = part.slice(eqIndex + 1).trim();
            data[key] = decodeHtmlEntities(value);
        }
        return {
            url: data.url || undefined,
            file: data.file || undefined,
            path: data.path || undefined,
            mime: inferImageMime(data),
            index,
        };
    }).filter((entry) => Boolean(entry.url || entry.path || entry.file));
}
/** 从消息段数组中提取引用/回复的消息 ID（OneBot reply 段） */
export function getReplyMessageId(msg) {
    if (!msg?.message || !Array.isArray(msg.message))
        return undefined;
    const replySeg = msg.message.find((m) => m?.type === "reply");
    if (!replySeg?.data)
        return undefined;
    const id = replySeg.data?.id;
    if (id == null)
        return undefined;
    const num = typeof id === "number" ? id : parseInt(String(id), 10);
    return Number.isNaN(num) ? undefined : num;
}
/** 从 get_msg 返回的 message 字段中提取文本和图片链接（供 AI 理解引用内容） */
export function getTextFromMessageContent(content) {
    if (!content)
        return "";
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    const parts = [];
    for (const m of content) {
        const seg = m;
        if (seg?.type === "text") {
            const t = seg.data?.text ?? "";
            if (t)
                parts.push(t);
        }
        else if (seg?.type === "at") {
            const target = seg.data?.qq ?? seg.data?.id ?? "";
            if (target)
                parts.push(`@${target}`);
        }
        else if (seg?.type === "image") {
            const url = seg.data?.url ?? seg.data?.file ?? "";
            parts.push(url ? `[图片: ${url}]` : "[图片]");
        }
        else if (seg?.type === "mface") {
            const summary = seg.data?.summary ?? "";
            parts.push(summary ? `[动画表情: ${summary}]` : "[动画表情]");
        }
        else if (seg?.type === "face") {
            const id = seg.data?.id ?? "";
            parts.push(formatFacePlaceholder(id));
        }
        else if (seg?.type === "file") {
            const name = seg.data?.name ?? seg.data?.file ?? "";
            parts.push(name ? `[文件: ${name}]` : "[文件]");
        }
    }
    return parts.join("");
}
export function getTextFromMessageContentWithoutMedia(content) {
    if (!content)
        return "";
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    const parts = [];
    for (const m of content) {
        const seg = m;
        if (seg?.type === "text") {
            const t = seg.data?.text ?? "";
            if (t)
                parts.push(t);
        }
        else if (seg?.type === "at") {
            const target = seg.data?.qq ?? seg.data?.id ?? "";
            if (target)
                parts.push(`@${target}`);
        }
        else if (seg?.type === "mface") {
            const summary = seg.data?.summary ?? "";
            parts.push(summary ? `[动画表情: ${summary}]` : "[动画表情]");
        }
        else if (seg?.type === "face") {
            const id = seg.data?.id ?? "";
            parts.push(formatFacePlaceholder(id));
        }
        else if (seg?.type === "file") {
            const name = seg.data?.name ?? seg.data?.file ?? "";
            parts.push(name ? `[文件: ${name}]` : "[文件]");
        }
    }
    return parts.join("");
}
/** 仅从 message 段数组提取 text 段（不含 raw_message，用于有引用时避免 CQ 码） */
export function getTextFromSegments(msg) {
    const arr = msg?.message;
    if (!Array.isArray(arr))
        return "";
    return arr
        .filter((m) => m?.type === "text")
        .map((m) => m?.data?.text ?? "")
        .join("");
}
export function getRawText(msg) {
    if (!msg)
        return "";
    const parsed = getTextFromMessageContent(msg.message);
    if (typeof parsed === "string" && parsed.trim()) {
        return parsed;
    }
    if (typeof msg.raw_message === "string" && msg.raw_message) {
        return msg.raw_message;
    }
    return getTextFromSegments(msg);
}
export function getRecordSegments(msg) {
    const arr = msg?.message;
    if (Array.isArray(arr)) {
        const records = arr
            .filter((m) => m?.type === "record")
            .map((m, index) => {
            const data = m?.data ?? {};
            return {
                url: decodeHtmlEntities(data.url ?? ""),
                file: decodeHtmlEntities(data.file ?? ""),
                path: decodeHtmlEntities(data.path ?? ""),
                mime: inferRecordMime(data),
                index,
            };
        })
            .filter((entry) => Boolean(entry.url || entry.path || entry.file));
        if (records.length > 0)
            return records;
    }
    return parseRecordSegmentsFromRawMessage(msg?.raw_message);
}
export function getImageSegments(msg) {
    const arr = msg?.message;
    if (Array.isArray(arr)) {
        const images = arr
            .filter((m) => m?.type === "image")
            .map((m, index) => {
            const data = m?.data ?? {};
            return {
                url: decodeHtmlEntities(data.url ?? ""),
                file: decodeHtmlEntities(data.file ?? ""),
                path: decodeHtmlEntities(data.path ?? ""),
                mime: inferImageMime(data),
                index,
            };
        })
            .filter((entry) => Boolean(entry.url || entry.path || entry.file));
        if (images.length > 0)
            return images;
    }
    return parseImageSegmentsFromRawMessage(msg?.raw_message);
}
export function isMentioned(msg, selfId) {
    const arr = msg.message;
    if (!Array.isArray(arr))
        return false;
    const selfStr = String(selfId);
    return arr.some((m) => m?.type === "at" && String(m?.data?.qq || m?.data?.id) === selfStr);
}
