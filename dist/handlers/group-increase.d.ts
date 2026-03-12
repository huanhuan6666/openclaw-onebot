/**
 * 新成员入群欢迎
 *
 * 支持：
 * 1. 简单文本模板（message），占位符：{name}、{userId}、{groupName}、{groupId}、{avatarUrl}
 * 2. 自定义 command：在 cwd 下用系统 shell 执行命令，通过环境变量传入上下文
 *    命令自行负责发送（如调用 openclaw message send），或向 stdout 输出 JSON 行供本 handler 发送
 */
import type { OneBotMessage } from "../types.js";
export interface GroupIncreaseContext {
    groupId: number;
    groupName: string;
    userId: number;
    userName: string;
    avatarUrl: string;
}
export interface GroupIncreaseResult {
    text?: string;
    imagePath?: string;
    imageUrl?: string;
}
export declare function handleGroupIncrease(api: any, msg: OneBotMessage): Promise<void>;
