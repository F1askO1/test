// Read-only observation. Does not call Telegram, restart services or create tunnels.
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  health,
  endpointIdentity,
  readEnv,
  validateAppUrl,
  errorCode,
} from "./network-utils.mjs";
async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const env = readEnv(path.join(root, ".env"));
  const origin = validateAppUrl(env.APP_URL);
  const minutes = Number(process.env.SOAK_MINUTES || 90);
  if (!Number.isFinite(minutes) || minutes < 65 || minutes > 1440)
    throw new Error("SOAK_MINUTES must be 65..1440; default 90.");
  const expected = env.DEPLOYMENT_ID;
  if (!expected) throw new Error("Set public DEPLOYMENT_ID before soak test.");
  fs.mkdirSync(path.join(root, "logs"), { recursive: true });
  const report = path.join(
    root,
    "logs",
    `soak-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
  );
  const stopController = new AbortController();
  let stopped = false,
    samples = 0,
    outages = 0,
    recoveries = 0,
    lastOK = true;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      stopped = true;
      stopController.abort();
    });
  const start = Date.now();
  console.log(
    "Read-only soak started; no secrets/URLs are recorded. Stop with Ctrl+C.",
  );
  while (!stopped && Date.now() - start < minutes * 60000) {
    const h = await health(origin + "/api/health");
    const id = await endpointIdentity(origin, expected);
    let telegram = id.status?.telegram;
    let details;
    if (id.ok && env.DIAGNOSTICS_TOKEN) {
      try {
        const r = await fetch(origin + "/api/diagnostics", {
          redirect: "error",
          headers: { Authorization: "Bearer " + env.DIAGNOSTICS_TOKEN },
          signal: AbortSignal.timeout(8000),
        });
        if (r.ok) {
          const body = await r.json();
          const t = body.telegram;
          details = {
            recovery: t?.recovery,
            failures: t?.failures,
            lastSuccessAt: t?.lastSuccessAt,
            lastPollSuccessAt: t?.lastPollSuccessAt,
            lastFailureAt: t?.lastFailureAt,
            stage: t?.stage,
          };
        }
      } catch {}
    }
    const ok =
      h.ok &&
      id.ok &&
      telegram?.api === "ready" &&
      telegram?.menu === "matches";
    if (!ok && lastOK) outages++;
    if (ok && !lastOK) recoveries++;
    lastOK = ok;
    samples++;
    const row = {
      at: new Date().toISOString(),
      elapsedMinutes: Math.round((Date.now() - start) / 600) / 100,
      http: h.ok,
      identity: id.ok,
      bot: telegram?.bot,
      api: telegram?.api,
      menu: telegram?.menu,
      ...details,
    };
    fs.appendFileSync(report, JSON.stringify(row) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(row));
    await delay(30000, undefined, { signal: stopController.signal }).catch(
      () => {},
    );
  }
  console.log(
    JSON.stringify({
      samples,
      outages,
      recoveries,
      elapsedMinutes: Math.round((Date.now() - start) / 60000),
      completed: !stopped,
      lastOK,
      note: "Review samples and manual phone tests; elapsed time alone is not a stability guarantee.",
    }),
  );
  if (!lastOK || stopped) process.exitCode = 1;
}
void main().catch((e) => {
  console.error(
    "Soak failed: " +
      errorCode(e) +
      ". Check .env / APP_URL / DEPLOYMENT_ID locally; no exception details are printed.",
  );
  process.exitCode = 1;
});
