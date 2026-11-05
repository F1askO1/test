import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proxyTrust } from "../backend/src/proxy-trust.js";
import { signed } from "./helpers.js";
test("trust proxy is bounded; Tailscale loopback is supported without trust-all", () => {
  assert.equal(proxyTrust("loopback"), "loopback");
  assert.equal(proxyTrust("1"), 1);
  for (const v of ["true", "-1", "99", "NaN"])
    assert.throws(() => proxyTrust(v));
});
test("Mini App Only authenticates Telegram without parsing broken SOCKS or contacting Telegram API", async () => {
  const dir = mkdtempSync(join(tmpdir(), "slope-mini-only-"));
  const holder = createServer().listen(0, "127.0.0.1");
  await once(holder, "listening");
  const port = (holder.address() as any).port;
  await new Promise<void>((r) => holder.close(() => r()));
  const token = "123456:synthetic_for_signing_only";
  const proc = spawn(
    process.execPath,
    ["--import", "tsx", "backend/src/index.ts"],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DEV_AUTH: "false",
        BOT_TOKEN: token,
        BOT_ENABLED: "false",
        TELEGRAM_PROXY_URL: "invalid_proxy_should_never_be_parsed",
        APP_URL: "",
        DATABASE_PATH: join(dir, "test.sqlite"),
        PORT: String(port),
        HOST: "127.0.0.1",
        TRUST_PROXY: "loopback",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let logs = "";
  proc.stdout?.on("data", (d) => (logs += d));
  proc.stderr?.on("data", (d) => (logs += d));
  try {
    let response;
    for (let i = 0; i < 100; i++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/status`);
        if (response.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.equal(response?.status, 200);
    assert.equal((await response!.json()).telegram.bot, "disabled");
    const auth = "tma " + signed(22, Math.floor(Date.now() / 1000), token);
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${port}/api/me`, {
          headers: {
            Authorization: auth,
            "X-Forwarded-For": "203.0.113.5",
            "X-Forwarded-Proto": "https",
          },
        })
      ).status,
      200,
    );
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/me`)).status, 401);
    const exit = once(proc, "exit");
    proc.send("shutdown");
    const [code] = await exit;
    assert.equal(code, 0);
    assert.ok(!logs.includes("ERR_ERL_UNEXPECTED_X_FORWARDED_FOR"));
    assert.ok(!logs.includes(token));
    assert.ok(!logs.includes("Polling started"));
  } finally {
    if (proc.exitCode === null) {
      proc.kill("SIGKILL");
      await once(proc, "exit");
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
