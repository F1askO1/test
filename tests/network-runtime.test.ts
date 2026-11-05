import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer as httpServer } from "node:http";
import { createServer, createConnection, type Socket } from "node:net";
import { Bot } from "grammy";
import {
  TelegramRuntime,
  retryDelay,
} from "../backend/src/telegram-runtime.js";
import {
  telegramClient,
  probeProxy,
  proxyAddress,
} from "../backend/src/telegram-network.js";
import { safeError } from "../backend/src/safe-log.js";
import { createApp } from "../backend/src/app.js";
import { openDb } from "../backend/src/db.js";
import request from "supertest";
const botInfo = {
  id: 12,
  is_bot: true as const,
  first_name: "Test",
  username: "test_bot",
};
const pause = (ms = 1) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await pause(5);
  }
  throw new Error("test timeout");
}
function blocked(signal?: AbortSignal) {
  return new Promise<never>((_resolve, reject) => {
    const abort = () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
function makeRuntime(
  handler: (method: string, signal?: AbortSignal) => Promise<any>,
  options: ConstructorParameters<typeof TelegramRuntime>[2] = {},
) {
  const bot = new Bot("123456:fake_only_for_tests");
  bot.api.config.use(
    async (_prev, method, _payload, signal) =>
      ({
        ok: true,
        result: await handler(method, signal as unknown as AbortSignal),
      }) as any,
  );
  return new TelegramRuntime(bot, "https://example.com", options);
}
test("failed setMyCommands, polling failure and retry do not stop HTTP; shutdown aborts long polling", async () => {
  const db = openDb(":memory:"),
    lines: string[] = [],
    delays: number[] = [];
  let polls = 0;
  const runtime = makeRuntime(
    async (method, signal) => {
      if (method === "getMe") return botInfo;
      if (method === "getWebhookInfo") return { url: "" };
      if (method === "setMyCommands")
        throw Object.assign(
          new Error(
            "https://api.telegram.org/bot123456:secret_sensitive_token_that_must_not_be_logged/setMyCommands",
          ),
          { error_code: 500 },
        );
      if (method === "getUpdates") {
        if (++polls === 1)
          throw Object.assign(new Error("network"), { code: "ETIMEDOUT" });
        return blocked(signal);
      }
      return true;
    },
    {
      logger: (c, m) => lines.push(c + " " + m),
      wait: async (ms) => {
        delays.push(ms);
      },
    },
  );
  const app = createApp(db, {
    production: true,
    devAuth: false,
    token: "fake",
    origins: [],
    trustProxy: 0,
    status: () => runtime.status,
  });
  const task = runtime.start();
  await until(() => polls === 2);
  await request(app).get("/api/health").expect(200, { ok: true });
  const s = await request(app).get("/api/status").expect(200);
  assert.equal(s.body.http, "ready");
  assert.equal(s.body.telegram.setup, "failed");
  await request(app).get("/api/sessions").expect(401);
  await runtime.stop();
  await task;
  assert.equal(runtime.status.bot, "stopped");
  assert.deepEqual(delays, [1000, 2000, 1000]);
  assert.ok(!lines.join().includes("secret_sensitive"));
  db.close();
});
test("unreachable proxy has bounded attempts and capped exponential delays", async () => {
  const s = createServer();
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const port = (s.address() as any).port;
  await new Promise<void>((r) => s.close(() => r()));
  const delays: number[] = [],
    lines: string[] = [];
  let calls = 0;
  const runtime = makeRuntime(
    async () => {
      calls++;
      return botInfo;
    },
    {
      probe: (signal) => probeProxy(`socks5://127.0.0.1:${port}`, signal, 100),
      wait: async (ms) => {
        delays.push(ms);
      },
      logger: (_c, m) => lines.push(m),
    },
  );
  await runtime.start();
  assert.equal(calls, 0);
  assert.equal(runtime.status.bot, "failed");
  assert.equal(runtime.status.proxy, "unreachable");
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000]);
  assert.equal(retryDelay(100), 30000);
  assert.match(lines.at(-1)!, /HTTP remains available/);
});
test("polling 409 stops safely instead of creating a second poller; stop cancels backoff", async () => {
  const r = makeRuntime(
    async (method) => {
      if (method === "getMe") return botInfo;
      if (method === "getWebhookInfo") return { url: "" };
      if (method === "getUpdates") throw { error_code: 409 };
      return true;
    },
    { logger: () => {} },
  );
  await r.start();
  assert.equal(r.status.bot, "failed");
  assert.equal(r.status.failures, 1);
  await r.stop();
  const r2 = makeRuntime(
    async () => {
      throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    },
    { logger: () => {} },
  );
  const task = r2.start();
  await until(() => r2.status.bot === "retrying");
  await r2.stop();
  await task;
  assert.equal(r2.status.bot, "stopped");
});
test("webhook is not deleted, and an invalid token stops bounded initialization", async () => {
  for (const withWebhook of [true, false]) {
    let polls = 0;
    const r = makeRuntime(
      async (method) => {
        if (method === "getMe") {
          if (!withWebhook) throw { error_code: 401 };
          return botInfo;
        }
        if (method === "getWebhookInfo")
          return { url: "https://private.example/hook" };
        polls++;
        return true;
      },
      { logger: () => {} },
    );
    await r.start();
    assert.equal(r.status.bot, "failed");
    assert.equal(polls, 0);
  }
});
test("safe exception logging never includes messages, credentials or payloads", () => {
  const secret = "123456:secret_sensitive_token_that_must_not_be_logged";
  const e = Object.assign(
    new Error(
      `https://api.telegram.org/bot${secret}/getUpdates socks5://name:password@localhost:9999`,
    ),
    { name: "HttpError", cause: { code: "ETIMEDOUT", request: { secret } } },
  );
  assert.equal(safeError(e), "HttpError code=ETIMEDOUT");
  assert.equal(safeError({ code: secret, name: secret }), "Error");
});
test("SOCKS5 agent carries setup, long polling and replies through a local proxy", async () => {
  const methods: string[] = [],
    connections = new Set<Socket>();
  let proxyConnections = 0;
  const api = httpServer((req, res) => {
    const method = req.url!.split("/").at(-1)!;
    methods.push(method);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        result:
          method === "getMe"
            ? botInfo
            : method === "getUpdates"
              ? []
              : method === "sendMessage"
                ? {
                    message_id: 1,
                    date: 1,
                    chat: { id: 1, type: "private" },
                    text: "ok",
                  }
                : true,
      }),
    );
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const apiPort = (api.address() as any).port;
  const proxy = createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    socket.on("error", () => {});
    let data = Buffer.alloc(0),
      stage = 0;
    const handle = (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
      if (stage === 0) {
        if (data.length < 2 || data.length < 2 + data[1]) return;
        data = data.subarray(2 + data[1]);
        socket.write(Buffer.from([5, 0]));
        stage = 1;
      }
      if (stage === 1) {
        if (data.length < 5) return;
        const atyp = data[3],
          end = atyp === 1 ? 8 : atyp === 3 ? 5 + data[4] : 20;
        if (data.length < end + 2) return;
        const host =
          atyp === 1
            ? [...data.subarray(4, 8)].join(".")
            : data.subarray(5, end).toString();
        const port = data.readUInt16BE(end);
        const remainder = data.subarray(end + 2);
        stage = 2;
        proxyConnections++;
        const upstream = createConnection({ host, port }, () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          socket.off("data", handle);
          if (remainder.length) upstream.write(remainder);
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        connections.add(upstream);
        upstream.on("close", () => connections.delete(upstream));
        upstream.on("error", () => socket.destroy());
        socket.on("close", () => upstream.destroy());
      }
    };
    socket.on("data", handle);
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  const raw = `socks5h://127.0.0.1:${(proxy.address() as any).port}`;
  const client = telegramClient(raw)!;
  const bot = new Bot("123456:fake_only_for_tests", {
    client: { ...client, apiRoot: `http://127.0.0.1:${apiPort}` },
  });
  try {
    await probeProxy(raw);
    bot.botInfo = await bot.api.getMe();
    await bot.api.setMyCommands([{ command: "start", description: "Start" }]);
    await bot.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "Open",
        web_app: { url: "https://example.com" },
      },
    });
    await bot.api.getUpdates(
      { timeout: 0 },
      new AbortController().signal as unknown as Parameters<
        typeof bot.api.getUpdates
      >[1],
    );
    await bot.api.sendMessage(1, "hello");
    bot.command("start", (ctx) => ctx.reply("ok"));
    await bot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1,
        chat: { id: 1, type: "private", first_name: "Test" },
        from: { id: 1, is_bot: false, first_name: "Test" },
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: 6 }],
      },
    });
    assert.ok(proxyConnections >= 1);
    assert.deepEqual(methods, [
      "getMe",
      "setMyCommands",
      "setChatMenuButton",
      "getUpdates",
      "sendMessage",
      "sendMessage",
    ]);
    assert.throws(() => proxyAddress("http://user:password@localhost:1"));
  } finally {
    (client.baseFetchConfig?.agent as any)?.destroy();
    for (const s of connections) s.destroy();
    await Promise.all([
      new Promise<void>((r) => proxy.close(() => r())),
      new Promise<void>((r) => api.close(() => r())),
    ]);
  }
});

