/**
 * 当前回复目标上下文
 * 当 process-inbound 处理群聊消息时设置，channel.sendMedia 可用其修正错误的 target
 * （Agent 可能传入裸数字或 user:xxx，导致误发私聊）
 */
export declare function setActiveReplyTarget(to: string): void;
export declare function setActiveReplySelfId(selfId: number | null): void;
export declare function getActiveReplySelfId(): number | null;
export declare function setActiveReplyMessageId(messageId: number | null): void;
export declare function getActiveReplyMessageId(): number | null;
export declare function consumeActiveReplyMessageId(): number | null;
export declare function setForwardSuppressDelivery(suppress: boolean): void;
export declare function getForwardSuppressDelivery(): boolean;
export declare function clearActiveReplyTarget(): void;
export declare function getActiveReplyTarget(): string | null;
/**
 * 回复会话 ID：同一用户问题下，AI 的多次 deliver 调用共享此 ID，便于统一处理
 * 在 processInboundMessage 开始 dispatch 时设置，结束时清除
 */
export declare function setActiveReplySessionId(id: string | null): void;
export declare function getActiveReplySessionId(): string | null;
/** 判断 to 是否与当前回复目标相同（用于 forward 模式下拦截 outbound 自动发送） */
export declare function isTargetActiveReply(to: string): boolean;
/**
 * forward 模式下：发往用户（非 selfId）的普通消息应被拦截，只保留发给自己（构建转发）和最终的合并转发
 * @param type "private" | "group"
 * @param targetId 目标 ID（userId 或 groupId）
 * @returns true 表示应拦截，不发送
 */
export declare function shouldBlockSendInForwardMode(type: "private" | "group", targetId: number): boolean;
/**
 * 若当前有活跃群聊回复目标，且传入的 to 可能被误判为私聊（裸数字或 user:xxx 与群号相同），则返回修正后的 target
 */
export declare function resolveTargetForReply(to: string): string;
