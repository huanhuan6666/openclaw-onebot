/**
 * 当 openclaw message send 在独立进程运行（无 WebSocket）时，
 * 通过 Gateway HTTP API /tools/invoke 代理发送
 */
export async function invokeGatewayTool(cfg, tool, args) {
    const gw = cfg?.gateway;
    const port = gw?.port ?? 18789;
    const bind = gw?.bind ?? "loopback";
    const host = bind === "loopback" ? "127.0.0.1" : "0.0.0.0";
    const auth = gw?.auth;
    const token = auth?.token;
    const url = `http://${host}:${port}/tools/invoke`;
    const headers = { "Content-Type": "application/json" };
    if (token)
        headers["Authorization"] = `Bearer ${token}`;
    try {
        const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ tool, action: "json", args }),
        });
        if (!res.ok) {
            return { ok: false, error: `Gateway API ${res.status}: ${await res.text().catch(() => "")}` };
        }
        const data = (await res.json().catch(() => ({})));
        if (data?.error)
            return { ok: false, error: data.error };
        return { ok: true };
    }
    catch (e) {
        return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
        };
    }
}
