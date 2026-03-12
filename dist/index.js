/**
 * OpenClaw OneBot Channel Plugin
 *
 * 将 OneBot v11 协议（QQ/Lagrange.Core/go-cqhttp）接入 OpenClaw Gateway。
 *
 * 发送逻辑（参照飞书实现）：
 * - 由 OpenClaw 主包解析 `openclaw message send --channel onebot ...` 命令
 * - 根据 --channel 查找已注册的 onebot 渠道，调用其 outbound.sendText / outbound.sendMedia
 * - 同时注册 onebot_* Agent 工具（发文本/图片、上传文件、取群历史等）
 * - Agent 普通回复仍由 process-inbound 的 deliver 自动发送
 */
import { OneBotChannelPlugin } from "./channel.js";
import { registerService } from "./service.js";
import { startImageTempCleanup } from "./connection.js";
import { startForwardCleanupTimer } from "./handlers/process-inbound.js";
import { registerTools } from "./tools.js";
export default function register(api) {
    globalThis.__onebotApi = api;
    globalThis.__onebotGatewayConfig = api.config;
    startImageTempCleanup();
    startForwardCleanupTimer();
    registerTools(api);
    api.registerChannel({ plugin: OneBotChannelPlugin });
    if (typeof api.registerCli === "function") {
        api.registerCli((ctx) => {
            const prog = ctx.program;
            if (prog && typeof prog.command === "function") {
                const onebot = prog.command("onebot").description("OneBot 渠道配置");
                onebot.command("setup").description("交互式配置 OneBot 连接参数").action(async () => {
                    const { runOneBotSetup } = await import("./setup.js");
                    await runOneBotSetup();
                });
                onebot.command("bootstrap-personas").description("安装预设的 onebot persona agents（life-normal / gentle / laoge / lezige）").action(async () => {
                    const { runOneBotPersonaBootstrap } = await import("./bootstrap.js");
                    await runOneBotPersonaBootstrap();
                });
            }
        }, { commands: ["onebot"] });
    }
    registerService(api);
    api.logger?.info?.("[onebot] plugin loaded");
}
