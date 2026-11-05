import { SocksProxyAgent } from "socks-proxy-agent";
import { createConnection } from "node:net";
import type { BotConfig, Context } from "grammy";
export function proxyAddress(raw: string): URL | null {
  if (!raw.trim()) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("TELEGRAM_PROXY_URL: invalid URL");
  }
  if (
    !["socks5:", "socks5h:"].includes(u.protocol) ||
    !u.hostname ||
    !u.port ||
    (u.pathname && u.pathname !== "/") ||
    u.search ||
    u.hash
  )
    throw new Error(
      "TELEGRAM_PROXY_URL: expected socks5://host:port or socks5h://host:port",
    );
  return u;
}
export function telegramClient(raw: string): BotConfig<Context>["client"] {
  const u = proxyAddress(raw);
  return {
    timeoutSeconds: 45,
    sensitiveLogs: false,
    ...(u
      ? {
          baseFetchConfig: {
            agent: new SocksProxyAgent(u, { timeout: 10000 }),
          },
        }
      : {}),
  };
}
// TCP readiness only; an open port is not proof of a working SOCKS handshake or Telegram access.
export async function probeProxy(
  raw: string,
  signal?: AbortSignal,
  timeout = 3000,
): Promise<void> {
  const u = proxyAddress(raw);
  if (!u) return;
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({
      host: u.hostname.replace(/^\[|\]$/g, ""),
      port: Number(u.port),
    });
    const done = (err?: Error) => {
      socket.destroy();
      signal?.removeEventListener("abort", abort);
      err ? reject(err) : resolve();
    };
    const abort = () =>
      done(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    socket.setTimeout(timeout, () =>
      done(Object.assign(new Error("Proxy timeout"), { code: "ETIMEDOUT" })),
    );
    socket.once("error", done);
    socket.once("connect", () => done());
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
