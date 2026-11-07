// SYNTHETIC GPS fixtures. Never presented as a real user recording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, type Point } from "../shared/track.js";
import type { SkiLine } from "../shared/ski.js";
const piste: SkiLine = {
  id: "synthetic-piste",
  name: "SYNTHETIC piste",
  kind: "piste",
  coordinates: [
    [40, 43],
    [40, 43.02],
  ],
  difficulty: "easy",
  direction: null,
  stations: [],
  source: "https://www.openstreetmap.org/copyright",
};
const extent: SkiLine = {
  ...piste,
  id: "synthetic-map-extent",
  kind: "lift",
  coordinates: [
    [39.99, 42.99],
    [40.01, 43.03],
  ],
};
const lines = [piste, extent];
const track = (offset: (i: number) => number = () => 0): Point[] =>
  Array.from({ length: 61 }, (_, i) => ({
    lat: 43.002 + i * 0.0002,
    lon: 40 + offset(i),
    t: 1700000000000 + i * 5000,
    alt: 2500 - i * 5,
    altAccuracy: 2,
    accuracy: 4,
  }));
test("on-piste descent stays on piste; original GPS and repeated analysis remain unchanged", () => {
  const ps = track(),
    before = JSON.stringify(ps),
    a = analyze(ps, { lines });
  assert.ok(a.terrain!.pisteDistance > 1000);
  assert.equal(a.terrain!.offPisteDistance, 0);
  assert.equal(JSON.stringify(ps), before);
  assert.deepEqual(a, analyze(ps, { lines }));
});
test("sustained measured downhill outside known pistes is probable, including partial-map warning", () => {
  const a = analyze(
      track(() => 0.001),
      { lines },
    ),
    t = a.terrain!;
  assert.ok(t.offPisteDistance > 1000);
  assert.ok(t.offPisteSeconds >= 30);
  assert.equal(t.mapCoverage, "partial");
  assert.ok(
    t.segments.some(
      (s) =>
        s.reason === "outside-known-pistes-partial-map" &&
        s.confidence === "probable",
    ),
  );
});
test("piste to off-piste to piste is classified per segment with entry and return hysteresis", () => {
  const a = analyze(
      track((i) => (i < 16 || i > 43 ? 0 : 0.001)),
      { lines },
    ),
    t = a.terrain!;
  assert.ok(t.pisteDistance > 300);
  assert.ok(t.offPisteDistance > 300);
  assert.ok(t.segments.some((s) => s.type === "piste" && s.from > 43));
  assert.equal(t.offPisteCount, 1);
});
test("nearby piste, parallel ambiguity, noisy GPS, gaps, stops and uphill do not become freeride", () => {
  for (const ps of [
    track(() => 0.0001),
    track(() => 0.001).map((p) => ({ ...p, accuracy: 60 })),
    track(() => 0.001).map((p) => ({ ...p, alt: null })),
    track(() => 0.001).map((p, i) => ({ ...p, alt: 2500 + i * 5 })),
    track(() => 0.001).map((p) => ({ ...p, lat: 43.005 })),
    track(() => 0.001).filter((_, i) => i % 10 === 0),
  ])
    assert.equal(analyze(ps, { lines }).terrain!.offPisteDistance, 0);
  const parallel = {
    ...piste,
    id: "parallel",
    coordinates: piste.coordinates.map(
      (c) => [c[0] + 0.0001, c[1]] as [number, number],
    ),
  };
  assert.equal(
    analyze(
      track(() => 0.00005),
      { lines: [...lines, parallel] },
    ).terrain!.offPisteDistance,
    0,
  );
});
test("no map, outside actual map extent, absent trusted vertical data and isolated drift stay unknown", () => {
  assert.equal(analyze(track(() => 0.001)).terrain!.offPisteDistance, 0);
  assert.equal(
    analyze(
      track(() => 0.05),
      { lines },
    ).terrain!.offPisteDistance,
    0,
  );
  assert.equal(
    analyze(
      track(() => 0.001).map((p) => ({ ...p, altAccuracy: null })),
      { lines },
    ).terrain!.offPisteDistance,
    0,
  );
  assert.equal(
    analyze(
      track((i) => (i === 20 ? 0.001 : 0)),
      { lines },
    ).terrain!.offPisteDistance,
    0,
  );
});
test("OSM freeride route remains probable and confirmed lift is separate from downhill", () => {
  const freeride = { ...piste, difficulty: "freeride" };
  assert.ok(
    analyze(track(), { lines: [freeride, extent] }).terrain!.offPisteDistance >
      1000,
  );
  const lift = {
    ...piste,
    id: "lift",
    kind: "lift" as const,
    direction: 1 as const,
  };
  const a = analyze(
    track().map((p, i) => ({ ...p, alt: 2500 + i * 5 })),
    { lines: [piste, lift] },
  );
  assert.ok(a.terrain!.segments.some((s) => s.type === "lift"));
  assert.equal(a.terrain!.offPisteDistance, 0);
});
test("unverified closed contour coverage and fast vehicle-like movement cannot prove freeride", () => {
  const ring = {
    ...piste,
    id: "uncertain-ring",
    coordinates: [
      [39.999, 43],
      [40.002, 43],
      [40.002, 43.02],
      [39.999, 43.02],
      [39.999, 43],
    ] as [number, number][],
  };
  assert.equal(
    analyze(
      track(() => 0.001),
      { lines: [...lines, ring] },
    ).terrain!.offPisteDistance,
    0,
  );
  const fast = track(() => 0.001).map((p, i) => ({
    ...p,
    lat: 43.002 + i * 0.0015,
  }));
  assert.equal(analyze(fast, { lines }).terrain!.offPisteDistance, 0);
});