test("actual index HTTP survives unavailable Telegram proxy and shuts down through IPC", async () => {
  const { spawn } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slope-runtime-"));
  const ports = [];
  for (let i = 0; i < 2; i++) {
    const s = createServer();
    s.listen(0, "127.0.0.1");
    await once(s, "listening");
    ports.push((s.address() as any).port);
    await new Promise<void>((r) => s.close(() => r()));
  }
  const secret = "123456:synthetic_sensitive_token_never_log_this";
  const p = spawn(
    process.execPath,
    ["--import", "tsx", "backend/src/index.ts"],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        DEV_AUTH: "false",
        BOT_ENABLED: "true",
        BOT_TOKEN: secret,
        APP_URL: "https://example.com",
        TELEGRAM_PROXY_URL: `socks5://name:privatepassword@127.0.0.1:${ports[1]}`,
        DATABASE_PATH: path.join(dir, "test.sqlite"),
        PORT: String(ports[0]),
        HOST: "127.0.0.1",
        DEBUG: "",
        NODE_DEBUG: "",
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let output = "";
  p.stdout?.on("data", (d) => (output += d));
  p.stderr?.on("data", (d) => (output += d));
  try {
    let response;
    for (let i = 0; i < 100; i++) {
      try {
        response = await fetch(`http://127.0.0.1:${ports[0]}/api/health`);
        if (response.ok) break;
      } catch {}
      await pause(20);
    }
    assert.equal(response?.status, 200);
    const body = await (
      await fetch(`http://127.0.0.1:${ports[0]}/api/status`)
    ).json();
    assert.equal(body.http, "ready");
    assert.equal(body.database, "ready");
    assert.equal(body.mode, "production-private");
    assert.equal(
      (await fetch(`http://127.0.0.1:${ports[0]}/api/sessions`)).status,
      401,
    );
    const exited = once(p, "exit");
    p.send("shutdown");
    const [code] = await Promise.race([
      exited,
      pause(5000).then(() => {
        throw new Error("shutdown timeout");
      }),
    ]);
    assert.equal(code, 0);
    assert.ok(!output.includes(secret));
    assert.ok(!output.includes("privatepassword"));
    assert.ok(!output.includes("UnhandledPromiseRejection"));
  } finally {
    if (p.exitCode === null) {
      p.kill("SIGKILL");
      await once(p, "exit");
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
