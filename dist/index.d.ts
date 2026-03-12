/**
 * OpenClaw OneBot Channel Plugin
 *
 * 将 OneBot v11 协议（QQ/Lagrange.Core/go-cqhttp）接入 OpenClaw Gateway。
 *
 * 发送逻辑（参照飞书实现）：
 * - 由 OpenClaw 主包解析 `openclaw message send --channel onebot ...` 命令
 * - 根据 --channel 查找已注册的 onebot 渠道，调用其 outbound.sendText / outbound.sendMedia
 * - 不注册 Agent 工具，避免重复实现；Agent 回复时由 process-inbound 的 deliver 自动发送
 */
export default function register(api: any): void;
