import type { Bot } from "grammy";
import { setTimeout as sleep } from "node:timers/promises";
import { safeError, log, type Logger } from "./safe-log.js";
export type TelegramStatus = {
  bot: "disabled" | "starting" | "polling" | "retrying" | "stopped" | "failed";
  api: "unknown" | "ready" | "unreachable" | "rejected";
  proxy: "direct" | "configured" | "tcp-ready" | "unreachable";
  setup: "pending" | "ready" | "failed";
  transport: "polling";
  failures: number;
  retryInMs: number;
  lastError?: string;
  lastSuccessAt: string | null;
  lastPollSuccessAt: string | null;
  lastFailureAt: string | null;
  nextRetryAt: string | null;
  recovery: "idle" | "backoff" | "cooldown" | "fatal" | "stopped";
  stage: "init" | "setup" | "poll" | "handler";
  menu: "unknown" | "matches" | "mismatch";
  proxyCheckedAt: string | null;
};
export const retryDelay = (failure: number) =>
  Math.min(60000, 1000 * 2 ** Math.min(Math.max(0, failure - 1), 6));
export const recoveryDelay = (
  failure: number,
  random: () => number = Math.random,
) =>
  Math.round(
    (failure >= 6 ? 120000 : retryDelay(failure)) *
      (0.8 + 0.4 * Math.max(0, Math.min(1, random()))),
  );
const statusCode = (e: unknown) =>
  Number((e as { error_code?: number })?.error_code);
