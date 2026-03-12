/**
 * OneBot 消息解析
 */
import type { OneBotMessage } from "./types.js";
/** 从消息段数组中提取引用/回复的消息 ID（OneBot reply 段） */
export declare function getReplyMessageId(msg: OneBotMessage): number | undefined;
/** 从 get_msg 返回的 message 字段中提取文本和图片链接（供 AI 理解引用内容） */
export declare function getTextFromMessageContent(content: string | unknown[] | undefined): string;
export declare function getTextFromMessageContentWithoutMedia(content: string | unknown[] | undefined): string;
/** 仅从 message 段数组提取 text 段（不含 raw_message，用于有引用时避免 CQ 码） */
export declare function getTextFromSegments(msg: OneBotMessage): string;
export declare function getRawText(msg: OneBotMessage): string;
export declare function getImageSegments(msg: OneBotMessage): Array<{
    url?: string;
    file?: string;
    path?: string;
    mime?: string;
    index: number;
}>;
export declare function isMentioned(msg: OneBotMessage, selfId: number): boolean;
