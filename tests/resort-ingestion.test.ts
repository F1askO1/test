import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeOverpass } from "../shared/ski-import.js";
import {
  osmXmlToOverpass,
  normalizeOpenSkiData,
} from "../shared/ski-alternatives.js";
import { bundleQuality, type ResortTarget } from "../shared/ski-quality.js";
import { installBundles } from "../shared/ski-store.js";
const target: ResortTarget = {
  id: "test-resort",
  name: "SYNTHETIC ONLY",
  aliases: [],
  region: "Test",
  bbox: [41.6, 43.27, 41.7, 43.34],
};
const points = [
  { lat: 43.28, lon: 41.61 },
  { lat: 43.29, lon: 41.62 },
];
const raw = {
  elements: [
    {
      type: "way",
      id: 111,
      tags: { "piste:type": "downhill", "piste:difficulty": "easy" },
      geometry: points,
    },
    {
      type: "way",
      id: 112,
      tags: { aerialway: "chair_lift" },
      geometry: points.map((c) => ({ ...c, lon: c.lon + 0.001 })),
    },
  ],
};
const normalize = (r: unknown = raw) =>
  normalizeOverpass(r, "2026-11-05T00:00:00Z", { target }).bundles[0];
test("real-source shaped fixtures without winter_sports normalize only under an explicit named search target", () => {
  assert.equal(normalizeOverpass(raw).bundles.length, 0);
  const b = normalize();
  assert.equal(b.resort.pistes, 1);
  assert.equal(b.resort.lifts, 1);
  assert.equal(b.resort.association, "search-window");
  assert.equal(bundleQuality(b, target).status, "usable-partial");
  assert.ok(
    b.lines.every((l) =>
      l.source.startsWith("https://www.openstreetmap.org/way/"),
    ),
  );
});
test("invalid middle coordinates are never removed to create a fictional connecting line; out-of-area objects are rejected", () => {
  const bad = structuredClone(raw);
  bad.elements[0].geometry.splice(1, 0, { lat: NaN, lon: 41.6 });
  assert.equal(normalize(bad).resort.pistes, 0);
  assert.ok(
    bundleQuality(normalize(bad), target).errors.includes("no-downhill-pistes"),
  );
  const outside = structuredClone(raw);
  outside.elements[0].geometry = [
    { lat: 10, lon: 10 },
    { lat: 10.01, lon: 10 },
  ];
  assert.equal(normalize(outside).resort.pistes, 0);
});
test("route-member difficulty is inherited only when source relations agree", () => {
  const r: any = structuredClone(raw);
  r.elements[0].tags = {};
  r.elements.push({
    type: "relation",
    id: 333,
    tags: {
      route: "piste",
      "piste:type": "downhill",
      "piste:difficulty": "intermediate",
      name: "Route",
    },
    members: [{ type: "way", ref: 111 }],
  });
  assert.equal(normalize(r).lines[0].difficulty, "intermediate");
  r.elements.push({
    ...r.elements[2],
    id: 334,
    tags: { ...r.elements[2].tags, "piste:difficulty": "advanced" },
  });
  assert.equal(normalize(r).lines[0].difficulty, null);
});
test("local OSM XML handles referenced ways and rejects entities and missing node geometry", () => {
  const xml =
    '<osm><node id="1" lat="43.28" lon="41.61"/><node id="2" lat="43.29" lon="41.62"/><way id="3"><nd ref="1"/><nd ref="2"/><tag k="piste:type" v="downhill"/></way></osm>';
  const doc = osmXmlToOverpass(xml);
  assert.equal(
    normalizeOverpass(doc, "now", { target }).bundles[0].lines.length,
    1,
  );
  assert.throws(() => osmXmlToOverpass("<!DOCTYPE osm><osm/>"));
  const missing = osmXmlToOverpass(
    xml.replace('<node id="2" lat="43.29" lon="41.62"/>', ""),
  );
  assert.equal(
    normalizeOverpass(missing, "now", { target }).bundles[0].lines.length,
    0,
  );
});
test("OpenSkiData v16 adapter respects source skiAreas, skips polygons, keeps unknown difficulty and duration seconds", () => {
  const source = (id: string) => [{ type: "openstreetmap", id: "way/" + id }];
  const member = { properties: { name: target.name } };
  const doc = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          id: "run",
          type: "run",
          uses: ["downhill"],
          difficulty: "novice",
          skiAreas: [member],
          sources: source("111"),
        },
        geometry: {
          type: "LineString",
          coordinates: points.map((p) => [p.lon, p.lat]),
        },
      },
      {
        type: "Feature",
        properties: {
          id: "lift",
          type: "lift",
          liftType: "chair_lift",
          duration: 300,
          skiAreas: [member],
          sources: source("112"),
        },
        geometry: {
          type: "MultiLineString",
          coordinates: [points.map((p) => [p.lon + 0.001, p.lat])],
        },
      },
    ],
  };
  const b = normalizeOpenSkiData(doc, target, "2026-11-05");
  assert.equal(b.resort.pistes, 1);
  assert.equal(b.lines[1].durationSeconds, 300);
  assert.equal(b.lines[0].difficulty, "novice");
  assert.equal(bundleQuality(b, target).errors.length, 0);
  doc.features[0].properties.skiAreas = [
    { properties: { name: "Other resort" } },
  ];
  assert.equal(
    normalizeOpenSkiData(doc, target, "2026-11-05").resort.pistes,
    0,
  );
});
test("install merges resorts, rejects quality/count mismatch and preserves earlier catalogue atomically", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ski-store-"));
  try {
    const b = normalize();
    installBundles([b], dir, { target });
    const before = fs.readFileSync(path.join(dir, "catalog.json"), "utf8");
    const broken = structuredClone(b);
    broken.resort.pistes = 999;
    assert.throws(() => installBundles([broken], dir));
    assert.equal(
      fs.readFileSync(path.join(dir, "catalog.json"), "utf8"),
      before,
    );
    const poisoned = structuredClone(b);
    poisoned.resort.id = "__proto__";
    assert.throws(() => installBundles([poisoned], dir));
    assert.equal(
      fs.readFileSync(path.join(dir, "catalog.json"), "utf8"),
      before,
    );
    const next = structuredClone(b);
    next.resort.id = "different";
    installBundles([next], dir);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dir, "catalog.json"), "utf8"))
        .resorts.length,
      2,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("portable package includes only validated map bundles, checksum detects tampering, target SQLite/env stay byte-identical", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ski-package-"));
  try {
    const a = path.join(dir, "producer"),
      b = path.join(dir, "consumer");
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(b, ".env"), "private-unchanged");
    fs.writeFileSync(path.join(b, "existing.sqlite"), "user-data-unchanged");
    installBundles([normalize()], a);
    const pkg = path.join(dir, "maps.slopemap");
    const run = (args: string[]) =>
      execFileSync(
        process.execPath,
        [
          "--import",
          path.resolve("node_modules/tsx/dist/loader.mjs"),
          path.resolve("scripts/map-package.ts"),
          ...args,
        ],
        { stdio: "pipe", timeout: 10000 },
      );
    run(["export", pkg, a]);
    run(["inspect", pkg]);
    run(["import", pkg, b]);
    assert.equal(
      fs.readFileSync(path.join(b, ".env"), "utf8"),
      "private-unchanged",
    );
    assert.equal(
      fs.readFileSync(path.join(b, "existing.sqlite"), "utf8"),
      "user-data-unchanged",
    );
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(b, "catalog.json"), "utf8")).resorts
        .length,
      1,
    );
    fs.writeFileSync(pkg, "corrupt");
    assert.throws(() => run(["import", pkg, b]));
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(b, "catalog.json"), "utf8")).resorts
        .length,
      1,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
