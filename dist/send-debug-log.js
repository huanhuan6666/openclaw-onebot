/**
 * 发送调试日志：记录所有文字/媒体发送相关的关键信息，便于排查
 * 日志路径：项目根目录的绝对路径 send-debug.log
 * 启用：设置环境变量 OPENCLAW_ONEBOT_SEND_DEBUG=1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 绝对路径：openclaw-onebot/send-debug.log，运行前设置 OPENCLAW_ONEBOT_SEND_DEBUG=1 启用 */
export const SEND_DEBUG_LOG_PATH = path.resolve(__dirname, "..", "send-debug.log");
function isEnabled() {
    return process.env.OPENCLAW_ONEBOT_SEND_DEBUG === "1";
}
let sessionLogged = false;
export function logSend(layer, fn, data) {
    if (!isEnabled())
        return;
    try {
        if (!sessionLogged) {
            fs.appendFileSync(SEND_DEBUG_LOG_PATH, `${new Date().toISOString()} [session] 日志路径(绝对): ${SEND_DEBUG_LOG_PATH}\n`);
            sessionLogged = true;
        }
        const line = `${new Date().toISOString()} [${layer}] ${fn} ${JSON.stringify(data)}\n`;
        fs.appendFileSync(SEND_DEBUG_LOG_PATH, line);
    }
    catch (_) { }
}
