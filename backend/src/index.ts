import "dotenv/config";
import { openDb } from "./db.js";
import { createApp } from "./app.js";
import { makeBot } from "./bot.js";
import { TelegramRuntime } from "./telegram-runtime.js";
import { probeProxy, telegramTiming } from "./telegram-network.js";
import { acquireBotLock } from "./bot-lock.js";
import { deploymentId, EndpointMonitor } from "./deployment.js";
import { log, safeError } from "./safe-log.js";
const production = process.env.NODE_ENV === "production",
  devAuth = process.env.DEV_AUTH === "true";
const token = process.env.BOT_TOKEN ?? "",
  url = process.env.APP_URL ?? "",
  proxy = process.env.TELEGRAM_PROXY_URL ?? "";
let publicOrigin: string | undefined;
try {
  const u = new URL(url);
  if (
    u.protocol === "https:" &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash &&
    u.pathname === "/"
  )
    publicOrigin = u.origin;
} catch {}
const enabled = Boolean(token) && process.env.BOT_ENABLED !== "false";
const db = openDb(process.env.DATABASE_PATH ?? "./data/slopemate.sqlite");
const identity = deploymentId(
  process.env.DATABASE_PATH ?? "./data/slopemate.sqlite",
  process.env.DEPLOYMENT_ID,
);
const endpoint = url ? new EndpointMonitor(url, identity) : undefined;
let runtime: TelegramRuntime | undefined;
let botConfigError = false;
const app = createApp(db, {
  production,
  deploymentId: identity,
  endpoint: () =>
    endpoint?.status ?? {
      state: "unknown",
      checkedAt: null,
      lastSuccessAt: null,
    },
  diagnosticsToken: process.env.DIAGNOSTICS_TOKEN,
  devAuth,
  token,
  origins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .filter(Boolean)
    .concat(publicOrigin ? [publicOrigin] : []),
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  status: () =>
    runtime?.status ?? {
      bot: botConfigError ? "failed" : "disabled",
      api: "unknown",
      proxy: proxy ? "configured" : "direct",
    },
});
const server = app.listen(
  Number(process.env.PORT ?? 3001),
  process.env.HOST ?? "127.0.0.1",
  () => {
    log(
      "http",
      `SlopeMate API ready on port ${process.env.PORT ?? 3001}; local auth: ${devAuth}`,
    );
    endpoint?.start();
    if (enabled) {
      try {
        const origin = new URL(url);
        if (
          origin.protocol !== "https:" ||
          origin.username ||
          origin.password ||
          origin.search ||
          origin.hash ||
          origin.pathname !== "/"
        )
          throw new Error("APP_URL must be an HTTPS origin");
        const bot = makeBot(token, url, db, proxy);
        runtime = new TelegramRuntime(bot, url, {
          probe: proxy ? (s) => probeProxy(proxy, s) : undefined,
          pollSeconds: telegramTiming().pollSeconds,
          acquire: () => acquireBotLock(token, process.env.BOT_LOCK_DIRECTORY),
        });
        void runtime.start();
      } catch (e) {
        botConfigError = true;
        log(
          "telegram",
          `${safeError(e)}; invalid APP_URL, TELEGRAM_PROXY_URL or Telegram timing configuration. HTTP remains available.`,
        );
      }
    } else log("telegram", "Bot disabled; HTTP remains available.");
  },
);
server.on("error", (e) => {
  log("http", safeError(e));
  db.close();
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  log("shutdown", "Stopping owned HTTP and Telegram components.");
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();
  try {
    await Promise.all([runtime?.stop(), endpoint?.stop()]);
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
    db.close();
    clearTimeout(force);
    process.exitCode = 0;
  } catch (e) {
    log("shutdown", safeError(e));
    process.exitCode = 1;
  }
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void shutdown();
  });
process.on("message", (message) => {
  if (message === "shutdown")
    void shutdown().finally(() =>
      process.connected ? process.disconnect() : undefined,
    );
});
