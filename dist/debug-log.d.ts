/**
 * 调试日志：写入文件，便于追踪 sendMedia / sendText 调用链
 * 开发模式下生效（NODE_ENV !== 'production'）
 * 日志路径：process.cwd()/openclaw-onebot-debug.log
 */
export declare function isDevLogEnabled(): boolean;
export declare function debugLog(layer: string, msg: string, data?: Record<string, unknown>): void;
