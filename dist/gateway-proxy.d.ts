/**
 * 当 openclaw message send 在独立进程运行（无 WebSocket）时，
 * 通过 Gateway HTTP API /tools/invoke 代理发送
 */
export declare function invokeGatewayTool(cfg: Record<string, unknown>, tool: string, args: Record<string, unknown>): Promise<{
    ok: boolean;
    error?: string;
}>;
