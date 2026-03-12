/**
 * OneBot 消息发送 — 文本与媒体
 * 对应 Lagrange.onebot context.ts 的 sendPrivateMsg / sendGroupMsg / 图片消息
 */
export interface OneBotSendResult {
    ok: boolean;
    messageId?: string;
    error?: string;
}
import type { OneBotAccountConfig } from "./types.js";
type OneBotConfigGetter = () => OneBotAccountConfig | null;
/**
 * 发送文本消息到 OneBot 目标（私聊或群聊）
 * @param getConfig 可选，用于按需连接（forward-websocket 下 message send 可独立运行）
 * @param cfg 可选，用于读取 renderMarkdownToPlain 配置
 */
export declare function sendTextMessage(to: string, text: string, getConfig?: OneBotConfigGetter, cfg?: {
    channels?: {
        onebot?: {
            renderMarkdownToPlain?: boolean;
        };
    };
}): Promise<OneBotSendResult>;
/**
 * 发送媒体消息（图片等）到 OneBot 目标
 * mediaUrl 支持 file:// 路径、http(s):// URL、base64://
 * @param getConfig 可选，用于按需连接
 * @param cfg 可选，用于读取 renderMarkdownToPlain 配置
 */
export declare function sendMediaMessage(to: string, mediaUrl: string, text?: string, getConfig?: OneBotConfigGetter, cfg?: {
    channels?: {
        onebot?: {
            renderMarkdownToPlain?: boolean;
        };
    };
}): Promise<OneBotSendResult>;
export {};
