import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { osmXmlToOverpass } from "../shared/ski-alternatives.js";
import { normalizeOverpass } from "../shared/ski-import.js";
import {
  displayGeometry,
  displayPaths,
  generalizeDisplay,
} from "../shared/ski-display.js";
import { containsArea } from "../shared/ski-areas.js";
import { analyze } from "../shared/track.js";
const raw = osmXmlToOverpass(
  fs.readFileSync("tests/fixtures/dombay/resort.osm", "utf8"),
);
const target = JSON.parse(
  fs.readFileSync("map-sources/resorts.json", "utf8"),
).find((r: any) => r.id === "dombay");
const b = normalizeOverpass(raw, "2026-11-06", { target }).bundles[0];
test("REAL OSM: 149 source objects/coordinates preserved, boundaries distinguished from centerlines", () => {
  assert.equal(b.lines.length, 149);
  assert.equal(b.resort.pistes, 136);
  assert.equal(b.resort.lifts, 13);
  assert.equal(b.resort.classified, 131);
  const ways = new Map(
    raw.elements
      .filter((e: any) => e.type === "way")
      .map((e: any) => ["way-" + e.id, e]),
  );
  for (const l of b.lines)
    assert.deepEqual(
      l.coordinates,
      (ways.get(l.id) as any).geometry.map((p: any) => [p.lon, p.lat]),
    );
  assert.equal(
    b.lines.filter((l) => l.geometryRole === "area-boundary").length,
    107,
  );
  assert.equal(b.areas!.length, 8);
  assert.ok(b.areas!.every((a) => a.complete));
  assert.equal(
    b.lines.find((l) => l.id === "way-879140376")!.osmTags!.area,
    "yes",
  );
  const d = displayGeometry(b.lines);
  assert.equal(d.segments.length, 644);
  assert.equal(displayPaths(d.segments).length, 42);
  assert.ok(
    d.segments.every((s) =>
      s.sources.every((l) => l.geometryRole !== "area-boundary"),
    ),
  );
});
test("REAL OSM: LOD is source-vertex-only, immutable, zoom-sensitive and preserves endpoints/junctions", () => {
  const paths = displayPaths(displayGeometry(b.lines).segments),
    before = JSON.stringify(b);
  const far = generalizeDisplay(paths, 12),
    near = generalizeDisplay(paths, 17);
  assert.ok(
    far.reduce((n, p) => n + p.coordinates.length, 0) <
      near.reduce((n, p) => n + p.coordinates.length, 0),
  );
  for (let i = 0; i < paths.length; i++) {
    assert.deepEqual(far[i].coordinates[0], paths[i].coordinates[0]);
    assert.deepEqual(far[i].coordinates.at(-1), paths[i].coordinates.at(-1));
    for (const c of far[i].coordinates)
      assert.ok(paths[i].coordinates.includes(c));
  }
  const owners = new Map<string, Set<number>>();
  paths.forEach((p, i) =>
    p.coordinates.forEach((c) => {
      const k = c.join(",");
      if (!owners.has(k)) owners.set(k, new Set());
      owners.get(k)!.add(i);
    }),
  );
  paths.forEach((p, i) =>
    p.coordinates.forEach((c) => {
      if (owners.get(c.join(","))!.size > 1)
        assert.ok(far[i].coordinates.includes(c));
    }),
  );
  assert.equal(JSON.stringify(b), before);
});
test("area containment respects holes and cannot classify a perimeter as a GPS ski axis", () => {
  const area = {
    id: "synthetic-area",
    name: "SYNTHETIC area",
    difficulty: "easy",
    complete: true,
    sources: [],
    rings: [
      [
        [40, 43],
        [40.01, 43],
        [40.01, 43.02],
        [40, 43.02],
        [40, 43],
      ],
      [
        [40.004, 43.004],
        [40.006, 43.004],
        [40.006, 43.006],
        [40.004, 43.006],
        [40.004, 43.004],
      ],
    ] as [number, number][][],
  };
  assert.equal(containsArea({ lon: 40.005, lat: 43.005 }, area), false);
  assert.equal(containsArea({ lon: 40.002, lat: 43.01 }, area), true);
  const points = Array.from({ length: 30 }, (_, i) => ({
    lat: 43.008 + i * 0.0002,
    lon: 40.002,
    t: 1700000000000 + i * 5000,
    alt: 2500 - i * 5,
    altAccuracy: 2,
    accuracy: 4,
  }));
  const line = {
    ...b.lines.find((l) => l.kind === "piste")!,
    coordinates: [
      [39.99, 42.99],
      [40.02, 43.03],
    ] as [number, number][],
    geometryRole: "area-boundary" as const,
  };
  const a = analyze(points, { lines: [line], areas: [area] });
  assert.equal(a.terrain!.offPisteDistance, 0);
  assert.ok(a.terrain!.pisteDistance > 100);
});

test("overlapping areas with conflicting grooming never arbitrarily assign freeride", () => {
  const ring: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ] = [
    [40, 43],
    [40.01, 43],
    [40.01, 43.02],
    [40, 43.02],
    [40, 43],
  ];
  const area = {
    id: "synthetic",
    name: "SYNTHETIC",
    difficulty: "easy",
    complete: true,
    sources: [],
    rings: [ring],
    grooming: "classic",
  };
  const points = Array.from({ length: 30 }, (_, i) => ({
    lat: 43.008 + i * 0.0002,
    lon: 40.002,
    t: 1700000000000 + i * 5000,
    alt: 2500 - i * 5,
    altAccuracy: 2,
    accuracy: 4,
  }));
  const line = {
    ...b.lines[0],
    kind: "piste" as const,
    coordinates: [
      [39.99, 42.99],
      [40.02, 43.03],
    ] as [number, number][],
    geometryRole: "area-boundary" as const,
  };
  const a = analyze(points, {
    lines: [line],
    areas: [area, { ...area, id: "synthetic-2", grooming: "backcountry" }],
  });
  assert.equal(a.terrain!.offPisteDistance, 0);
  assert.equal(a.terrain!.pisteDistance, 0);
  assert.ok(
    a.terrain!.segments.some((s) => s.reason === "conflicting-area-tags"),
  );
});
