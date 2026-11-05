import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
export function deploymentId(databasePath: string, configured?: string) {
  if (configured) {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(configured))
      throw new Error("Invalid DEPLOYMENT_ID");
    return configured;
  }
  if (databasePath === ":memory:") return randomUUID();
  const file = join(dirname(databasePath), ".deployment-id");
  try {
    writeFileSync(file, randomUUID(), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  const id = readFileSync(file, "utf8").trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id))
    throw new Error("Invalid deployment identity");
  return id;
}
export type EndpointStatus = {
  state: "unknown" | "ready" | "unreachable" | "mismatch";
  checkedAt: string | null;
  lastSuccessAt: string | null;
  reason?: "http" | "transport" | "identity" | "configuration";
};
export class EndpointMonitor {
  readonly status: EndpointStatus = {
    state: "unknown",
    checkedAt: null,
    lastSuccessAt: null,
  };
  private controller = new AbortController();
  private task?: Promise<void>;
  constructor(
    private origin: string,
    private identity: string,
    private options: {
      fetch?: typeof fetch;
      intervalMs?: number;
      wait?: (ms: number, signal: AbortSignal) => Promise<void>;
    } = {},
  ) {}
  async check() {
    try {
      const u = new URL(this.origin);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.pathname !== "/" ||
        u.search ||
        u.hash
      )
        throw new Error("configuration");
    } catch {
      Object.assign(this.status, {
        state: "unreachable",
        reason: "configuration",
        checkedAt: new Date().toISOString(),
      });
      return;
    }
    try {
      const r = await (this.options.fetch ?? fetch)(
        this.origin + "/api/status",
        {
          redirect: "error",
          headers: { "Cache-Control": "no-cache" },
          signal: AbortSignal.any([
            this.controller.signal,
            AbortSignal.timeout(8000),
          ]),
        },
      );
      if (!r.ok) {
        this.status.state = "unreachable";
        this.status.reason = "http";
      } else {
        const body = await r.json();
        this.status.state =
          body.http === "ready" && body.deploymentId === this.identity
            ? "ready"
            : "mismatch";
        this.status.reason =
          this.status.state === "ready" ? undefined : "identity";
        if (this.status.state === "ready")
          this.status.lastSuccessAt = new Date().toISOString();
      }
    } catch {
      if (!this.controller.signal.aborted) {
        this.status.state = "unreachable";
        this.status.reason = "transport";
      }
    }
    this.status.checkedAt = new Date().toISOString();
  }
  start() {
    if (this.task) return;
    this.task = (async () => {
      const { setTimeout } = await import("node:timers/promises");
      while (!this.controller.signal.aborted) {
        await this.check();
        try {
          await (
            this.options.wait ??
            ((ms, signal) => setTimeout(ms, undefined, { signal }))
          )(this.options.intervalMs ?? 60000, this.controller.signal);
        } catch {
          break;
        }
      }
    })().catch(() => {
      this.status.state = "unreachable";
      this.status.reason = "transport";
    });
  }
  async stop() {
    this.controller.abort();
    await this.task;
  }
}
