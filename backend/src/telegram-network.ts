import { SocksProxyAgent } from "socks-proxy-agent";
import { createConnection, isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";
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
export type TelegramTiming = {
  connectMs: number;
  requestSeconds: number;
  pollSeconds: number;
};
export function telegramTiming(
  env: NodeJS.ProcessEnv = process.env,
): TelegramTiming {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = env[key];
    const n = raw ? Number(raw) : fallback;
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error("Invalid Telegram timing configuration");
    return n;
  };
  const timing = {
    connectMs: integer("TELEGRAM_CONNECT_TIMEOUT_MS", 10000, 100, 60000),
    requestSeconds: integer("TELEGRAM_REQUEST_TIMEOUT_SECONDS", 45, 5, 120),
    pollSeconds: integer("TELEGRAM_POLL_TIMEOUT_SECONDS", 15, 1, 50),
  };
  if (
    timing.requestSeconds < timing.pollSeconds + 10 ||
    timing.connectMs >= timing.requestSeconds * 1000
  )
    throw new Error(
      "Telegram request deadline must exceed poll and connect deadlines",
    );
  return timing;
}
// socks-proxy-agent 10 applies opts.timeout again as a post-connect socket idle
// timer. Separate the SOCKS handshake from HTTP/TLS: an idle getUpdates is valid.
export class TelegramSocksAgent extends SocksProxyAgent {
  override async connect(
    req: Parameters<SocksProxyAgent["connect"]>[0],
    opts: Parameters<SocksProxyAgent["connect"]>[1],
  ) {
    const socket = await super.connect(req, { ...opts, secureEndpoint: false });
    socket.setTimeout(0);
    if (req.destroyed) {
      socket.destroy();
      throw Object.assign(new Error("Request aborted"), { name: "AbortError" });
    }
    if (!opts.secureEndpoint) return socket;
    const { host, path, port, ...tlsOptions } = opts;
    const secure = tlsConnect({
      ...tlsOptions,
      socket,
      servername: opts.servername ?? (host && !isIP(host) ? host : undefined),
    });
    secure.once("error", () => socket.destroy());
    return secure;
  }
}
export function telegramClient(
  raw: string,
  timing = telegramTiming(),
): BotConfig<Context>["client"] {
  const u = proxyAddress(raw);
  return {
    timeoutSeconds: timing.requestSeconds,
    sensitiveLogs: false,
    ...(u
      ? {
          baseFetchConfig: {
            agent: new TelegramSocksAgent(u, {
              timeout: timing.connectMs,
              keepAlive: false,
            }),
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
