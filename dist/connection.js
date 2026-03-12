/**
 * OneBot WebSocket 连接与 API 调用
 *
 * 图片消息：网络 URL 会先下载到本地再发送（兼容 Lagrange.Core retcode 1200），
 * 并定期清理临时文件。
 */
import WebSocket from "ws";
import { createServer } from "http";
import https from "https";
import http from "http";
import { writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, readFileSync, existsSync, copyFileSync } from "fs";
import { join, basename } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { logSend } from "./send-debug-log.js";
import { shouldBlockSendInForwardMode, getActiveReplyTarget, getActiveReplySessionId } from "./reply-context.js";
const IMAGE_TEMP_DIR = join(tmpdir(), "openclaw-onebot");
const DOWNLOAD_TIMEOUT_MS = 30000;
const WSL_UPLOAD_BRIDGE_DIR = "/mnt/c/Users/Public/openclaw-onebot-upload";
const AUDIO_EXT_RE = /\.(amr|silk|mp3|wav|ogg|opus|m4a|aac|flac|webm)(?:\?|$)/i;
const FACE_MAP_FILE = fileURLToPath(new URL("../face-map.json", import.meta.url));
const FACE_PLACEHOLDER_RE = /\[表情:([^\]\n]{1,120})\]/g;
let faceMapCache = null;
let faceReverseMapCache = null;
let faceMapMtimeMs = -1;
/** 使用 Node 内置 http(s) 下载 URL，避免 fetch 在某些环境下的兼容性问题 */
function downloadUrl(url) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith("https") ? https : http;
        const req = lib.get(url, (res) => {
            const redirect = res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location;
            if (redirect) {
                downloadUrl(redirect.startsWith("http") ? redirect : new URL(redirect, url).href).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
                return;
            }
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks)));
            res.on("error", reject);
        });
        req.on("error", reject);
        req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
            req.destroy();
            reject(new Error("Download timeout"));
        });
    });
}
const IMAGE_TEMP_MAX_AGE_MS = 60 * 60 * 1000; // 1 小时
const IMAGE_TEMP_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 每小时清理一次
let imageTempCleanupTimer = null;
function loadFaceMaps() {
    try {
        if (!existsSync(FACE_MAP_FILE)) {
            faceMapCache = null;
            faceReverseMapCache = null;
            faceMapMtimeMs = -1;
            return { forward: null, reverse: null };
        }
        const st = statSync(FACE_MAP_FILE);
        if (faceMapCache && faceReverseMapCache && st.mtimeMs === faceMapMtimeMs) {
            return { forward: faceMapCache, reverse: faceReverseMapCache };
        }
        const raw = JSON.parse(readFileSync(FACE_MAP_FILE, "utf8"));
        const forward = new Map();
        const reverse = new Map();
        if (raw && typeof raw === "object") {
            for (const [faceIdRaw, labelRaw] of Object.entries(raw)) {
                const faceId = String(faceIdRaw ?? "").trim();
                const label = String(labelRaw ?? "").trim();
                if (!faceId || !label)
                    continue;
                forward.set(faceId, label);
                const aliases = [
                    label,
                    label.replace(/^\/+/, ""),
                    label.replace(/\s+/g, ""),
                    label.replace(/^\/+/, "").replace(/\s+/g, ""),
                ].filter(Boolean);
                for (const alias of aliases) {
                    if (!reverse.has(alias)) {
                        reverse.set(alias, faceId);
                    }
                }
            }
        }
        faceMapCache = forward;
        faceReverseMapCache = reverse;
        faceMapMtimeMs = st.mtimeMs;
        return { forward, reverse };
    }
    catch {
        return { forward: faceMapCache, reverse: faceReverseMapCache };
    }
}
function resolveFaceIdFromPlaceholder(content) {
    const raw = String(content ?? "").trim();
    if (!raw)
        return null;
    const withParen = raw.match(/[（(]\s*(\d{1,6})\s*[)）]\s*$/);
    if (withParen) {
        return Number.parseInt(withParen[1], 10);
    }
    const digitsOnly = raw.match(/^\s*(\d{1,6})\s*$/);
    if (digitsOnly) {
        return Number.parseInt(digitsOnly[1], 10);
    }
    const { reverse } = loadFaceMaps();
    const normalized = raw.replace(/^\/+/, "").trim();
    const compact = normalized.replace(/\s+/g, "");
    const faceId = reverse?.get(normalized) ?? reverse?.get(compact);
    const parsed = Number(faceId);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function pushTextSegment(segments, text) {
    const raw = String(text ?? "");
    if (!raw)
        return;
    const last = segments[segments.length - 1];
    if (last?.type === "text") {
        last.data.text += raw;
        return;
    }
    segments.push({ type: "text", data: { text: raw } });
}
function parseTextFaceSegments(text) {
    const raw = String(text ?? "");
    const segments = [];
    let hasFaces = false;
    let lastIndex = 0;
    FACE_PLACEHOLDER_RE.lastIndex = 0;
    for (const match of raw.matchAll(FACE_PLACEHOLDER_RE)) {
        const start = match.index ?? 0;
        const end = start + String(match[0] ?? "").length;
        pushTextSegment(segments, raw.slice(lastIndex, start));
        const faceId = resolveFaceIdFromPlaceholder(match[1]);
        if (faceId != null) {
            segments.push({ type: "face", data: { id: String(Math.trunc(faceId)) } });
            hasFaces = true;
        }
        else {
            pushTextSegment(segments, match[0]);
        }
        lastIndex = end;
    }
    pushTextSegment(segments, raw.slice(lastIndex));
    return { hasFaces, segments };
}
/** 清理过期的临时图片文件 */
function cleanupImageTemp() {
    try {
        if (!readdirSync)
            return;
        const files = readdirSync(IMAGE_TEMP_DIR);
        const now = Date.now();
        for (const f of files) {
            const p = join(IMAGE_TEMP_DIR, f);
            try {
                const st = statSync(p);
                if (st.isFile() && now - st.mtimeMs > IMAGE_TEMP_MAX_AGE_MS) {
                    unlinkSync(p);
                }
            }
            catch {
                /* ignore */
            }
        }
    }
    catch {
        /* dir not exist or readdir failed */
    }
}
/** 将 mediaUrl 解析为可发送的 file 路径。网络 URL 下载到本地，base64 解码到本地，定期清理过期文件 */
async function resolveImageToLocalPath(image) {
    const trimmed = image?.trim();
    if (!trimmed)
        throw new Error("Empty image");
    if (/^https?:\/\//i.test(trimmed)) {
        cleanupImageTemp();
        const buf = await downloadUrl(trimmed);
        const ext = (trimmed.match(/\.(png|jpg|jpeg|gif|webp|bmp)(?:\?|$)/i)?.[1] ?? "png").toLowerCase();
        mkdirSync(IMAGE_TEMP_DIR, { recursive: true });
        const tmpPath = join(IMAGE_TEMP_DIR, `img-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
        writeFileSync(tmpPath, buf);
        return tmpPath.replace(/\\/g, "/");
    }
    if (trimmed.startsWith("base64://")) {
        cleanupImageTemp();
        const b64 = trimmed.slice(9);
        const buf = Buffer.from(b64, "base64");
        mkdirSync(IMAGE_TEMP_DIR, { recursive: true });
        const tmpPath = join(IMAGE_TEMP_DIR, `img-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
        writeFileSync(tmpPath, buf);
        return tmpPath.replace(/\\/g, "/");
    }
    if (trimmed.startsWith("file://")) {
        return trimmed.slice(7).replace(/\\/g, "/");
    }
    return trimmed.replace(/\\/g, "/");
}
/** 将 audioUrl/本地路径 解析为可发送的 record 路径。网络 URL 下载到本地。 */
async function resolveAudioToLocalPath(audio) {
    const trimmed = audio?.trim();
    if (!trimmed)
        throw new Error("Empty audio");
    if (/^https?:\/\//i.test(trimmed)) {
        cleanupImageTemp();
        const buf = await downloadUrl(trimmed);
        const ext = (trimmed.match(AUDIO_EXT_RE)?.[1] ?? "mp3").toLowerCase();
        mkdirSync(IMAGE_TEMP_DIR, { recursive: true });
        const tmpPath = join(IMAGE_TEMP_DIR, `audio-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
        writeFileSync(tmpPath, buf);
        return tmpPath.replace(/\\/g, "/");
    }
    if (trimmed.startsWith("base64://")) {
        cleanupImageTemp();
        const b64 = trimmed.slice(9);
        const buf = Buffer.from(b64, "base64");
        mkdirSync(IMAGE_TEMP_DIR, { recursive: true });
        const tmpPath = join(IMAGE_TEMP_DIR, `audio-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
        writeFileSync(tmpPath, buf);
        return tmpPath.replace(/\\/g, "/");
    }
    if (trimmed.startsWith("file://")) {
        return trimmed.slice(7).replace(/\\/g, "/");
    }
    return trimmed.replace(/\\/g, "/");
}
function isRetcode1200(res) {
    return Number(res?.retcode) === 1200;
}
function getWslPathViaCommand(path) {
    try {
        const out = execFileSync("wslpath", ["-w", path], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 2000,
        }).trim();
        return out || null;
    }
    catch {
        return null;
    }
}
function getWslUncPath(path) {
    if (!path.startsWith("/"))
        return null;
    const byCmd = getWslPathViaCommand(path);
    if (byCmd)
        return byCmd;
    const distro = process.env.WSL_DISTRO_NAME?.trim();
    if (distro)
        return `\\\\wsl.localhost\\${distro}${path.replace(/\//g, "\\")}`;
    return null;
}
function getWindowsDrivePathFromWsl(path) {
    const m = path.match(/^\/mnt\/([a-zA-Z])\/(.+)$/);
    if (!m)
        return null;
    return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, "\\")}`;
}
function getUploadFileCandidates(file) {
    const raw = String(file ?? "").trim();
    if (!raw)
        throw new Error("Empty file path");
    const withoutScheme = raw.startsWith("file://") ? raw.slice(7) : raw;
    const normalized = withoutScheme.replace(/\\/g, "/");
    const candidates = [withoutScheme];
    if (normalized !== withoutScheme)
        candidates.push(normalized);
    const winDrive = getWindowsDrivePathFromWsl(normalized);
    if (winDrive)
        candidates.push(winDrive);
    const unc = getWslUncPath(normalized);
    if (unc)
        candidates.push(unc);
    return [...new Set(candidates.filter(Boolean))];
}
function maybeStageFileForWindowsOneBot(filePath) {
    const normalized = String(filePath ?? "").replace(/\\/g, "/");
    if (!normalized.startsWith("/"))
        return null;
    if (!existsSync(normalized))
        return null;
    if (getWindowsDrivePathFromWsl(normalized))
        return null;
    if (!existsSync("/mnt/c/Users/Public"))
        return null;
    try {
        mkdirSync(WSL_UPLOAD_BRIDGE_DIR, { recursive: true });
        const safeName = basename(normalized) || "upload.bin";
        const staged = join(WSL_UPLOAD_BRIDGE_DIR, `up-${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`);
        copyFileSync(normalized, staged);
        return staged.replace(/\\/g, "/");
    }
    catch {
        return null;
    }
}
async function sendImageAction(socket, action, targetKey, targetId, message, log = getLogger()) {
    const params = targetKey === "group_id"
        ? { group_id: targetId, message }
        : { user_id: targetId, message };
    return sendOneBotAction(socket, action, params, log);
}
async function sendImageWithFallback(socket, action, targetKey, targetId, image, log = getLogger()) {
    const raw = String(image ?? "").trim();
    if (!raw)
        throw new Error("Empty image");
    if (raw.startsWith("[")) {
        return sendImageAction(socket, action, targetKey, targetId, JSON.parse(raw), log);
    }
    const localPath = await resolveImageToLocalPath(raw);
    let res = await sendImageAction(socket, action, targetKey, targetId, [{ type: "image", data: { file: localPath } }], log);
    if (res?.retcode === 0 || !isRetcode1200(res))
        return res;
    log.warn?.(`[onebot] ${action} image retcode=1200, trying fallback refs`);
    if (/^https?:\/\//i.test(raw)) {
        const urlRes = await sendImageAction(socket, action, targetKey, targetId, [{ type: "image", data: { file: raw } }], log);
        if (urlRes?.retcode === 0)
            return urlRes;
        res = urlRes;
    }
    try {
        const b64 = readFileSync(localPath).toString("base64");
        const b64Res = await sendImageAction(socket, action, targetKey, targetId, [{ type: "image", data: { file: `base64://${b64}` } }], log);
        if (b64Res?.retcode === 0)
            return b64Res;
        res = b64Res;
    }
    catch (e) {
        log.warn?.(`[onebot] ${action} image base64 fallback failed: ${e?.message ?? e}`);
    }
    const winPath = getWindowsDrivePathFromWsl(localPath) ?? getWslUncPath(localPath);
    if (winPath) {
        const winRes = await sendImageAction(socket, action, targetKey, targetId, [{ type: "image", data: { file: winPath } }], log);
        if (winRes?.retcode === 0)
            return winRes;
        res = winRes;
    }
    return res;
}
function buildReplyRecordMessage(file, replyMessageId) {
    const segments = [];
    const replyId = Number(replyMessageId);
    if (Number.isFinite(replyId) && replyId > 0) {
        segments.push({ type: "reply", data: { id: String(Math.trunc(replyId)) } });
    }
    segments.push({ type: "record", data: { file } });
    return segments;
}
async function sendRecordWithFallback(socket, action, targetKey, targetId, audio, replyMessageId, log = getLogger()) {
    const raw = String(audio ?? "").trim();
    if (!raw)
        throw new Error("Empty audio");
    const localPath = await resolveAudioToLocalPath(raw);
    const candidates = getUploadFileCandidates(localPath);
    const withoutScheme = raw.startsWith("file://") ? raw.slice(7) : localPath;
    const staged = maybeStageFileForWindowsOneBot(withoutScheme);
    if (staged) {
        candidates.push(staged);
        const stagedWin = getWindowsDrivePathFromWsl(staged);
        if (stagedWin)
            candidates.push(stagedWin);
        const stagedUnc = getWslUncPath(staged);
        if (stagedUnc)
            candidates.push(stagedUnc);
    }
    const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
    let lastRes = null;
    const tried = [];
    for (const candidate of uniqueCandidates) {
        tried.push(candidate);
        const params = targetKey === "group_id"
            ? { group_id: targetId, message: buildReplyRecordMessage(candidate, replyMessageId) }
            : { user_id: targetId, message: buildReplyRecordMessage(candidate, replyMessageId) };
        const res = await sendOneBotAction(socket, action, params, log);
        if (res?.retcode === 0)
            return res;
        lastRes = res;
        if (!isRetcode1200(res))
            break;
    }
    throw new Error((lastRes?.msg ?? `OneBot ${action} (record) failed (retcode=${lastRes?.retcode})`) +
        (tried.length > 0 ? ` 已尝试路径: ${tried.join(" | ")}` : ""));
}
/** 启动临时图片定期清理（每小时执行一次） */
export function startImageTempCleanup() {
    stopImageTempCleanup();
    imageTempCleanupTimer = setInterval(cleanupImageTemp, IMAGE_TEMP_CLEANUP_INTERVAL_MS);
}
/** 停止临时图片定期清理 */
export function stopImageTempCleanup() {
    if (imageTempCleanupTimer) {
        clearInterval(imageTempCleanupTimer);
        imageTempCleanupTimer = null;
    }
}
let ws = null;
let wsServer = null;
let httpServer = null;
const lastSentMessageIdByTarget = new Map();
const lastInboundMessageIdByTarget = new Map();
const recentMfaceByTarget = new Map();
const RECENT_MFACE_LIMIT = 30;
const pendingEcho = new Map();
let echoCounter = 0;
let connectionReadyResolve = null;
const connectionReadyPromise = new Promise((r) => { connectionReadyResolve = r; });
function nextEcho() {
    return `onebot-${Date.now()}-${++echoCounter}`;
}
export function handleEchoResponse(payload) {
    if (payload?.echo && pendingEcho.has(payload.echo)) {
        const h = pendingEcho.get(payload.echo);
        h?.resolve(payload);
        return true;
    }
    return false;
}
function getLogger() {
    return globalThis.__onebotApi?.logger ?? {};
}
function sendOneBotAction(wsocket, action, params, log = getLogger()) {
    const echo = nextEcho();
    const payload = { action, params, echo };
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingEcho.delete(echo);
            log.warn?.(`[onebot] sendOneBotAction ${action} timeout`);
            reject(new Error(`OneBot action ${action} timeout`));
        }, 15000);
        pendingEcho.set(echo, {
            resolve: (v) => {
                clearTimeout(timeout);
                pendingEcho.delete(echo);
                if (v?.retcode !== 0)
                    log.warn?.(`[onebot] sendOneBotAction ${action} retcode=${v?.retcode} msg=${v?.msg ?? ""}`);
                resolve(v);
            },
        });
        wsocket.send(JSON.stringify(payload), (err) => {
            if (err) {
                pendingEcho.delete(echo);
                clearTimeout(timeout);
                reject(err);
            }
        });
    });
}
function rememberLastSentMessage(type, targetId, messageId) {
    const mid = Number(messageId);
    if (!Number.isFinite(mid) || mid <= 0)
        return;
    lastSentMessageIdByTarget.set(`${type}:${targetId}`, mid);
}
function normalizeMfacePayload(mface) {
    if (!mface || typeof mface !== "object")
        return null;
    const emojiId = String(mface?.emoji_id ?? mface?.emojiId ?? mface?.id ?? "").trim();
    const emojiPackageId = String(mface?.emoji_package_id ?? mface?.emojiPackageId ?? mface?.package_id ?? mface?.packageId ?? "").trim();
    const summaryRaw = mface?.summary ?? mface?.text ?? mface?.desc ?? mface?.name;
    const summary = summaryRaw == null ? undefined : String(summaryRaw);
    if (emojiId && emojiPackageId) {
        const keyRaw = mface?.key ?? mface?.md5 ?? mface?.file_id ?? mface?.fileId;
        const key = keyRaw == null ? undefined : String(keyRaw);
        return {
            kind: "mface",
            emoji_id: emojiId,
            emoji_package_id: emojiPackageId,
            ...(key ? { key } : {}),
            ...(summary ? { summary } : {}),
        };
    }
    // NapCat/OneBot 某些实现会把收藏动画表情作为 image 段上报
    const rawType = String(mface?.type ?? "").toLowerCase();
    const subType = Number(mface?.sub_type ?? mface?.subType ?? NaN);
    const image = String(mface?.url ?? mface?.file ?? mface?.src ?? "").trim();
    const looksAnimated = String(summary ?? "").includes("动画表情") || subType === 1 || rawType === "image";
    if (!image || !looksAnimated)
        return null;
    return {
        kind: "image",
        image,
        ...(summary ? { summary } : {}),
    };
}
export function rememberRecentMface(type, targetId, mface) {
    const normalized = normalizeMfacePayload(mface);
    if (!normalized)
        return;
    const key = `${type}:${targetId}`;
    const arr = recentMfaceByTarget.get(key) ?? [];
    const sig = normalized.kind === "mface"
        ? `m:${normalized.emoji_package_id}:${normalized.emoji_id}:${normalized.key ?? ""}`
        : `i:${normalized.image}`;
    const next = arr.filter((it) => {
        const itSig = it.kind === "mface"
            ? `m:${it.emoji_package_id}:${it.emoji_id}:${it.key ?? ""}`
            : `i:${it.image}`;
        return itSig !== sig;
    });
    next.unshift(normalized);
    if (next.length > RECENT_MFACE_LIMIT)
        next.length = RECENT_MFACE_LIMIT;
    recentMfaceByTarget.set(key, next);
}
export function getRecentMfaceByIndex(type, targetId, index) {
    const idx = Number(index);
    if (!Number.isFinite(idx) || idx <= 0)
        return undefined;
    const arr = recentMfaceByTarget.get(`${type}:${targetId}`) ?? [];
    return arr[Math.trunc(idx) - 1];
}
export function listRecentMface(type, targetId, limit = 20) {
    const n = Number(limit);
    const max = Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), RECENT_MFACE_LIMIT) : 20;
    const arr = recentMfaceByTarget.get(`${type}:${targetId}`) ?? [];
    return arr.slice(0, max);
}
export function getLastSentMessageId(type, targetId) {
    return lastSentMessageIdByTarget.get(`${type}:${targetId}`);
}
export function rememberLastInboundMessage(type, targetId, messageId) {
    const mid = Number(messageId);
    if (!Number.isFinite(mid) || mid <= 0)
        return;
    lastInboundMessageIdByTarget.set(`${type}:${targetId}`, mid);
}
export function getLastInboundMessageId(type, targetId) {
    return lastInboundMessageIdByTarget.get(`${type}:${targetId}`);
}
/** 获取账号收藏表情列表（NapCat 扩展 API: fetch_custom_face） */
export async function fetchCustomFace(count = 48) {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        throw new Error("OneBot WebSocket not connected");
    const c = Number(count);
    const safeCount = Number.isFinite(c) && c > 0 ? Math.min(Math.trunc(c), 200) : 48;
    const res = await sendOneBotAction(ws, "fetch_custom_face", { count: safeCount });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot fetch_custom_face failed (retcode=${res?.retcode})`);
    }
    const data = res?.data;
    if (Array.isArray(data))
        return data;
    if (Array.isArray(data?.list))
        return data.list;
    if (Array.isArray(data?.data))
        return data.data;
    if (Array.isArray(data?.faces))
        return data.faces;
    return [];
}
export function getWs() {
    return ws;
}
/** 为 WebSocket 设置 echo 响应处理（按需连接时需调用，以便 sendOneBotAction 能收到响应） */
function setupEchoHandler(socket) {
    socket.on("message", (data) => {
        try {
            const payload = JSON.parse(data.toString());
            handleEchoResponse(payload);
        }
        catch {
            /* ignore */
        }
    });
}
/** 等待 WebSocket 连接就绪（service 启动后异步建立连接，发送前需先等待） */
export async function waitForConnection(timeoutMs = 30000) {
    if (ws && ws.readyState === WebSocket.OPEN)
        return ws;
    const log = getLogger();
    log.info?.("[onebot] waitForConnection: waiting for WebSocket...");
    return Promise.race([
        connectionReadyPromise.then(() => {
            if (ws && ws.readyState === WebSocket.OPEN)
                return ws;
            throw new Error("OneBot WebSocket not connected");
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`OneBot WebSocket not connected after ${timeoutMs}ms. Ensure "openclaw gateway run" is running and OneBot (Lagrange.Core) is connected.`)), timeoutMs)),
    ]);
}
/**
 * 确保有可用的 WebSocket 连接。当 service 未启动时，
 * forward-websocket 模式直接建立连接（message send 可独立运行）；
 * backward-websocket 模式需等待 gateway 的 service 建立连接。
 */
export async function ensureConnection(getConfig, timeoutMs = 30000) {
    if (ws && ws.readyState === WebSocket.OPEN)
        return ws;
    const config = getConfig();
    if (!config)
        throw new Error("OneBot not configured");
    const log = getLogger();
    if (config.type === "forward-websocket") {
        log.info?.("[onebot] 连接 OneBot (forward-websocket)...");
        const socket = await connectForward(config);
        setupEchoHandler(socket);
        setWs(socket);
        return socket;
    }
    return waitForConnection(timeoutMs);
}
export async function sendPrivateMsg(userId, text, getConfig) {
    if (shouldBlockSendInForwardMode("private", userId)) {
        logSend("connection", "sendPrivateMsg", { targetId: userId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    logSend("connection", "sendPrivateMsg", {
        targetType: "user",
        targetId: userId,
        textPreview: text?.slice(0, 80),
        textLen: text?.length,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig
        ? await ensureConnection(getConfig)
        : await waitForConnection();
    const res = await sendOneBotAction(socket, "send_private_msg", { user_id: userId, message: buildReplyTextMessage(text, null) });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_private_msg failed (retcode=${res?.retcode})`);
    }
    const mid = res?.data?.message_id;
    rememberLastSentMessage("user", userId, mid);
    logSend("connection", "sendPrivateMsg", { targetId: userId, messageId: mid, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
    return mid;
}
function buildReplyTextMessage(text, replyMessageId) {
    const replyId = Number(replyMessageId);
    const parsed = parseTextFaceSegments(text);
    const needsReply = Number.isFinite(replyId) && replyId > 0;
    if (!parsed.hasFaces && !needsReply) {
        return text;
    }
    const segments = [];
    if (needsReply) {
        segments.push({ type: "reply", data: { id: String(Math.trunc(replyId)) } });
    }
    if (parsed.segments.length > 0) {
        segments.push(...parsed.segments);
    }
    else if (String(text ?? "").trim()) {
        segments.push({ type: "text", data: { text: String(text) } });
    }
    return segments;
}
export async function sendGroupMsg(groupId, text, getConfig, replyMessageId) {
    if (shouldBlockSendInForwardMode("group", groupId)) {
        logSend("connection", "sendGroupMsg", { targetId: groupId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    logSend("connection", "sendGroupMsg", {
        targetType: "group",
        targetId: groupId,
        textPreview: text?.slice(0, 80),
        textLen: text?.length,
        replyMessageId: Number.isFinite(Number(replyMessageId)) ? Number(replyMessageId) : undefined,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig
        ? await ensureConnection(getConfig)
        : await waitForConnection();
    const res = await sendOneBotAction(socket, "send_group_msg", { group_id: groupId, message: buildReplyTextMessage(text, replyMessageId) });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_group_msg failed (retcode=${res?.retcode})`);
    }
    const mid = res?.data?.message_id;
    rememberLastSentMessage("group", groupId, mid);
    logSend("connection", "sendGroupMsg", { targetId: groupId, messageId: mid, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
    return mid;
}
export async function sendGroupRecord(groupId, audio, getConfig, replyMessageId, log = getLogger()) {
    if (shouldBlockSendInForwardMode("group", groupId)) {
        logSend("connection", "sendGroupRecord", { targetId: groupId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    logSend("connection", "sendGroupRecord", {
        targetType: "group",
        targetId: groupId,
        audioPreview: String(audio ?? "").slice(0, 80),
        replyMessageId: Number.isFinite(Number(replyMessageId)) ? Number(replyMessageId) : undefined,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig ? await ensureConnection(getConfig) : await waitForConnection();
    const res = await sendRecordWithFallback(socket, "send_group_msg", "group_id", groupId, audio, replyMessageId, log);
    const mid = res?.data?.message_id;
    rememberLastSentMessage("group", groupId, mid);
    logSend("connection", "sendGroupRecord", { targetId: groupId, messageId: mid, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
    return mid;
}
export async function sendPrivateRecord(userId, audio, getConfig, log = getLogger()) {
    if (shouldBlockSendInForwardMode("private", userId)) {
        logSend("connection", "sendPrivateRecord", { targetId: userId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    logSend("connection", "sendPrivateRecord", {
        targetType: "user",
        targetId: userId,
        audioPreview: String(audio ?? "").slice(0, 80),
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig ? await ensureConnection(getConfig) : await waitForConnection();
    const res = await sendRecordWithFallback(socket, "send_private_msg", "user_id", userId, audio, null, log);
    const mid = res?.data?.message_id;
    rememberLastSentMessage("user", userId, mid);
    logSend("connection", "sendPrivateRecord", { targetId: userId, messageId: mid, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
    return mid;
}
/** 发送 QQ 标准表情（face） */
export async function sendGroupFace(groupId, faceId, getConfig) {
    if (shouldBlockSendInForwardMode("group", groupId)) {
        logSend("connection", "sendGroupFace", { targetId: groupId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    const fid = Number(faceId);
    if (!Number.isFinite(fid) || fid < 0) {
        throw new Error(`Invalid face_id: ${faceId}`);
    }
    logSend("connection", "sendGroupFace", {
        targetType: "group",
        targetId: groupId,
        faceId: fid,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig
        ? await ensureConnection(getConfig)
        : await waitForConnection();
    const seg = [{ type: "face", data: { id: String(Math.trunc(fid)) } }];
    const res = await sendOneBotAction(socket, "send_group_msg", { group_id: groupId, message: seg });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_group_msg (face) failed (retcode=${res?.retcode})`);
    }
    const mid = res?.data?.message_id;
    rememberLastSentMessage("group", groupId, mid);
    logSend("connection", "sendGroupFace", { targetId: groupId, messageId: mid, faceId: fid, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
    return mid;
}
/** 发送 QQ 标准表情（face） */
export async function sendPrivateFace(userId, faceId, getConfig) {
    if (shouldBlockSendInForwardMode("private", userId)) {
        logSend("connection", "sendPrivateFace", { targetId: userId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    const fid = Number(faceId);
    if (!Number.isFinite(fid) || fid < 0) {
        throw new Error(`Invalid face_id: ${faceId}`);
    }
    logSend("connection", "sendPrivateFace", {
        targetType: "user",
        targetId: userId,
        faceId: fid,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig
        ? await ensureConnection(getConfig)
        : await waitForConnection();
    const seg = [{ type: "face", data: { id: String(Math.trunc(fid)) } }];
    const res = await sendOneBotAction(socket, "send_private_msg", { user_id: userId, message: seg });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_private_msg (face) failed (retcode=${res?.retcode})`);
    }
    const mid = res?.data?.message_id;
    rememberLastSentMessage("user", userId, mid);
    logSend("connection", "sendPrivateFace", { targetId: userId, messageId: mid, faceId: fid, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
    return mid;
}
/** 发送 QQ 商城/收藏表情（mface） */
export async function sendGroupMface(groupId, mface, getConfig) {
    if (shouldBlockSendInForwardMode("group", groupId)) {
        logSend("connection", "sendGroupMface", { targetId: groupId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    const emojiId = String(mface?.emoji_id ?? "").trim();
    const emojiPackageId = String(mface?.emoji_package_id ?? "").trim();
    const key = mface?.key == null ? undefined : String(mface.key);
    const summary = mface?.summary == null ? undefined : String(mface.summary);
    if (!emojiId || !emojiPackageId) {
        throw new Error("emoji_id 和 emoji_package_id 不能为空");
    }
    logSend("connection", "sendGroupMface", {
        targetType: "group",
        targetId: groupId,
        emojiId,
        emojiPackageId,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig
        ? await ensureConnection(getConfig)
        : await waitForConnection();
    const seg = [{
            type: "mface",
            data: {
                emoji_id: emojiId,
                emoji_package_id: emojiPackageId,
                ...(key ? { key } : {}),
                ...(summary ? { summary } : {}),
            },
        }];
    const res = await sendOneBotAction(socket, "send_group_msg", { group_id: groupId, message: seg });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_group_msg (mface) failed (retcode=${res?.retcode})`);
    }
    const mid = res?.data?.message_id;
    rememberLastSentMessage("group", groupId, mid);
    rememberRecentMface("group", groupId, { emoji_id: emojiId, emoji_package_id: emojiPackageId, ...(key ? { key } : {}), ...(summary ? { summary } : {}) });
    logSend("connection", "sendGroupMface", { targetId: groupId, messageId: mid, emojiId, emojiPackageId, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
    return mid;
}
/** 发送 QQ 商城/收藏表情（mface） */
export async function sendPrivateMface(userId, mface, getConfig) {
    if (shouldBlockSendInForwardMode("private", userId)) {
        logSend("connection", "sendPrivateMface", { targetId: userId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    const emojiId = String(mface?.emoji_id ?? "").trim();
    const emojiPackageId = String(mface?.emoji_package_id ?? "").trim();
    const key = mface?.key == null ? undefined : String(mface.key);
    const summary = mface?.summary == null ? undefined : String(mface.summary);
    if (!emojiId || !emojiPackageId) {
        throw new Error("emoji_id 和 emoji_package_id 不能为空");
    }
    logSend("connection", "sendPrivateMface", {
        targetType: "user",
        targetId: userId,
        emojiId,
        emojiPackageId,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig
        ? await ensureConnection(getConfig)
        : await waitForConnection();
    const seg = [{
            type: "mface",
            data: {
                emoji_id: emojiId,
                emoji_package_id: emojiPackageId,
                ...(key ? { key } : {}),
                ...(summary ? { summary } : {}),
            },
        }];
    const res = await sendOneBotAction(socket, "send_private_msg", { user_id: userId, message: seg });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_private_msg (mface) failed (retcode=${res?.retcode})`);
    }
    const mid = res?.data?.message_id;
    rememberLastSentMessage("user", userId, mid);
    rememberRecentMface("user", userId, { emoji_id: emojiId, emoji_package_id: emojiPackageId, ...(key ? { key } : {}), ...(summary ? { summary } : {}) });
    logSend("connection", "sendPrivateMface", { targetId: userId, messageId: mid, emojiId, emojiPackageId, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
    return mid;
}
export async function sendGroupImage(groupId, image, log = getLogger(), getConfig) {
    if (shouldBlockSendInForwardMode("group", groupId)) {
        logSend("connection", "sendGroupImage", { targetId: groupId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    logSend("connection", "sendGroupImage", {
        targetType: "group",
        targetId: groupId,
        imagePreview: image?.slice?.(0, 60),
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    log.info?.(`[onebot] sendGroupImage entry: groupId=${groupId} image=${image?.slice?.(0, 80) ?? ""}`);
    const socket = getConfig ? await ensureConnection(getConfig) : await waitForConnection();
    try {
        const res = await sendImageWithFallback(socket, "send_group_msg", "group_id", groupId, image, log);
        if (res?.retcode !== 0) {
            throw new Error(res?.msg ?? `OneBot send_group_msg (image) failed (retcode=${res?.retcode})`);
        }
        log.info?.(`[onebot] sendGroupImage done: retcode=${res?.retcode ?? "?"}`);
        const mid = res?.data?.message_id;
        rememberLastSentMessage("group", groupId, mid);
        logSend("connection", "sendGroupImage", { targetId: groupId, messageId: mid, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return mid;
    }
    catch (error) {
        log.warn?.(`[onebot] sendGroupImage error: ${error}`);
        throw error instanceof Error ? error : new Error(String(error));
    }
}
/** 发送群合并转发消息。messages 为节点数组，每节点 { type: "node", data: { id } } 或 { type: "node", data: { user_id, nickname, content } } */
export async function sendGroupForwardMsg(groupId, messages, getConfig) {
    logSend("connection", "sendGroupForwardMsg", {
        targetType: "group",
        targetId: groupId,
        nodeCount: messages.length,
        isForward: true,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig ? await ensureConnection(getConfig) : await waitForConnection();
    const res = await sendOneBotAction(socket, "send_group_forward_msg", { group_id: groupId, messages });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_group_forward_msg failed (retcode=${res?.retcode})`);
    }
}
/** 发送私聊合并转发消息 */
export async function sendPrivateForwardMsg(userId, messages, getConfig) {
    logSend("connection", "sendPrivateForwardMsg", {
        targetType: "user",
        targetId: userId,
        nodeCount: messages.length,
        isForward: true,
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    const socket = getConfig ? await ensureConnection(getConfig) : await waitForConnection();
    const res = await sendOneBotAction(socket, "send_private_forward_msg", { user_id: userId, messages });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_private_forward_msg failed (retcode=${res?.retcode})`);
    }
}
export async function sendPrivateImage(userId, image, log = getLogger(), getConfig) {
    if (shouldBlockSendInForwardMode("private", userId)) {
        logSend("connection", "sendPrivateImage", { targetId: userId, blocked: true, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
        return undefined;
    }
    logSend("connection", "sendPrivateImage", {
        targetType: "user",
        targetId: userId,
        imagePreview: image?.slice?.(0, 60),
        sessionId: getActiveReplyTarget(),
        replySessionId: getActiveReplySessionId(),
    });
    log.info?.(`[onebot] sendPrivateImage entry: userId=${userId} image=${image?.slice?.(0, 80) ?? ""}`);
    const socket = getConfig ? await ensureConnection(getConfig) : await waitForConnection();
    const res = await sendImageWithFallback(socket, "send_private_msg", "user_id", userId, image, log);
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot send_private_msg (image) failed (retcode=${res?.retcode})`);
    }
    log.info?.(`[onebot] sendPrivateImage done: retcode=${res?.retcode ?? "?"}`);
    const mid = res?.data?.message_id;
    rememberLastSentMessage("user", userId, mid);
    logSend("connection", "sendPrivateImage", { targetId: userId, messageId: mid, sessionId: getActiveReplyTarget(), replySessionId: getActiveReplySessionId() });
    return mid;
}
export async function uploadGroupFile(groupId, file, name) {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        throw new Error("OneBot WebSocket not connected");
    const candidates = getUploadFileCandidates(file);
    const raw = String(file ?? "").trim();
    const withoutScheme = raw.startsWith("file://") ? raw.slice(7) : raw;
    const staged = maybeStageFileForWindowsOneBot(withoutScheme);
    if (staged) {
        candidates.push(staged);
        const stagedWin = getWindowsDrivePathFromWsl(staged);
        if (stagedWin)
            candidates.push(stagedWin);
        const stagedUnc = getWslUncPath(staged);
        if (stagedUnc)
            candidates.push(stagedUnc);
    }
    const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
    getLogger().info?.(`[onebot] upload_group_file candidates(${uniqueCandidates.length}): ${uniqueCandidates.join(" | ")}`);
    let lastRes = null;
    const tried = [];
    for (const candidate of uniqueCandidates) {
        tried.push(candidate);
        const res = await sendOneBotAction(ws, "upload_group_file", { group_id: groupId, file: candidate, name });
        if (res?.retcode === 0)
            return;
        lastRes = res;
        if (!isRetcode1200(res))
            break;
    }
    throw new Error((lastRes?.msg ??
        `OneBot upload_group_file failed (retcode=${lastRes?.retcode})。` +
            `可能是 OneBot 进程读不到该路径，请使用 OneBot 宿主机可访问路径。`) +
        ` 已尝试路径: ${tried.join(" | ")}`);
}
export async function uploadPrivateFile(userId, file, name) {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        throw new Error("OneBot WebSocket not connected");
    const candidates = getUploadFileCandidates(file);
    const raw = String(file ?? "").trim();
    const withoutScheme = raw.startsWith("file://") ? raw.slice(7) : raw;
    const staged = maybeStageFileForWindowsOneBot(withoutScheme);
    if (staged) {
        candidates.push(staged);
        const stagedWin = getWindowsDrivePathFromWsl(staged);
        if (stagedWin)
            candidates.push(stagedWin);
        const stagedUnc = getWslUncPath(staged);
        if (stagedUnc)
            candidates.push(stagedUnc);
    }
    const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
    getLogger().info?.(`[onebot] upload_private_file candidates(${uniqueCandidates.length}): ${uniqueCandidates.join(" | ")}`);
    let lastRes = null;
    const tried = [];
    for (const candidate of uniqueCandidates) {
        tried.push(candidate);
        const res = await sendOneBotAction(ws, "upload_private_file", { user_id: userId, file: candidate, name });
        if (res?.retcode === 0)
            return;
        lastRes = res;
        if (!isRetcode1200(res))
            break;
    }
    throw new Error((lastRes?.msg ??
        `OneBot upload_private_file failed (retcode=${lastRes?.retcode})。` +
            `可能是 OneBot 进程读不到该路径，请使用 OneBot 宿主机可访问路径。`) +
        ` 已尝试路径: ${tried.join(" | ")}`);
}
/** 撤回消息 */
export async function deleteMsg(messageId) {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        throw new Error("OneBot WebSocket not connected");
    const res = await sendOneBotAction(ws, "delete_msg", { message_id: messageId });
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot delete_msg failed (retcode=${res?.retcode})`);
    }
}
/** 私聊显示“正在输入中”（NapCat 扩展 API） */
export async function setInputStatus(userId, eventType = 1, getConfig, log = getLogger()) {
    const uid = Number(userId);
    if (!Number.isFinite(uid) || uid <= 0) {
        throw new Error(`Invalid user_id for set_input_status: ${userId}`);
    }
    const evt = Number(eventType);
    const socket = getConfig
        ? await ensureConnection(getConfig)
        : await waitForConnection();
    const res = await sendOneBotAction(socket, "set_input_status", {
        user_id: Math.trunc(uid),
        event_type: Number.isFinite(evt) ? Math.trunc(evt) : 1,
    }, log);
    if (res?.retcode !== 0) {
        throw new Error(res?.msg ?? `OneBot set_input_status failed (retcode=${res?.retcode})`);
    }
    return res?.data;
}
/**
 * 对消息进行表情回应（Lagrange/QQ NT 扩展 API）
 * @param message_id 需要回应的消息 ID（用户发送的消息）
 * @param emoji_id 表情 ID，1 通常为点赞
 * @param is_set true 添加，false 取消
 */
export async function setMsgEmojiLike(message_id, emoji_id, is_set = true) {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        throw new Error("OneBot WebSocket not connected");
    const mid = Number(message_id);
    const eidNum = Number(emoji_id);
    const eidStr = String(emoji_id);
    const normalizedSet = Boolean(is_set);
    const payloads = normalizedSet
        ? [
            // NapCat 文档参数：message_id + emoji_id(string)
            { message_id: mid, emoji_id: eidStr },
            // 兼容部分实现使用数字 emoji_id
            { message_id: mid, emoji_id: eidNum },
            // 兼容旧实现（Lagrange 风格）
            { message_id: mid, emoji_id: eidNum, is_set: true },
            { message_id: mid, emoji_id: eidStr, is_set: true },
        ]
        : [
            // 撤回时必须显式带 is_set=false；否则部分实现会被当成“继续添加”
            { message_id: mid, emoji_id: eidNum, is_set: false },
            { message_id: mid, emoji_id: eidStr, is_set: false },
        ];
    let lastRes = null;
    for (const params of payloads) {
        const res = await sendOneBotAction(ws, "set_msg_emoji_like", params);
        if (res?.retcode === 0)
            return;
        lastRes = res;
        if (!isRetcode1200(res))
            break;
    }
    throw new Error(lastRes?.msg ?? `OneBot set_msg_emoji_like failed (retcode=${lastRes?.retcode})`);
}
/** 获取陌生人信息（含 nickname） */
export async function getStrangerInfo(userId) {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return null;
    try {
        const res = await sendOneBotAction(ws, "get_stranger_info", { user_id: userId, no_cache: false });
        if (res?.retcode === 0 && res?.data)
            return { nickname: String(res.data.nickname ?? "") };
        return null;
    }
    catch {
        return null;
    }
}
/** 获取群成员信息（含 nickname、card） */
export async function getGroupMemberInfo(groupId, userId) {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return null;
    try {
        const res = await sendOneBotAction(ws, "get_group_member_info", { group_id: groupId, user_id: userId, no_cache: false });
        if (res?.retcode === 0 && res?.data) {
            return { nickname: String(res.data.nickname ?? ""), card: String(res.data.card ?? "") };
        }
        return null;
    }
    catch {
        return null;
    }
}
/** 获取群信息（含 group_name） */
export async function getGroupInfo(groupId) {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return null;
    try {
        const res = await sendOneBotAction(ws, "get_group_info", { group_id: groupId, no_cache: false });
        if (res?.retcode === 0 && res?.data)
            return { group_name: String(res.data.group_name ?? "") };
        return null;
    }
    catch {
        return null;
    }
}
/** QQ 头像 URL，s=640 为常用尺寸 */
export function getAvatarUrl(userId, size = 640) {
    return `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=${size}`;
}
/** 获取单条消息（需 OneBot 实现支持） */
export async function getMsg(messageId) {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return null;
    try {
        const res = await sendOneBotAction(ws, "get_msg", { message_id: messageId });
        if (res?.retcode === 0 && res?.data)
            return res.data;
        return null;
    }
    catch {
        return null;
    }
}
/**
 * 获取群聊历史消息（Lagrange.Core 扩展 API，go-cqhttp 等可能不支持）
 * @param groupId 群号
 * @param opts message_seq 起始序号；message_id 起始消息 ID；count 数量
 */
export async function getGroupMsgHistory(groupId, opts = { count: 20 }) {
    if (!ws || ws.readyState !== WebSocket.OPEN)
        return [];
    try {
        const res = await sendOneBotAction(ws, "get_group_msg_history", {
            group_id: groupId,
            message_seq: opts.message_seq,
            message_id: opts.message_id,
            count: opts.count ?? 20,
        });
        if (res?.retcode === 0 && res?.data?.messages)
            return res.data.messages;
        return [];
    }
    catch {
        return [];
    }
}
export async function connectForward(config) {
    const path = config.path ?? "/onebot/v11/ws";
    const pathNorm = path.startsWith("/") ? path : `/${path}`;
    let addr = `ws://${config.host}:${config.port}${pathNorm}`;
    const headers = {};
    if (config.accessToken) {
        const token = String(config.accessToken).trim();
        if (token) {
            // NapCat 在部分版本中仅识别 URL query: access_token。
            // 这里同时保留 Authorization 头，兼容支持 Bearer 的实现。
            const sep = addr.includes("?") ? "&" : "?";
            addr = `${addr}${sep}access_token=${encodeURIComponent(token)}`;
            headers["Authorization"] = `Bearer ${token}`;
        }
    }
    const w = Object.keys(headers).length > 0 ? new WebSocket(addr, { headers }) : new WebSocket(addr);
    await new Promise((resolve, reject) => {
        w.on("open", () => resolve());
        w.on("error", reject);
    });
    return w;
}
export async function createServerAndWait(config) {
    const { WebSocketServer } = await import("ws");
    const server = createServer();
    httpServer = server;
    const wss = new WebSocketServer({
        server,
        path: config.path ?? "/onebot/v11/ws",
    });
    const host = config.host || "0.0.0.0";
    server.listen(config.port, host);
    wsServer = wss;
    return new Promise((resolve) => {
        wss.on("connection", (socket) => {
            resolve(socket);
        });
    });
}
export function setWs(socket) {
    ws = socket;
    if (socket && socket.readyState === WebSocket.OPEN && connectionReadyResolve) {
        connectionReadyResolve();
        connectionReadyResolve = null;
    }
}
export function stopConnection() {
    if (ws) {
        ws.close();
        ws = null;
    }
    if (wsServer) {
        wsServer.close();
        wsServer = null;
    }
    if (httpServer) {
        httpServer.close();
        httpServer = null;
    }
}
