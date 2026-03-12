/**
 * 当前回复目标上下文
 * 当 process-inbound 处理群聊消息时设置，channel.sendMedia 可用其修正错误的 target
 * （Agent 可能传入裸数字或 user:xxx，导致误发私聊）
 */
let activeReplyTarget = null;
/** Fallback target for contexts without active reply (e.g. cron jobs) */
let fallbackDeliveryTarget = null;
let activeReplySessionId = null;
/** forward 模式下需拦截 channel outbound 的自动发送，避免 N 条重复发出 */
let forwardSuppressDelivery = false;
/** 机器人自身 QQ，forward 时发给自己需放行 */
let activeReplySelfId = null;
/** 当前触发消息 ID，用于群聊文本回复时挂 reply 段 */
let activeReplyMessageId = null;
export function setActiveReplyTarget(to) {
    activeReplyTarget = to;
}
export function setActiveReplySelfId(selfId) {
    activeReplySelfId = selfId;
}
export function getActiveReplySelfId() {
    return activeReplySelfId;
}
export function setActiveReplyMessageId(messageId) {
    activeReplyMessageId = Number.isFinite(Number(messageId)) ? Number(messageId) : null;
}
export function getActiveReplyMessageId() {
    return activeReplyMessageId;
}
export function consumeActiveReplyMessageId() {
    const current = activeReplyMessageId;
    activeReplyMessageId = null;
    return current;
}
export function setForwardSuppressDelivery(suppress) {
    forwardSuppressDelivery = suppress;
}
export function getForwardSuppressDelivery() {
    return forwardSuppressDelivery;
}
export function clearActiveReplyTarget() {
    activeReplyTarget = null;
}
export function getActiveReplyTarget() {
    return activeReplyTarget;
}
export function setFallbackDeliveryTarget(to) {
    fallbackDeliveryTarget = to;
}
export function getFallbackDeliveryTarget() {
    return fallbackDeliveryTarget;
}
/**
 * 回复会话 ID：同一用户问题下，AI 的多次 deliver 调用共享此 ID，便于统一处理
 * 在 processInboundMessage 开始 dispatch 时设置，结束时清除
 */
export function setActiveReplySessionId(id) {
    activeReplySessionId = id;
}
export function getActiveReplySessionId() {
    return activeReplySessionId;
}
/** 规范化 target 便于比较：group:123 / onebot:group:123 -> group:123 */
function normalizeTargetForCompare(t) {
    const s = (t || "").replace(/^(onebot|qq|lagrange):/i, "").trim().toLowerCase();
    return s || "";
}
/** 判断 to 是否与当前回复目标相同（用于 forward 模式下拦截 outbound 自动发送） */
export function isTargetActiveReply(to) {
    const target = activeReplyTarget;
    if (!target)
        return false;
    return normalizeTargetForCompare(to) === normalizeTargetForCompare(target);
}
/**
 * forward 模式下：发往用户（非 selfId）的普通消息应被拦截，只保留发给自己（构建转发）和最终的合并转发
 * @param type "private" | "group"
 * @param targetId 目标 ID（userId 或 groupId）
 * @returns true 表示应拦截，不发送
 */
export function shouldBlockSendInForwardMode(type, targetId) {
    if (!forwardSuppressDelivery)
        return false;
    const selfId = activeReplySelfId;
    if (type === "private") {
        return targetId !== selfId;
    }
    return true;
}
/**
 * 若当前有活跃群聊回复目标，且传入的 to 可能被误判为私聊（裸数字或 user:xxx 与群号相同），则返回修正后的 target
 */
export function resolveTargetForReply(to) {
    const stored = activeReplyTarget;
    if (!stored)
        return to;
    const m = stored.match(/group:(\d+)$/i) || stored.match(/onebot:group:(\d+)$/i);
    if (!m)
        return to;
    const groupId = m[1];
    const normalizedTo = to.replace(/^(onebot|qq|lagrange):/i, "").trim();
    const numericPart = normalizedTo.replace(/^user:/i, "");
    if (numericPart === groupId || normalizedTo === groupId) {
        return stored;
    }
    return to;
}
