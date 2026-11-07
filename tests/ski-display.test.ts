import { test } from "node:test";
import assert from "node:assert/strict";
import {
  displayGeometry,
  displayPaths,
  geometrySeparation,
} from "../shared/ski-display.js";
import type { SkiLine, Coord } from "../shared/ski.js";
const line = (id: string, cs: Coord[], difficulty = "easy"): SkiLine => ({
  id,
  name: id,
  kind: "piste",
  coordinates: cs,
  difficulty,
  direction: null,
  source: "https://www.openstreetmap.org/way/1",
  stations: [],
});
test("presentation topology retains source IDs, reversals and conflict attributes without duplicate edges", () => {
  const a = line("a", [
      [40, 43],
      [40.001, 43],
    ]),
    b = line(
      "b",
      [
        [40.001, 43],
        [40, 43],
      ],
      "intermediate",
    );
  const source = JSON.stringify([a, b]),
    d = displayGeometry([a, b]);
  assert.equal(d.segments.length, 1);
  assert.equal(d.segments[0].sources.length, 2);
  assert.equal(d.segments[0].conflict, true);
  assert.equal(JSON.stringify([a, b]), source);
});
test("partially shared routes with differently sampled collinear edges are split, crossing routes stay separate", () => {
  const a = line("a", [
      [40, 43],
      [40.002, 43],
    ]),
    b = line("b", [
      [40.001, 43],
      [40.002, 43],
    ]),
    cross = line(
      "cross",
      [
        [40.001, 42.999],
        [40.001, 43.001],
      ],
      "intermediate",
    );
  const d = displayGeometry([a, b, cross]);
  assert.equal(d.segments.length, 4);
  assert.equal(d.segments.filter((s) => s.sources.length === 2).length, 1);
});
test("close parallel routes and misleading identical endpoints are not automatically merged", () => {
  const a = line("a", [
      [40, 43],
      [40.002, 43],
    ]),
    b = line("b", [
      [40, 43.00001],
      [40.002, 43.00001],
    ]);
  assert.ok(geometrySeparation(a.coordinates, b.coordinates) < 2);
  assert.equal(displayGeometry([a, b]).segments.length, 2);
  const curved: Coord[] = [
    [40, 43],
    [40.001, 43.001],
    [40.002, 43],
  ];
  assert.ok(geometrySeparation(a.coordinates, curved) > 50);
});
test("legacy rings are retained as separate uncertain contours, never fabricated centerlines", () => {
  const ring = line("ring", [
    [40, 43],
    [40.001, 43],
    [40.001, 43.001],
    [40, 43],
  ]);
  const d = displayGeometry([ring]);
  assert.equal(d.contours[0], ring);
  assert.equal(d.segments.length, 0);
  assert.equal(d.sourceCount, 1);
});

test("render chains preserve every vertex and provenance but do not restart dashes/caps at each edge", () => {
  const l = line("a", [
      [40, 43],
      [40.001, 43.001],
      [40.002, 43],
    ]),
    d = displayGeometry([l]),
    paths = displayPaths(d.segments);
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0].coordinates, l.coordinates);
  assert.equal(paths[0].sources[0], l);
});
test("explicit area=no preserves a real closed ski loop as a line", () => {
  const loop = {
    ...line("loop", [
      [40, 43],
      [40.001, 43],
      [40.001, 43.001],
      [40, 43],
    ]),
    osmTags: { area: "no" },
  };
  assert.equal(displayGeometry([loop]).contours.length, 0);
  assert.equal(displayPaths(displayGeometry([loop]).segments).length, 1);
});
test("new OSM normalizer preserves area and conflicting parent-relation provenance", async () => {
  const { normalizeOverpass } = await import("../shared/ski-import.js");
  const result = normalizeOverpass(
    {
      elements: [
        {
          type: "way",
          id: 1,
          tags: { "piste:type": "downhill", area: "no" },
          geometry: [
            { lon: 40, lat: 43 },
            { lon: 40.001, lat: 43.001 },
          ],
        },
        ...[2, 3].map((id, i) => ({
          type: "relation",
          id,
          tags: {
            route: "piste",
            "piste:type": "downhill",
            "piste:difficulty": i ? "easy" : "intermediate",
          },
          members: [{ type: "way", ref: 1 }],
        })),
      ],
    },
    "2026-11-05",
    {
      target: {
        id: "synthetic",
        name: "SYNTHETIC",
        aliases: [],
        region: "TEST",
        bbox: [39.9, 42.9, 40.1, 43.1],
      },
    },
  );
  const l = result.bundles[0].lines[0];
  assert.equal(l.osmTags!.area, "no");
  assert.equal(l.difficulty, null);
  assert.equal(l.routeRelations!.length, 2);
  assert.deepEqual(
    l.routeRelations!.map((r) => r.id),
    ["relation-2", "relation-3"],
  );
});
