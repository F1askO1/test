import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:https";
import { generate } from "selfsigned";
import { Bot } from "grammy";
import { SocksProxyAgent } from "socks-proxy-agent";
import {
  TelegramSocksAgent,
  telegramTiming,
} from "../backend/src/telegram-network.js";
import { socksFixture } from "./socks-fixture.js";
import { EndpointMonitor, deploymentId } from "../backend/src/deployment.js";
import { acquireBotLock } from "../backend/src/bot-lock.js";
import { decodeApiResponse, ApiError } from "../frontend/src/transport.js";
import { openDb } from "../backend/src/db.js";
import { createApp } from "../backend/src/app.js";
import request from "supertest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("regression: SOCKS idle timer cuts a valid TLS poll; handshake-only timer permits idle poll and still verifies certificates", async () => {
  const pems = await generate([{ name: "commonName", value: "localhost" }], {
    keySize: 2048,
    extensions: [
      { name: "basicConstraints", cA: true },
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
        ],
      },
    ],
  });
  const api = createServer(
    { key: pems.private, cert: pems.cert },
    (_req, res) => {
      setTimeout(() => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, result: [] }));
      }, 700);
    },
  );
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const proxy = await socksFixture();
  const opts = { timeout: 250, ca: pems.cert, keepAlive: false };
  const old = new SocksProxyAgent(proxy.url, opts),
    fixed = new TelegramSocksAgent(proxy.url, opts),
    untrusted = new TelegramSocksAgent(proxy.url, {
      timeout: 250,
      keepAlive: false,
    });
  const bot = (agent: SocksProxyAgent) =>
    new Bot("123456:synthetic_fixture", {
      client: {
        apiRoot: `https://127.0.0.1:${(api.address() as any).port}`,
        timeoutSeconds: 3,
        baseFetchConfig: { agent },
      },
    });
  try {
    await assert.rejects(bot(old).api.getUpdates({ timeout: 1 }));
    assert.deepEqual(await bot(fixed).api.getUpdates({ timeout: 1 }), []);
    await assert.rejects(bot(untrusted).api.getUpdates({ timeout: 1 }));
  } finally {
    for (const a of [old, fixed, untrusted]) a.destroy();
    await proxy.close();
    await new Promise<void>((r) => api.close(() => r()));
  }
});
test("SOCKS handshake timeout remains bounded when proxy accepts TCP but never responds", async () => {
  const proxy = await socksFixture(true),
    agent = new TelegramSocksAgent(proxy.url, { timeout: 150 });
  const bot = new Bot("123456:synthetic_fixture", {
    client: {
      apiRoot: "https://example.com",
      timeoutSeconds: 3,
      baseFetchConfig: { agent },
    },
  });
  const before = Date.now();
  try {
    await assert.rejects(bot.api.getMe());
    assert.ok(Date.now() - before < 2000);
  } finally {
    agent.destroy();
    await proxy.close();
  }
});
test("RPC deadline must leave margin for poll, connect, TLS and response", () => {
  assert.equal(telegramTiming({}).pollSeconds, 15);
  assert.throws(() =>
    telegramTiming({
      TELEGRAM_POLL_TIMEOUT_SECONDS: "50",
      TELEGRAM_REQUEST_TIMEOUT_SECONDS: "45",
    }),
  );
  assert.throws(() => telegramTiming({ TELEGRAM_CONNECT_TIMEOUT_MS: "60000" }));
});
test("persistent instance identity survives restart; same token cannot acquire two polling locks", () => {
  const dir = mkdtempSync(join(tmpdir(), "slope-instance-"));
  try {
    const db = openDb(join(dir, "test.sqlite"));
    db.close();
    const a = deploymentId(join(dir, "test.sqlite"));
    assert.equal(a, deploymentId(join(dir, "test.sqlite")));
    const release = acquireBotLock("synthetic", join(dir, "locks"));
    assert.throws(() => acquireBotLock("synthetic", join(dir, "locks")));
    release();
    const again = acquireBotLock("synthetic", join(dir, "locks"));
    again();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("endpoint differentiates unreachable HTTPS, wrong instance, and recovered deployment", async () => {
  let phase = 0;
  const monitor = new EndpointMonitor(
    "https://app.example.com",
    "identity-123",
    {
      fetch: async () => {
        if (phase === 0) throw new Error("offline");
        return new Response(
          JSON.stringify({
            http: "ready",
            deploymentId: phase === 1 ? "old-instance" : "identity-123",
          }),
        );
      },
    },
  );
  await monitor.check();
  assert.equal(monitor.status.state, "unreachable");
  phase = 1;
  await monitor.check();
  assert.equal(monitor.status.state, "mismatch");
  phase = 2;
  await monitor.check();
  assert.equal(monitor.status.state, "ready");
  assert.ok(monitor.status.lastSuccessAt);
  await monitor.stop();
});
test("public status omits detailed recovery and private diagnostics rejects missing/wrong token", async () => {
  const db = openDb(":memory:");
  try {
    const app = createApp(db, {
      production: true,
      devAuth: false,
      token: "fake",
      origins: [],
      trustProxy: 1,
      diagnosticsToken: "local-fixture-only",
      deploymentId: "identity-123",
      status: () => ({
        bot: "retrying",
        api: "unreachable",
        failures: 7,
        lastError: "HttpError code=ECONNRESET",
        retryInMs: 120000,
        setup: "ready",
      }),
    });
    const publicBody = (await request(app).get("/api/status").expect(200)).body;
    assert.equal(publicBody.telegram.failures, undefined);
    assert.equal(publicBody.telegram.lastError, undefined);
    await request(app).get("/api/diagnostics").expect(404);
    await request(app)
      .get("/api/diagnostics")
      .set("Authorization", "Bearer wrong")
      .expect(404);
    const detailed = await request(app)
      .get("/api/diagnostics")
      .set("Authorization", "Bearer local-fixture-only")
      .expect(200);
    assert.equal(detailed.body.telegram.failures, 7);
    await request(app)
      .get("/api/sessions")
      .set("X-Forwarded-Proto", "https")
      .expect(401);
  } finally {
    db.close();
  }
});
test("frontend separates expired authorization, tunnel HTML, HTTP errors and valid JSON", async () => {
  await assert.rejects(
    decodeApiResponse(
      new Response(JSON.stringify({ error: "Авторизация истекла" }), {
        status: 401,
      }),
    ),
    (e) =>
      e instanceof ApiError &&
      e.kind === "authorization" &&
      !e.message.includes("Нет связи"),
  );
  await assert.rejects(
    decodeApiResponse(new Response("<html>Error 1033</html>", { status: 530 })),
    (e) => e instanceof ApiError && e.kind === "gateway",
  );
  await assert.rejects(
    decodeApiResponse(new Response("<html>tunnel login page</html>")),
    (e) => e instanceof ApiError && e.kind === "gateway",
  );
  assert.deepEqual(await decodeApiResponse(new Response('{"user":{"id":1}}')), {
    user: { id: 1 },
  });
});
test("database failure is a server error, not false Telegram authorization failure", async () => {
  const { signed } = await import("./helpers.js");
  const db = openDb(":memory:");
  const app = createApp(db, {
    production: true,
    devAuth: false,
    token: "test-token",
    origins: [],
    trustProxy: 0,
  });
  db.close();
  const valid = "tma " + signed(22, Math.floor(Date.now() / 1000));
  await request(app).get("/api/me").set("Authorization", valid).expect(500);
  const missing = await request(app).get("/api/me").expect(401);
  assert.ok(!missing.body.error.includes("DEV_AUTH"));
});
