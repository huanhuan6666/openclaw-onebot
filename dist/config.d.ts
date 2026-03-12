/**
 * OneBot 配置解析
 */
import type { OneBotAccountConfig } from "./types.js";
export declare function getOneBotConfig(api: any, accountId?: string): OneBotAccountConfig | null;
/** 是否将机器人回复中的 Markdown 渲染为纯文本再发送，默认 true */
export declare function getRenderMarkdownToPlain(cfg: any): boolean;
/** 是否将连续多个换行压缩为单个换行，默认 true（AI 常输出 \n\n 导致双空行） */
export declare function getCollapseDoubleNewlines(cfg: any): boolean;
/** 白名单 QQ 号列表，为空则所有人可回复；非空则仅白名单内用户可触发 AI */
export declare function getWhitelistUserIds(cfg: any): number[];
export declare function listAccountIds(apiOrCfg: any): string[];
