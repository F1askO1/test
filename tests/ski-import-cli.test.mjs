import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
test("offline importer writes versioned bundles atomically, rejects malformed data without replacing the catalogue", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slope-map-import-"));
  const root = process.cwd();
  try {
    const input = {
      elements: [
        {
          type: "way",
          id: 123,
          tags: { landuse: "winter_sports", name: "Synthetic" },
          geometry: [
            { lat: 43, lon: 40 },
            { lat: 43.01, lon: 40.01 },
          ],
        },
        {
          type: "way",
          id: 124,
          tags: { "piste:type": "downhill", "piste:difficulty": "easy" },
          geometry: [
            { lat: 43.001, lon: 40.001 },
            { lat: 43.008, lon: 40.008 },
          ],
        },
        {
          type: "way",
          id: 125,
          tags: { aerialway: "chair_lift" },
          geometry: [
            { lat: 43.001, lon: 40.002 },
            { lat: 43.008, lon: 40.009 },
          ],
        },
      ],
    };
    const file = path.join(dir, "source.json");
    fs.writeFileSync(file, JSON.stringify(input));
    const run = () =>
      execFileSync(
        process.execPath,
        [
          "--import",
          path.join(root, "node_modules/tsx/dist/loader.mjs"),
          path.join(root, "scripts/import-ski.ts"),
          file,
        ],
        { cwd: dir, encoding: "utf8", timeout: 10000 },
      );
    run();
    const before = fs.readFileSync(
      path.join(dir, "map-data/catalog.json"),
      "utf8",
    );
    const c = JSON.parse(before);
    assert.equal(c.resorts.length, 1);
    assert.ok(fs.existsSync(path.join(dir, "map-data", c.files["way-123"])));
    assert.ok(fs.existsSync(path.join(dir, "map-data/coverage.json")));
    fs.writeFileSync(file, JSON.stringify({ remark: "partial query" }));
    assert.throws(run);
    assert.equal(
      fs.readFileSync(path.join(dir, "map-data/catalog.json"), "utf8"),
      before,
    );
    assert.ok(!fs.existsSync(path.join(dir, "map-data/.import.lock")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
