import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { parseFunnelStatus } from "../scripts/funnel.mjs";
import {
  needsBuild,
  recordBuild,
  needsInstall,
  recordInstall,
  sourceIdentity,
} from "../scripts/build-utils.mjs";
test("clean ZIP bootstrap loads menu without node_modules, dotenv or Git", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slope-clean-zip-"));
  try {
    fs.mkdirSync(path.join(dir, "scripts"));
    for (const name of [
      "launcher.mjs",
      "network-utils.mjs",
      "funnel.mjs",
      "build-utils.mjs",
    ])
      fs.copyFileSync(
        new URL("../scripts/" + name, import.meta.url),
        path.join(dir, "scripts", name),
      );
    const text = execFileSync(
      process.execPath,
      [path.join(dir, "scripts/launcher.mjs"), "menu"],
      { input: "0\n", encoding: "utf8", timeout: 10000 },
    );
    assert.ok(text.includes("Mini App Only"));
    assert.ok(!fs.existsSync(path.join(dir, "node_modules")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("Funnel discovery accepts only a publicly enabled root proxy on the configured port", () => {
  const host = "example.tail000000.ts.net:443";
  const fixture = {
    Web: { [host]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3001" } } } },
    AllowFunnel: { [host]: true },
  };
  assert.equal(parseFunnelStatus(fixture), "https://example.tail000000.ts.net");
  assert.equal(parseFunnelStatus(fixture, 3002), null);
  assert.equal(parseFunnelStatus({ ...fixture, AllowFunnel: {} }), null);
  assert.equal(parseFunnelStatus({}), null);
  assert.equal(parseFunnelStatus(null), null);
});
test("source changes invalidate production build; private data does not; lock changes require install once", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "slope-build-"));
  const write = (name, value = "") => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  try {
    write("package.json", '{"version":"0.1.0"}');
    write("package-lock.json", "{}");
    write("frontend/src/main.tsx", "one");
    write("dist/frontend/index.html", "html");
    write("dist/backend/src/index.js", "server");
    assert.equal(needsBuild(root), true);
    recordBuild(root);
    assert.equal(needsBuild(root), false);
    const id = sourceIdentity(root);
    write(".env", "BOT_TOKEN=synthetic_private_value");
    write("data/session.sqlite", "not a real database");
    assert.equal(sourceIdentity(root), id);
    write("frontend/src/main.tsx", "two");
    assert.equal(needsBuild(root), true);
    assert.equal(needsInstall(root), true);
    for (const name of [
      "vite",
      "tsx",
      "express",
      "grammy",
      "socks-proxy-agent",
    ])
      write(`node_modules/${name}/package.json`, "{}");
    recordInstall(root);
    assert.equal(needsInstall(root), false);
    write("package-lock.json", '{"changed":true}');
    assert.equal(needsInstall(root), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("manual npm ci is recognized without a redundant reinstall", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "slope-existing-deps-"));
  try {
    fs.mkdirSync(path.join(root, "node_modules/example"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify({
        packages: {
          "": { dependencies: { example: "1.0.0" } },
          "node_modules/example": { version: "1.0.0", integrity: "fixture" },
        },
      }),
    );
    fs.writeFileSync(
      path.join(root, "node_modules/.package-lock.json"),
      JSON.stringify({
        packages: {
          "node_modules/example": { version: "1.0.0", integrity: "fixture" },
        },
      }),
    );
    fs.writeFileSync(
      path.join(root, "node_modules/example/package.json"),
      '{"version":"1.0.0"}',
    );
    assert.equal(needsInstall(root), false);
    fs.writeFileSync(
      path.join(root, "node_modules/example/package.json"),
      '{"version":"0.9.0"}',
    );
    assert.equal(needsInstall(root), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
