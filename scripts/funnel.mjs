export function parseFunnelStatus(status, port = 3001) {
  if (!status || typeof status !== "object") return null;
  const validProxy = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}/`,
    `http://localhost:${port}/`,
  ]);
  for (const [host, web] of Object.entries(status.Web ?? {})) {
    if (!status.AllowFunnel?.[host] || !host.endsWith(":443")) continue;
    const handlers = web?.Handlers;
    const handler = handlers?.["/"];
    if (!validProxy.has(handler?.Proxy)) continue;
    const origin = "https://" + host.slice(0, -4);
    try {
      const u = new URL(origin);
      if (u.hostname.endsWith(".ts.net") && !u.username && !u.password)
        return u.origin;
    } catch {}
  }
  return null;
}
