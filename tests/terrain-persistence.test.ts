import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDb,
  ensureUser,
  saveSession,
  getSession,
} from "../backend/src/db.js";
import { analyze } from "../shared/track.js";
import { randomUUID } from "node:crypto";
test("optional terrain JSON survives SQLite reopen; legacy records and raw points remain readable without migration", () => {
  const dir = mkdtempSync(join(tmpdir(), "slopemate-terrain-")),
    file = join(dir, "test.sqlite");
  let db = openDb(file);
  try {
    ensureUser(db, { id: 1, first_name: "SYNTHETIC" });
    const points = Array.from({ length: 10 }, (_, i) => ({
      lat: 43 + i * 0.0002,
      lon: 40,
      t: 1700000000000 + i * 5000,
      accuracy: 4,
      alt: 2500 - i * 5,
      altAccuracy: 2,
    }));
    const id = randomUUID();
    saveSession(db, 1, {
      id,
      points,
      resort: "SYNTHETIC",
      trip: "",
      source: "gps",
    });
    const before = getSession(db, 1, id)!.analysis;
    db.close();
    db = openDb(file);
    assert.deepEqual(getSession(db, 1, id)!.analysis, before);
    assert.deepEqual(getSession(db, 1, id)!.analysis.points, points);
    const old = { ...analyze(points) };
    delete old.terrain;
    db.prepare("UPDATE sessions SET analysis=? WHERE id=?").run(
      JSON.stringify(old),
      id,
    );
    const legacy = getSession(db, 1, id)!;
    assert.deepEqual(legacy.analysis.points, points);
    assert.equal(legacy.analysis.engineVersion, 2);
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
