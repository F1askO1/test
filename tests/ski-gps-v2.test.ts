import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, type Point } from "../shared/track.js";
import { analyze as legacy } from "../shared/track-v1.js";
import {
  matchLift,
  matchPiste,
  project,
  lineLength,
  pisteColor,
  lineIndex,
  type SkiLine,
} from "../shared/ski.js";
import { normalizeOverpass } from "../shared/ski-import.js";
import { demoTrack } from "../shared/demo.js";
// @ts-expect-error Native launcher module is tested through its runtime API.
import { statusGate } from "../scripts/network-utils.mjs";
const point = (i: number, alt: number | null = 1000 - i * 2): Point => ({
  lat: 43 + i * 0.0001,
  lon: 40,
  t: 1700000000000 + i * 5000,
  alt,
  altAccuracy: 2,
  accuracy: 4,
});
const track = (n = 80) => Array.from({ length: n }, (_, i) => point(i));
const lift: SkiLine = {
  id: "test-lift",
  name: "Синтетический кресельный",
  kind: "lift",
  coordinates: [
    [40, 43],
    [40, 43.01],
  ],
  direction: 1,
  difficulty: null,
  source: "synthetic",
  stations: [],
};
test("v2 gradual descent survives altitude differences below individual point threshold", () => {
  const ps = track();
  assert.equal(legacy(ps).runs.length, 0);
  assert.equal(analyze(ps).runs.length, 1);
  assert.equal(analyze(ps).engineVersion, 2);
  assert.ok(analyze(ps).drop! > 100);
});
test("v2 GPX trend without vertical precision is preliminary, never a vertical record", () => {
  const a = analyze(track().map((p) => ({ ...p, altAccuracy: null })));
  assert.equal(a.runs.length, 1);
  assert.equal(a.drop, null);
  assert.equal(a.altitudeQuality, "inferred");
});
test("short stop stays in a run, long rest and gaps split it; ascent is not a downhill bridge", () => {
  const ps = track();
  for (let i = 30; i < 33; i++) ps[i] = { ...ps[29], t: ps[i].t };
  assert.equal(analyze(ps).runs.length, 1);
  const gap = track();
  gap[40].breakBefore = true;
  assert.equal(analyze(gap).runs.length, 2);
  const rest = track(100);
  for (let i = 30; i < 45; i++) rest[i] = { ...rest[29], t: rest[i].t };
  assert.equal(analyze(rest).runs.length, 2);
  assert.equal(analyze(demoTrack()).runs.length, 2);
});
test("unknown altitude, jitter, impossible jumps and gaps never invent descents", () => {
  assert.equal(
    analyze(track().map((p) => ({ ...p, alt: null }))).runs.length,
    0,
  );
  const jitter = track().map((p, i) => ({ ...p, alt: 1000 + Math.sin(i) * 2 }));
  assert.equal(analyze(jitter).runs.length, 0);
  const ps = track();
  ps[20] = { ...ps[20], lat: 80 };
  assert.ok(analyze(ps).rejected > 0);
  assert.ok(analyze(ps).gaps > 0);
});
test("polyline projection uses actual bends and along-line remaining length", () => {
  const cs: [number, number][] = [
    [40, 43],
    [40, 43.005],
    [40.005, 43.005],
  ];
  const p = project(point(20), cs);
  assert.ok(p.total > 800);
  assert.ok(p.total - p.along > 500);
  assert.equal(pisteColor("easy"), "#1768d5");
  assert.equal(pisteColor(null), "#737985");
});
test("lift requires history, valid accuracy, progression and upward evidence; ETA stops during halt", () => {
  const ps = Array.from({ length: 15 }, (_, i) => ({
    ...point(i),
    alt: 1000 + i * 3,
  }));
  const m = matchLift(ps, [lift]);
  assert.equal(m?.confidence, "confirmed");
  assert.ok(m!.etaSeconds! > 0);
  assert.ok(m!.remaining < lineLength(lift.coordinates));
  assert.equal(
    matchLift(
      ps.map((p) => ({ ...p, accuracy: 100 })),
      [lift],
    ),
    null,
  );
  assert.equal(matchLift(track(15), [lift]), null);
  assert.equal(
    matchLift(
      ps.map((p) => ({ ...p, lon: 40.003 })),
      [lift],
    ),
    null,
  );
  assert.equal(
    matchLift(
      ps.map((p, i) => ({ ...p, breakBefore: i === 8 })),
      [lift],
    ),
    null,
  );
  const stop = [
    ...ps,
    ...Array.from({ length: 5 }, (_, i) => ({
      ...ps.at(-1)!,
      t: ps.at(-1)!.t + (i + 1) * 5000,
    })),
  ];
  assert.equal(matchLift(stop, [lift])?.state, "stopped");
  assert.equal(matchLift(stop, [lift])?.etaSeconds, null);
});
test("parallel pistes, crossing trajectories and no geometry remain unknown", () => {
  const piste = { ...lift, kind: "piste" as const, difficulty: "easy" };
  assert.ok(matchPiste(track().slice(-5), [piste]));
  assert.equal(
    matchPiste(track().slice(-5), [
      piste,
      {
        ...piste,
        id: "second",
        coordinates: [
          [40.00001, 43],
          [40.00001, 43.01],
        ],
      },
    ]),
    null,
  );
  assert.equal(matchPiste(track(), []), null);
  assert.equal(matchLift(track(), []), null);
  const indexed = lineIndex([lift]);
  assert.equal(indexed(point(1)).length, 1);
  assert.equal(indexed({ ...point(1), lon: 90 }).length, 0);
});
test("OSM normalization preserves source, difficulty and unknown direction; no inferred station endpoints", () => {
  const input = {
    elements: [
      {
        type: "way",
        id: 1,
        tags: { landuse: "winter_sports", name: "Синтетический курорт" },
        geometry: [
          { lat: 43, lon: 40 },
          { lat: 43.02, lon: 40.02 },
        ],
      },
      {
        type: "way",
        id: 2,
        tags: {
          "piste:type": "downhill",
          "piste:difficulty": "intermediate",
          name: "Тестовая трасса",
        },
        geometry: [
          { lat: 43.001, lon: 40.001 },
          { lat: 43.01, lon: 40.01 },
        ],
      },
      {
        type: "way",
        id: 3,
        tags: { aerialway: "chair_lift", "aerialway:duration": "5" },
        geometry: [
          { lat: 43, lon: 40 },
          { lat: 43.01, lon: 40 },
        ],
      },
    ],
  };
  const result = normalizeOverpass(input, "2026-11-05");
  assert.equal(result.catalog.resorts.length, 1);
  assert.equal(result.catalog.resorts[0].classified, 1);
  assert.equal(result.bundles[0].lines[0].difficulty, "intermediate");
  assert.equal(result.bundles[0].lines[1].durationSeconds, 300);
  assert.equal(result.bundles[0].lines[1].direction, null);
  assert.deepEqual(result.bundles[0].lines[1].stations, []);
  assert.throws(() => normalizeOverpass({}));
});
test("launcher prints changes/errors immediately, recovery and ten-minute summaries; suppresses repeats", () => {
  const gate = statusGate();
  assert.equal(gate("db", "ready", 0).print, true);
  assert.equal(gate("db", "ready", 30000).print, false);
  assert.equal(gate("db", "ready", 600000).print, true);
  assert.equal(gate("db", "failed", 600001, true).print, true);
  assert.equal(gate("db", "ready", 600002).recovered, true);
});
test("long synthetic recording remains bounded without any map geometry", () => {
  const ps = Array.from({ length: 12000 }, (_, i) => ({
    ...point(i),
    lat: 43 + (i % 200) * 0.00005,
    breakBefore: i % 200 === 0,
  }));
  const start = performance.now();
  const a = analyze(ps);
  assert.equal(a.points.length, 12000);
  assert.ok(performance.now() - start < 5000);
});
