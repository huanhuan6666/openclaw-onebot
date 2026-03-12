/**
 * 入站消息处理
 */
import type { OneBotMessage } from "../types.js";
export declare const sessionHistories: Map<string, {
    sender: string;
    body: string;
    timestamp: number;
    messageId: string;
}[]>;
export declare function startForwardCleanupTimer(): void;
export declare function processInboundMessage(api: any, msg: OneBotMessage): Promise<void>;
/** 回复会话上下文，供 onReplySessionEnd 钩子使用 */
export interface ReplySessionContext {
    /** 本次回复会话的唯一 ID，同一用户问题下的多次 deliver 共享此 ID */
    replySessionId: string;
    /** 会话标识，如 onebot:group:123 或 onebot:456 */
    sessionId: string;
    /** 回复目标，如 onebot:group:123 或 onebot:456 */
    to: string;
    /** 本次回复中已发送的所有块（按顺序） */
    chunks: Array<{
        index: number;
        text?: string;
        mediaUrl?: string;
    }>;
    /** 用户原始消息 */
    userMessage: string;
}
