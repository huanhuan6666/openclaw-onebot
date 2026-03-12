/**
 * 调试日志：写入文件，便于追踪 sendMedia / sendText 调用链
 * 开发模式下生效（NODE_ENV !== 'production'）
 * 日志路径：process.cwd()/openclaw-onebot-debug.log
 */
import fs from "node:fs";
import path from "node:path";
function getLogPath() {
    return path.join(process.cwd(), "openclaw-onebot-debug.log");
}
export function isDevLogEnabled() {
    if (process.env.OPENCLAW_ONEBOT_DEBUG === "1")
        return true;
    return process.env.NODE_ENV !== "production";
}
export function debugLog(layer, msg, data) {
    if (!isDevLogEnabled())
        return;
    try {
        const line = `${new Date().toISOString()} [${layer}] ${msg}${data ? " " + JSON.stringify(data) : ""}\n`;
        fs.appendFileSync(getLogPath(), line);
    }
    catch (_) { }
}
