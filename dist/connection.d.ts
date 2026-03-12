/**
 * OneBot WebSocket 连接与 API 调用
 *
 * 图片消息：网络 URL 会先下载到本地再发送（兼容 Lagrange.Core retcode 1200），
 * 并定期清理临时文件。
 */
import WebSocket from "ws";
import type { OneBotAccountConfig } from "./types.js";
/** 启动临时图片定期清理（每小时执行一次） */
export declare function startImageTempCleanup(): void;
/** 停止临时图片定期清理 */
export declare function stopImageTempCleanup(): void;
export declare function handleEchoResponse(payload: any): boolean;
export declare function rememberRecentMface(type: "user" | "group", targetId: number, mface: {
    type?: string;
    emoji_id?: string;
    emoji_package_id?: string;
    url?: string;
    file?: string;
    path?: string;
    sub_type?: number;
    key?: string;
    summary?: string;
}): void;
export declare function getRecentMfaceByIndex(type: "user" | "group", targetId: number, index: number): {
    kind: "mface";
    emoji_id: string;
    emoji_package_id: string;
    key?: string;
    summary?: string;
} | {
    kind: "image";
    image: string;
    summary?: string;
} | undefined;
export declare function listRecentMface(type: "user" | "group", targetId: number, limit?: number): Array<{
    kind: "mface";
    emoji_id: string;
    emoji_package_id: string;
    key?: string;
    summary?: string;
} | {
    kind: "image";
    image: string;
    summary?: string;
}>;
export declare function getLastSentMessageId(type: "user" | "group", targetId: number): number | undefined;
export declare function rememberLastInboundMessage(type: "user" | "group", targetId: number, messageId: number): void;
export declare function getLastInboundMessageId(type: "user" | "group", targetId: number): number | undefined;
/** 获取账号收藏表情列表（NapCat 扩展 API: fetch_custom_face） */
export declare function fetchCustomFace(count?: number): Promise<any[]>;
export declare function getWs(): WebSocket | null;
/** 等待 WebSocket 连接就绪（service 启动后异步建立连接，发送前需先等待） */
export declare function waitForConnection(timeoutMs?: number): Promise<WebSocket>;
/**
 * 确保有可用的 WebSocket 连接。当 service 未启动时，
 * forward-websocket 模式直接建立连接（message send 可独立运行）；
 * backward-websocket 模式需等待 gateway 的 service 建立连接。
 */
export declare function ensureConnection(getConfig: () => OneBotAccountConfig | null, timeoutMs?: number): Promise<WebSocket>;
export declare function sendPrivateMsg(userId: number, text: string, getConfig?: () => OneBotAccountConfig | null): Promise<number | undefined>;
export declare function sendGroupMsg(groupId: number, text: string, getConfig?: () => OneBotAccountConfig | null, replyMessageId?: number | null): Promise<number | undefined>;
/** 发送 QQ 标准表情（face） */
export declare function sendGroupFace(groupId: number, faceId: number, getConfig?: () => OneBotAccountConfig | null): Promise<number | undefined>;
/** 发送 QQ 标准表情（face） */
export declare function sendPrivateFace(userId: number, faceId: number, getConfig?: () => OneBotAccountConfig | null): Promise<number | undefined>;
/** 发送 QQ 商城/收藏表情（mface） */
export declare function sendGroupMface(groupId: number, mface: {
    emoji_id: string;
    emoji_package_id: string;
    key?: string;
    summary?: string;
}, getConfig?: () => OneBotAccountConfig | null): Promise<number | undefined>;
/** 发送 QQ 商城/收藏表情（mface） */
export declare function sendPrivateMface(userId: number, mface: {
    emoji_id: string;
    emoji_package_id: string;
    key?: string;
    summary?: string;
}, getConfig?: () => OneBotAccountConfig | null): Promise<number | undefined>;
export declare function sendGroupImage(groupId: number, image: string, log?: {
    info?: (s: string) => void;
    warn?: (s: string) => void;
}, getConfig?: () => OneBotAccountConfig | null): Promise<number | undefined>;
/** 发送群合并转发消息。messages 为节点数组，每节点 { type: "node", data: { id } } 或 { type: "node", data: { user_id, nickname, content } } */
export declare function sendGroupForwardMsg(groupId: number, messages: Array<{
    type: string;
    data: Record<string, unknown>;
}>, getConfig?: () => OneBotAccountConfig | null): Promise<void>;
/** 发送私聊合并转发消息 */
export declare function sendPrivateForwardMsg(userId: number, messages: Array<{
    type: string;
    data: Record<string, unknown>;
}>, getConfig?: () => OneBotAccountConfig | null): Promise<void>;
export declare function sendPrivateImage(userId: number, image: string, log?: {
    info?: (s: string) => void;
    warn?: (s: string) => void;
}, getConfig?: () => OneBotAccountConfig | null): Promise<number | undefined>;
export declare function uploadGroupFile(groupId: number, file: string, name: string): Promise<void>;
export declare function uploadPrivateFile(userId: number, file: string, name: string): Promise<void>;
/** 撤回消息 */
export declare function deleteMsg(messageId: number): Promise<void>;
/**
 * 对消息进行表情回应（Lagrange/QQ NT 扩展 API）
 * @param message_id 需要回应的消息 ID（用户发送的消息）
 * @param emoji_id 表情 ID，1 通常为点赞
 * @param is_set true 添加，false 取消
 */
export declare function setMsgEmojiLike(message_id: number, emoji_id: number, is_set?: boolean): Promise<void>;
/** 获取陌生人信息（含 nickname） */
export declare function getStrangerInfo(userId: number): Promise<{
    nickname: string;
} | null>;
/** 获取群成员信息（含 nickname、card） */
export declare function getGroupMemberInfo(groupId: number, userId: number): Promise<{
    nickname: string;
    card: string;
} | null>;
/** 获取群信息（含 group_name） */
export declare function getGroupInfo(groupId: number): Promise<{
    group_name: string;
} | null>;
/** QQ 头像 URL，s=640 为常用尺寸 */
export declare function getAvatarUrl(userId: number, size?: number): string;
/** 获取单条消息（需 OneBot 实现支持） */
export declare function getMsg(messageId: number): Promise<{
    time: number;
    message_type: string;
    message_id: number;
    real_id: number;
    sender: {
        user_id?: number;
        nickname?: string;
    };
    message: string | unknown[];
} | null>;
/**
 * 获取群聊历史消息（Lagrange.Core 扩展 API，go-cqhttp 等可能不支持）
 * @param groupId 群号
 * @param opts message_seq 起始序号；message_id 起始消息 ID；count 数量
 */
export declare function getGroupMsgHistory(groupId: number, opts?: {
    message_seq?: number;
    message_id?: number;
    count: number;
}): Promise<Array<{
    time: number;
    message_type: string;
    message_id: number;
    real_id: number;
    sender: {
        user_id?: number;
        nickname?: string;
    };
    message: string | unknown[];
}>>;
export declare function connectForward(config: OneBotAccountConfig): Promise<WebSocket>;
export declare function createServerAndWait(config: OneBotAccountConfig): Promise<WebSocket>;
export declare function setWs(socket: WebSocket | null): void;
export declare function stopConnection(): void;
