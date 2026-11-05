import type { Bot } from "grammy";
import { setTimeout as sleep } from "node:timers/promises";
import { safeError, log, type Logger } from "./safe-log.js";
export type TelegramStatus = {
  bot: "disabled" | "starting" | "polling" | "retrying" | "stopped" | "failed";
  api: "unknown" | "ready" | "unreachable";
  proxy: "direct" | "configured" | "tcp-ready" | "unreachable";
  setup: "pending" | "ready" | "failed";
  failures: number;
  retryInMs: number;
  lastError?: string;
};
export const retryDelay = (failure: number) =>
  Math.min(30000, 1000 * 2 ** Math.min(Math.max(0, failure - 1), 5));
const fatal = (e: unknown) =>
  [400, 401, 403, 409].includes(
    Number((e as { error_code?: number })?.error_code),
  );
type ApiSignal = NonNullable<Parameters<Bot["api"]["getMe"]>[0]>;
export class TelegramRuntime {
  readonly status: TelegramStatus = {
    bot: "disabled",
    api: "unknown",
    proxy: "direct",
    setup: "pending",
    failures: 0,
    retryInMs: 0,
  };
  private controller = new AbortController();
  private task?: Promise<void>;
  private offset = 0;
  constructor(
    private bot: Bot,
    private url: string,
    private options: {
      probe?: (signal: AbortSignal) => Promise<void>;
      logger?: Logger;
      wait?: (ms: number, signal: AbortSignal) => Promise<void>;
      maxFailures?: number;
    } = {},
  ) {
    if (options.probe) this.status.proxy = "configured";
    // Also abort ctx.reply and other handler requests during shutdown.
    bot.api.config.use((prev, method, payload, signal) =>
      prev(
        method,
        payload,
        signal ?? (this.controller.signal as unknown as ApiSignal),
      ),
    );
  }
  start() {
    if (this.task) return this.task;
    this.status.bot = "starting";
    this.task = this.run().catch((e) => {
      if (!this.controller.signal.aborted) {
        this.status.bot = "failed";
        this.status.lastError = safeError(e);
        (this.options.logger ?? log)("telegram", safeError(e));
      }
    });
    return this.task;
  }
  async stop() {
    this.controller.abort();
    await this.task;
    this.status.bot = "stopped";
    this.status.retryInMs = 0;
  }
  private async run() {
    const signal = this.controller.signal,
      logger = this.options.logger ?? log;
    const wait =
      this.options.wait ?? ((ms, s) => sleep(ms, undefined, { signal: s }));
    // grammY types use the legacy abort-controller shim; Node 24's native signal
    // supports the runtime contract required by node-fetch. Keep the type bridge here.
    const apiSignal = signal as unknown as ApiSignal;
    const retry = async (e: unknown) => {
      if (signal.aborted) return false;
      this.status.api = "unreachable";
      this.status.lastError = safeError(e);
      this.status.failures++;
      if (fatal(e) || this.status.failures >= (this.options.maxFailures ?? 6)) {
        this.status.bot = "failed";
        this.status.retryInMs = 0;
        logger(
          "telegram",
          `${safeError(e)}; stopped after ${this.status.failures} failure(s). HTTP remains available. Check proxy/token, webhook or duplicate poller; restart explicitly.`,
        );
        return false;
      }
      const retryAfter = Number(
        (e as { parameters?: { retry_after?: number } })?.parameters
          ?.retry_after,
      );
      // Respect Telegram rate-limit instructions, but never wait indefinitely.
      if (Number.isFinite(retryAfter) && retryAfter > 300) {
        this.status.bot = "failed";
        logger(
          "telegram",
          "Rate limit requires more than 300 seconds; restart later. HTTP remains available.",
        );
        return false;
      }
      const delay = Math.max(
        retryDelay(this.status.failures),
        Number.isFinite(retryAfter) ? Math.max(0, retryAfter) * 1000 : 0,
      );
      this.status.bot = "retrying";
      this.status.retryInMs = delay;
      logger(
        "telegram",
        `${safeError(e)}; retry in ${delay} ms. HTTP remains available.`,
      );
      try {
        await wait(delay, signal);
      } catch {
        return false;
      }
      this.status.retryInMs = 0;
      return !signal.aborted;
    };
    // All setup and polling calls use the same grammY client/agent. Avoid bot.init/start's internal unbounded retries.
    let initialized = false;
    while (!signal.aborted && !initialized) {
      try {
        if (this.options.probe) {
          try {
            await this.options.probe(signal);
            this.status.proxy = "tcp-ready";
          } catch (e) {
            this.status.proxy = "unreachable";
            throw e;
          }
        }
        this.bot.botInfo = await this.bot.api.getMe(apiSignal);
        const info = await this.bot.api.getWebhookInfo(apiSignal);
        if (info.url)
          throw Object.assign(new Error("Webhook configured"), {
            error_code: 409,
          });
        this.status.api = "ready";
        this.status.failures = 0;
        initialized = true;
      } catch (e) {
        if (!(await retry(e))) return;
      }
    }
    if (signal.aborted) return;
    // Setup failures do not prevent useful polling. They are bounded separately and visible in status.
    let setupOK = false;
    for (let attempt = 1; attempt <= 3 && !signal.aborted; attempt++) {
      try {
        await this.bot.api.setMyCommands(
          [
            { command: "start", description: "Открыть SlopeMate" },
            { command: "help", description: "Помощь" },
            { command: "stats", description: "Моя статистика" },
          ],
          {},
          apiSignal,
        );
        await this.bot.api.setChatMenuButton(
          {
            menu_button: {
              type: "web_app",
              text: "SlopeMate",
              web_app: { url: this.url },
            },
          },
          apiSignal,
        );
        setupOK = true;
        break;
      } catch (e) {
        if (signal.aborted) return;
        this.status.lastError = safeError(e);
        logger(
          "telegram-setup",
          `${safeError(e)}; attempt ${attempt}/3; HTTP remains available.`,
        );
        if (fatal(e)) break;
        const retryAfter = Number(
          (e as { parameters?: { retry_after?: number } })?.parameters
            ?.retry_after,
        );
        if (Number.isFinite(retryAfter) && retryAfter > 300) break;
        if (attempt < 3) {
          try {
            await wait(
              Math.max(
                retryDelay(attempt),
                Number.isFinite(retryAfter)
                  ? Math.max(0, retryAfter) * 1000
                  : 0,
              ),
              signal,
            );
          } catch {
            return;
          }
        }
      }
    }
    this.status.setup = setupOK ? "ready" : "failed";
    this.status.bot = "polling";
    logger("telegram", "Polling started; menu setup " + this.status.setup);
    while (!signal.aborted) {
      try {
        const updates = await this.bot.api.getUpdates(
          { offset: this.offset, timeout: 25, allowed_updates: ["message"] },
          apiSignal,
        );
        this.status.api = "ready";
        this.status.bot = "polling";
        this.status.failures = 0;
        delete this.status.lastError;
        for (const update of updates) {
          if (signal.aborted) return;
          try {
            await this.bot.handleUpdate(update);
          } catch (e) {
            logger("telegram-handler", safeError(e));
          }
          this.offset = update.update_id + 1;
        }
      } catch (e) {
        if (!(await retry(e))) return;
      }
    }
  }
}
