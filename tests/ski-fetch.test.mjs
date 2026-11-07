import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchResort, queryFor, phases } from "../scripts/ski-fetch.mjs";
const target = {
  id: "synthetic-test",
  name: "Synthetic only",
  bbox: [41.6, 43.27, 41.7, 43.34],
  region: "test",
  aliases: [],
};
const ok = (elements = []) =>
  new Response(JSON.stringify({ elements }), {
    headers: { "Content-Type": "application/json" },
  });
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ski-fetch-"));
const options = (root) => ({
  root,
  sleepFn: async () => {},
  log: () => {},
  random: () => 0,
});
test("bounded resort queries include route members, never Russia-wide area downloads", () => {
  for (const phase of phases) {
    const q = queryFor(target, phase);
    assert.ok(q.includes("[timeout:45]"));
    assert.ok(q.includes("(43.27,41.6,43.34,41.7)"));
    assert.ok(!q.includes("area["));
    assert.ok(q.endsWith("out body geom;"));
  }
  assert.ok(queryFor(target, "pistes").includes("way(r.routes)"));
  assert.throws(() => queryFor({ ...target, bbox: [0, 0, 100, 80] }, "pistes"));
});
test("transient failures use bounded retries and successful chunks are reused with checksum verification", async () => {
  const root = temp();
  try {
    let calls = 0;
    const delays = [];
    const fetchFn = async () => {
      calls++;
      if (calls === 1) return new Response("", { status: 503 });
      return ok();
    };
    const opts = {
      ...options(root),
      fetchFn,
      sleepFn: async (ms) => delays.push(ms),
    };
    await fetchResort(target, opts);
    assert.equal(calls, 5);
    assert.ok(delays.includes(1500));
    await fetchResort(target, opts);
    assert.equal(calls, 5);
    const part = path.join(root, "raw", target.id, "pistes.json");
    fs.writeFileSync(part, "corrupt");
    await fetchResort(target, opts);
    assert.equal(calls, 6);
    assert.ok(
      fs.existsSync(path.join(root, "prepared", target.id, "provenance.json")),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("interrupted resort resumes missing phase and never creates a prepared partial snapshot", async () => {
  const root = temp();
  try {
    let calls = 0;
    await assert.rejects(
      fetchResort(target, {
        ...options(root),
        maxAttempts: 2,
        fetchFn: async () => {
          calls++;
          if (calls === 1) return ok();
          throw Object.assign(Error("offline"), { code: "ECONNRESET" });
        },
      }),
    );
    assert.equal(calls, 3);
    assert.ok(
      !fs.existsSync(path.join(root, "prepared", target.id, "overpass.json")),
    );
    let resumed = 0;
    await fetchResort(target, {
      ...options(root),
      fetchFn: async () => {
        resumed++;
        return ok();
      },
    });
    assert.equal(resumed, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("403 including nested proxy CONNECT errors stops immediately; errors never print credentials", async () => {
  for (const nested of [false, true]) {
    const root = temp();
    try {
      let calls = 0;
      const cause = Object.assign(
        Error("Proxy response (403) !== 200 when HTTP Tunneling"),
        { code: "UND_ERR_ABORTED" },
      );
      await assert.rejects(
        fetchResort(target, {
          ...options(root),
          fetchFn: async () => {
            calls++;
            if (nested)
              throw Object.assign(Error("secret-value-never-log"), { cause });
            return new Response("", { status: 403 });
          },
        }),
        (e) => e.status === 403 && !e.message.includes("secret-value"),
      );
      assert.equal(calls, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
test("Overpass remark is not success and 429 delay is honored within cap", async () => {
  const root = temp();
  try {
    let calls = 0;
    const delays = [];
    await fetchResort(target, {
      ...options(root),
      sleepFn: async (ms) => delays.push(ms),
      fetchFn: async () => {
        calls++;
        if (calls === 1)
          return new Response("", {
            status: 429,
            headers: { "retry-after": "999" },
          });
        if (calls === 2)
          return new Response(
            JSON.stringify({ remark: "timeout", elements: [] }),
          );
        return ok();
      },
    });
    assert.equal(calls, 6);
    assert.ok(delays.includes(30000));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("endpoint/query changes invalidate cache, refresh explicitly reloads all phases", async () => {
  const root = temp();
  try {
    let calls = 0;
    const opts = {
      ...options(root),
      fetchFn: async () => {
        calls++;
        return ok();
      },
    };
    await fetchResort(target, opts);
    await fetchResort(target, { ...opts, refresh: true });
    assert.equal(calls, 8);
    await fetchResort({ ...target, bbox: [41.61, 43.27, 41.7, 43.34] }, opts);
    assert.equal(calls, 12);
    await assert.rejects(
      fetchResort(target, {
        ...opts,
        endpoint: "https://user:secret@example.org",
      }),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent fetch of one resort is refused and locks are released after failure", async () => {
  const root = temp();
  try {
    let unblock;
    const hold = new Promise((r) => {
      unblock = r;
    });
    const first = fetchResort(target, {
      ...options(root),
      fetchFn: async () => {
        await hold;
        return ok();
      },
    });
    await new Promise((r) => setTimeout(r, 5));
    await assert.rejects(
      fetchResort(target, { ...options(root), fetchFn: async () => ok() }),
      /уже загружается/,
    );
    unblock();
    await first;
    assert.ok(!fs.existsSync(path.join(root, "raw", target.id, ".fetch.lock")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
