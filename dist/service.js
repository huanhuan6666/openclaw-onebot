/**
 * OneBot WebSocket 服务
 */
import { getOneBotConfig } from "./config.js";
import { connectForward, createServerAndWait, setWs, stopConnection, handleEchoResponse, startImageTempCleanup, stopImageTempCleanup } from "./connection.js";
import { processInboundMessage } from "./handlers/process-inbound.js";
import { handleGroupIncrease } from "./handlers/group-increase.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
export function registerService(api) {
    api.registerService({
        id: "onebot-ws",
        start: async () => {
            const config = getOneBotConfig(api);
            if (!config) {
                api.logger?.warn?.("[onebot] no config, service will not connect");
                return;
            }
            try {
                let ws;
                if (config.type === "forward-websocket") {
                    ws = await connectForward(config);
                }
                else {
                    ws = await createServerAndWait(config);
                }
                setWs(ws);
                api.logger?.info?.("[onebot] WebSocket connected");
                startImageTempCleanup();
                startScheduler(api);
                ws.on("message", (data) => {
                    try {
                        const payload = JSON.parse(data.toString());
                        if (handleEchoResponse(payload))
                            return;
                        if (payload.meta_event_type === "heartbeat")
                            return;
                        const msg = payload;
                        if (msg.post_type === "message" && (msg.message_type === "private" || msg.message_type === "group")) {
                            processInboundMessage(api, msg).catch((e) => {
                                api.logger?.error?.(`[onebot] processInboundMessage: ${e?.message}`);
                            });
                        }
                        else if (msg.post_type === "notice" && msg.notice_type === "group_increase") {
                            handleGroupIncrease(api, msg).catch((e) => {
                                api.logger?.error?.(`[onebot] handleGroupIncrease: ${e?.message}`);
                            });
                        }
                    }
                    catch (e) {
                        api.logger?.error?.(`[onebot] parse message: ${e?.message}`);
                    }
                });
                ws.on("close", () => {
                    api.logger?.info?.("[onebot] WebSocket closed");
                });
                ws.on("error", (e) => {
                    api.logger?.error?.(`[onebot] WebSocket error: ${e?.message}`);
                });
            }
            catch (e) {
                api.logger?.error?.(`[onebot] start failed: ${e?.message}`);
            }
        },
        stop: async () => {
            stopImageTempCleanup();
            stopScheduler();
            stopConnection();
            api.logger?.info?.("[onebot] service stopped");
        },
    });
}