const fatal = (e: unknown) => {
  const code =
    (
      e as {
        code?: string;
        cause?: { code?: string };
        error?: { code?: string };
      }
    )?.code ??
    (e as { cause?: { code?: string } })?.cause?.code ??
    (e as { error?: { code?: string } })?.error?.code;
  if (
    [400, 401, 403, 404, 409].includes(statusCode(e)) ||
    code === "E_BOT_LOCKED"
  )
    return true;
  if (
    [
      "CERT_HAS_EXPIRED",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "ERR_SSL_WRONG_VERSION_NUMBER",
    ].includes(code ?? "")
  )
    return true;
  if (statusCode(e) === 429 || statusCode(e) >= 500) return false;
  return !(
    (e as { name?: string })?.name === "HttpError" ||
    [
      "ECONNRESET",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "EPIPE",
      "ENETUNREACH",
      "EHOSTUNREACH",
    ].includes(code ?? "")
  );
};
type ApiSignal = NonNullable<Parameters<Bot["api"]["getMe"]>[0]>;
export class TelegramRuntime {
  readonly status: TelegramStatus = {
    bot: "disabled",
    api: "unknown",
    proxy: "direct",
    setup: "pending",
    transport: "polling",
    failures: 0,
    retryInMs: 0,
    lastSuccessAt: null,
    lastPollSuccessAt: null,
    lastFailureAt: null,
    nextRetryAt: null,
    recovery: "idle",
    stage: "init",
    menu: "unknown",
    proxyCheckedAt: null,
  };
  private controller = new AbortController();
  private task?: Promise<void>;
  private offset = 0;
  private setupAttemptAt = 0;
  constructor(
    private bot: Bot,
    private url: string,
    private options: {
      probe?: (signal: AbortSignal) => Promise<void>;
      logger?: Logger;
      wait?: (ms: number, signal: AbortSignal) => Promise<void>;
      random?: () => number;
      now?: () => number;
      pollSeconds?: number;
      acquire?: () => () => void;
    } = {},
  ) {
    if (options.probe) this.status.proxy = "configured";
    bot.api.config.use(async (prev, method, payload, signal) => {
      try {
        const result = await prev(
          method,
          payload,
          signal ?? (this.controller.signal as unknown as ApiSignal),
        );
        if (result.ok) {
          this.status.lastSuccessAt = new Date(this.now()).toISOString();
          this.status.api = "ready";
        }
        return result;
      } catch (e) {
        throw e;
      }
    });
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private logger(component: string, message: string) {
    (this.options.logger ?? log)(component, message);
  }
  start() {
    if (this.task) return this.task;
    this.status.bot = "starting";
    this.task = this.run().catch((e) => {
      if (!this.controller.signal.aborted) {
        this.status.bot = "failed";
        this.status.recovery = "fatal";
        this.status.lastError = safeError(e);
        this.logger("telegram", safeError(e));
      }
    });
    return this.task;
  }
  async stop() {
    this.controller.abort();
    await this.task;
    this.status.bot = "stopped";
    this.status.recovery = "stopped";
    this.status.retryInMs = 0;
    this.status.nextRetryAt = null;
  }
  private async wait(ms: number) {
    await (
      this.options.wait ??
      ((delay, signal) => sleep(delay, undefined, { signal }))
    )(ms, this.controller.signal);
  }
  private success() {
    this.status.api = "ready";
    this.status.failures = 0;
    this.status.recovery = "idle";
    this.status.retryInMs = 0;
    this.status.nextRetryAt = null;
  }
  private failure(e: unknown) {
    this.status.api = Number.isFinite(statusCode(e))
      ? "rejected"
      : "unreachable";
    this.status.lastError = safeError(e);
    this.status.lastFailureAt = new Date(this.now()).toISOString();
  }
  private async retry(e: unknown) {
    if (this.controller.signal.aborted) return false;
    this.failure(e);
    this.status.failures++;
    if (this.status.stage === "poll" && this.options.probe && !fatal(e)) {
      try {
        await this.options.probe(this.controller.signal);
        this.status.proxy = "tcp-ready";
      } catch {
        this.status.proxy = "unreachable";
      }
      this.status.proxyCheckedAt = new Date(this.now()).toISOString();
    }
    if (fatal(e)) {
      this.status.bot = "failed";
      this.status.recovery = "fatal";
      this.status.retryInMs = 0;
      this.status.nextRetryAt = null;
      this.logger(
        "telegram",
        `${safeError(e)}; configuration/token/webhook/poller conflict requires action. HTTP remains available.`,
      );
      return false;
    }
    const after = Number(
      (e as { parameters?: { retry_after?: number } })?.parameters?.retry_after,
    );
    const ms = Math.max(
      recoveryDelay(this.status.failures, this.options.random),
      Number.isFinite(after) ? Math.max(0, after) * 1000 : 0,
    );
    this.status.bot = "retrying";
    this.status.recovery = this.status.failures >= 6 ? "cooldown" : "backoff";
    this.status.retryInMs = ms;
    this.status.nextRetryAt = new Date(this.now() + ms).toISOString();
    this.logger(
      "telegram",
      `${safeError(e)}; stage=${this.status.stage}; failures=${this.status.failures}; recovery=${this.status.recovery}; retry in ${ms} ms. HTTP remains available.`,
    );
    // Chunk long Telegram retry_after waits; AbortSignal always stops them immediately.
    try {
      let left = ms;
      while (left > 0 && !this.controller.signal.aborted) {
        const chunk = Math.min(left, 60000);
        await this.wait(chunk);
        left -= chunk;
      }
    } catch {
      return false;
    }
    this.status.retryInMs = 0;
    this.status.nextRetryAt = null;
    return !this.controller.signal.aborted;
  }
  private async setup(signal: ApiSignal) {
    this.status.stage = "setup";
    this.setupAttemptAt = this.now();
    try {
      await this.bot.api.setMyCommands(
        [
          { command: "start", description: "Открыть SlopeMate" },
          { command: "help", description: "Помощь" },
          { command: "stats", description: "Моя статистика" },
        ],
        {},
        signal,
      );
      await this.bot.api.setChatMenuButton(
        {
          menu_button: {
            type: "web_app",
            text: "SlopeMate",
            web_app: { url: this.url },
          },
        },
        signal,
      );
      const menu = await this.bot.api.getChatMenuButton({}, signal);
      this.status.menu =
        menu.type === "web_app" &&
        new URL(menu.web_app.url).href === new URL(this.url).href
          ? "matches"
          : "mismatch";
      this.status.setup = this.status.menu === "matches" ? "ready" : "failed";
    } catch (e) {
      if (this.controller.signal.aborted) return;
      this.failure(e);
      this.status.setup = "failed";
      this.status.menu = "unknown";
      this.logger(
        "telegram-setup",
        `${safeError(e)}; menu will be retried after successful polling; HTTP remains available.`,
      );
      if (fatal(e)) throw e;
    }
  }
  private async run() {
    let release: (() => void) | undefined;
    try {
      release = this.options.acquire?.();
      await this.loop();
    } finally {
      release?.();
    }
  }
  private async loop() {
    const native = this.controller.signal,
      signal = native as unknown as ApiSignal;
    let initialized = false;
    while (!native.aborted && !initialized) {
      this.status.stage = "init";
      try {
        if (this.options.probe) {
          try {
            await this.options.probe(native);
            this.status.proxy = "tcp-ready";
            this.status.proxyCheckedAt = new Date(this.now()).toISOString();
          } catch (e) {
            this.status.proxy = "unreachable";
            this.status.proxyCheckedAt = new Date(this.now()).toISOString();
            throw e;
          }
        }
        this.bot.botInfo = await this.bot.api.getMe(signal);
        const hook = await this.bot.api.getWebhookInfo(signal);
        if (hook.url)
          throw Object.assign(new Error("Webhook conflict"), {
            error_code: 409,
          });
        this.success();
        initialized = true;
      } catch (e) {
        if (!(await this.retry(e))) return;
      }
    }
    if (native.aborted) return;
    try {
      await this.setup(signal);
    } catch (e) {
      await this.retry(e);
      return;
    }
    this.status.bot = "polling";
    this.logger("telegram", "Polling started; menu setup " + this.status.setup);
    while (!native.aborted) {
      this.status.stage = "poll";
      try {
        const updates = await this.bot.api.getUpdates(
          {
            offset: this.offset,
            timeout: this.options.pollSeconds ?? 15,
            allowed_updates: ["message"],
          },
          signal,
        );
        this.success();
        this.status.lastPollSuccessAt = new Date(this.now()).toISOString();
        this.status.bot = "polling";
        if (!updates.length) await this.wait(250);
        for (const update of updates) {
          if (native.aborted) return;
          this.status.stage = "handler";
          try {
            await this.bot.handleUpdate(update);
          } catch (e) {
            this.failure(e);
            this.logger("telegram-handler", safeError(e));
          }
          this.offset = update.update_id + 1;
        }
        if (
          this.status.setup !== "ready" &&
          this.now() - this.setupAttemptAt >= 60000
        ) {
          try {
            await this.setup(signal);
          } catch (e) {
            if (!(await this.retry(e))) return;
          }
        }
      } catch (e) {
        if (!(await this.retry(e))) return;
      }
    }
  }
}
