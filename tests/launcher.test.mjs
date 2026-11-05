import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  redact,
  updateAppUrlText,
  saveAppUrl,
  health,
  classifyCloudflare,
  parseTunnelLine,
  lockFile,
  assertPublicEnv,
  proxyCheck,
} from "../scripts/network-utils.mjs";
test("APP_URL atomic edit preserves token, comments, unrelated variables and CRLF; removes duplicates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slopemate-env-"));
  try {
    const file = path.join(dir, ".env");
    const original =
      '# comment\r\nBOT_TOKEN="private token"\r\nAPP_URL=https://old.example\r\nOTHER=preserve=exactly\r\nexport APP_URL=https://duplicate.example\r\n';
    fs.writeFileSync(file, original);
    saveAppUrl(file, "https://new.trycloudflare.com");
    const text = fs.readFileSync(file, "utf8");
    assert.ok(text.includes('BOT_TOKEN="private token"\r\n'));
    assert.ok(text.includes("OTHER=preserve=exactly\r\n"));
    assert.equal((text.match(/APP_URL=/g) || []).length, 1);
    assert.ok(text.includes("APP_URL=https://new.trycloudflare.com"));
    const before = text;
    assert.throws(() => saveAppUrl(file, "https://user:pass@bad.example"));
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.match(
      updateAppUrlText("OTHER=1\n", "https://valid.example"),
      /OTHER=1\nAPP_URL=https:\/\/valid.example\n/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test("Cloudflare 1033, 502 and a healthy JSON response remain distinct", async () => {
  assert.match(classifyCloudflare(530, "error code: 1033"), /^1033/);
  assert.match(classifyCloudflare(502, "Bad Gateway"), /^502/);
  for (const [status, text, expected] of [
    [200, '{"ok":true}', true],
    [200, "<h1>Not application</h1>", false],
    [502, "Bad Gateway", false],
    [530, "error 1033", false],
  ]) {
    const r = await health("https://test.example", {
      fetchFn: async () => new Response(text, { status }),
    });
    assert.equal(r.ok, expected);
  }
  assert.equal(
    (
      await health("https://test.example", {
        fetchFn: async () => {
          throw new Error("https://user:pass@secret.example");
        },
      })
    ).reason.includes("secret"),
    false,
  );
  assert.equal(
    parseTunnelLine("url=https://snow-line.trycloudflare.com").url,
    "https://snow-line.trycloudflare.com",
  );
  assert.equal(
    parseTunnelLine("Registered tunnel connection").registered,
    true,
  );
  assert.equal(
    parseTunnelLine("TLS handshake with edge error: EOF").disconnected,
    true,
  );
});
test("launcher secrets and exception URLs are redacted", () => {
  const token = "123456:abcdefghijklmnopqrstuvwxyz_abcdef";
  const proxy = "socks5://user:password@127.0.0.1:1234";
  const text = redact(
    `Error ${token} https://api.telegram.org/bot${token}/getMe ${proxy} https://name:password@host/path?token=abc`,
    [token, proxy, "password"],
  );
  assert.ok(!text.includes(token));
  assert.ok(!text.includes("password"));
  assert.ok(!text.includes("?token=abc"));
});
test("exclusive launcher lock prevents duplicate processes; stale PID is recovered without killing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slopemate-lock-")),
    file = path.join(dir, "launcher.lock");
  try {
    const release = lockFile(file);
    assert.throws(() => lockFile(file), /Другой экземпляр/);
    release();
    fs.writeFileSync(file, JSON.stringify({ pid: 99999999 }));
    const release2 = lockFile(file, process.pid, () => false);
    assert.equal(JSON.parse(fs.readFileSync(file)).pid, process.pid);
    release2();
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test("public launcher refuses development authentication or absent token", () => {
  assert.throws(() => assertPublicEnv({ DEV_AUTH: "true", BOT_TOKEN: "fake" }));
  assert.throws(() => assertPublicEnv({ DEV_AUTH: "false" }));
  assert.doesNotThrow(() =>
    assertPublicEnv({
      DEV_AUTH: "false",
      BOT_TOKEN: "fake",
      HOST: "127.0.0.1",
    }),
  );
});
test("bad proxy is rejected without copying credentials into error text", async () => {
  await assert.rejects(
    proxyCheck("http://name:privatepass@host:8"),
    (e) => !e.message.includes("privatepass"),
  );
});
test("actual diagnostic launcher writes no token or proxy credentials to logs", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slope-launcher-"));
  const secret = "123456:synthetic_sensitive_token_never_log_this";
  try {
    fs.mkdirSync(path.join(dir, "scripts"));
    for (const file of ["launcher.mjs", "network-utils.mjs"])
      fs.copyFileSync(
        new URL("../scripts/" + file, import.meta.url),
        path.join(dir, "scripts", file),
      );
    fs.symlinkSync(
      path.resolve("node_modules"),
      path.join(dir, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    fs.writeFileSync(
      path.join(dir, ".env"),
      `BOT_TOKEN=${secret}\nDEV_AUTH=false\nPORT=65534\nTELEGRAM_PROXY_URL=socks5://name:privatepassword@127.0.0.1:65534\nAPP_URL=\n`,
    );
    const text = execFileSync(
      process.execPath,
      [path.join(dir, "scripts", "launcher.mjs"), "diagnostics"],
      {
        encoding: "utf8",
        timeout: 20000,
        env: { ...process.env, DEBUG: "", NODE_DEBUG: "" },
      },
    );
    const logs = fs
      .readdirSync(path.join(dir, "logs"))
      .filter((f) => f.endsWith(".log"))
      .map((f) => fs.readFileSync(path.join(dir, "logs", f), "utf8"))
      .join("\n");
    for (const output of [text, logs]) {
      assert.ok(!output.includes(secret));
      assert.ok(!output.includes("privatepassword"));
      assert.ok(!output.includes("socks5://name"));
    }
    assert.match(text, /Диагностика/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
