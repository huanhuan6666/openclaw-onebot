/**
 * OneBot Channel 插件定义
 * 仿照 openclaw-feishu channel.ts 结构，接入 OneBot v11 协议（QQ/Lagrange.Core/go-cqhttp）
 *
 * 对应 Lagrange.onebot context.ts 的 API：
 * - sendPrivateMsg / sendGroupMsg / sendMsg
 * - sendGroupImage / sendPrivateImage（图片）
 * - deleteMsg / getMsg / getGroupMsgHistory
 * - uploadGroupFile / uploadPrivateFile
 */
declare function normalizeOneBotMessagingTarget(raw: string): string | undefined;
export declare const OneBotChannelPlugin: {
    id: string;
    meta: {
        id: string;
        label: string;
        selectionLabel: string;
        docsPath: string;
        blurb: string;
        aliases: string[];
        docsLabel: string;
        order: number;
    };
    capabilities: {
        chatTypes: readonly ["direct", "group"];
        media: boolean;
        reactions: boolean;
        threads: boolean;
        polls: boolean;
    };
    reload: {
        configPrefixes: readonly ["channels.onebot"];
    };
    config: {
        listAccountIds: (cfg: any) => string[];
        resolveAccount: (cfg: any, accountId?: string) => any;
    };
    groups: {
        resolveRequireMention: () => boolean;
    };
    messaging: {
        normalizeTarget: typeof normalizeOneBotMessagingTarget;
        targetResolver: {
            looksLikeId: (raw: string) => boolean;
            hint: string;
        };
    };
    outbound: {
        deliveryMode: "direct";
        chunker: (text: string, limit: number) => string[];
        chunkerMode: "text";
        textChunkLimit: number;
        resolveTarget: ({ to }: {
            to?: string;
        }) => {
            ok: boolean;
            error: Error;
            to?: undefined;
        } | {
            ok: boolean;
            to: string;
            error?: undefined;
        };
        sendText: ({ to, text, accountId, cfg }: {
            to: string;
            text: string;
            accountId?: string;
            cfg?: any;
        }) => Promise<{
            channel: string;
            ok: boolean;
            messageId: string;
            error: Error;
        } | {
            channel: string;
            ok: boolean;
            messageId: string;
            error?: undefined;
        }>;
        sendMedia: (params: {
            to: string;
            text?: string;
            mediaUrl?: string;
            media?: string;
            accountId?: string;
            cfg?: any;
        }) => Promise<{
            channel: string;
            ok: boolean;
            messageId: string;
            error: Error;
        } | {
            channel: string;
            ok: boolean;
            messageId: string;
            error?: undefined;
        }>;
    };
};
export {};
