import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  namedRoutes,
  logicalRoutePaths,
  generalizeLogicalRoutes,
  normalizedRouteName,
} from "../shared/named-routes.js";
import { displayGeometry } from "../shared/ski-display.js";
import { analyze } from "../shared/track.js";
import type { SkiBundle, SkiLine, Coord } from "../shared/ski.js";
import {
  validateCleanTopography,
  rasterSkiPolicy,
} from "../frontend/src/ski/basemaps.js";
const payload = JSON.parse(
    gunzipSync(
      fs.readFileSync("map-sources/prepared/dombay-2026-11-06.slopemap"),
    ).toString(),
  ),
  b: SkiBundle = JSON.parse(payload.entries[0].json);
test("REAL package: nine name matches are partial associations, Lii stays unmapped, no fuzzy guessing", () => {
  const r = namedRoutes(b);
  assert.equal(r.length, 10);
  assert.equal(r.filter((r) => r.status === "osm-name-match").length, 9);
  assert.equal(r.flatMap((r) => r.lineIds).length, 14);
  const forest = r.find((r) => r.name === "Лесная")!;
  assert.deepEqual(forest.lineIds, ["way-1117972577"]);
  assert.deepEqual(forest.difficulties, ["easy", "intermediate"]);
  assert.ok(!forest.lineIds.includes("way-1117972576"));
  assert.equal(r.at(-1)!.status, "unmatched");
  assert.equal(r.at(-1)!.components, 0);
  assert.equal(
    normalizedRouteName("Мусса — Ачитара"),
    normalizedRouteName("Мусса-Ачитара"),
  );
  assert.ok(r.every((r) => r.extent === "not-operator-verified"));
});
const line = (id: string, cs: Coord[], difficulty = "easy"): SkiLine => ({
  id,
  name: "Домбай 2",
  kind: "piste",
  geometryRole: "centerline",
  coordinates: cs,
  difficulty,
  direction: null,
  stations: [],
  source: "https://www.openstreetmap.org/way/1",
});
test("logical routes join exact connected degree-two parts, keep disconnected components and real branches", () => {
  const lines = [
    line("a", [
      [40, 43],
      [40.001, 43],
    ]),
    line("b", [
      [40.001, 43],
      [40.002, 43],
    ]),
    line("remote", [
      [41, 43],
      [41.001, 43],
    ]),
  ];
  const bundle = { ...b, lines, areas: [] };
  const routes = namedRoutes(bundle),
    route = routes.find((r) => r.name === "Домбай 2")!;
  assert.equal(route.components, 2);
  const paths = logicalRoutePaths(displayGeometry(lines).segments, routes);
  assert.equal(paths.length, 2);
  assert.ok(paths.some((p) => p.coordinates.length === 3));
  const branch = line("fork", [
    [40.001, 43],
    [40.001, 43.001],
  ]);
  const fork = logicalRoutePaths(
    displayGeometry([...lines, branch]).segments,
    namedRoutes({ ...bundle, lines: [...lines, branch] }),
  );
  assert.equal(fork.length, 4);
  assert.ok(
    fork.every((p) =>
      p.coordinates.every((c) =>
        [...lines, branch].some((l) =>
          l.coordinates.some((v) => v[0] === c[0] && v[1] === c[1]),
        ),
      ),
    ),
  );
});
test("different difficulty fragments do not get one arbitrary route color", () => {
  const lines = [
      line("a", [
        [40, 43],
        [40.001, 43],
      ]),
      line(
        "b",
        [
          [40.001, 43],
          [40.002, 43],
        ],
        "intermediate",
      ),
    ],
    routes = namedRoutes({ ...b, lines, areas: [] });
  assert.equal(
    logicalRoutePaths(displayGeometry(lines).segments, routes).length,
    2,
  );
});
test("presentation mode preparation never mutates full GPS geometry/analysis", () => {
  const before = JSON.stringify(b),
    points = Array.from({ length: 20 }, (_, i) => ({
      lat: 43.282 + i * 0.00018,
      lon: 41.65,
      t: 1700000000000 + i * 5000,
      alt: 2500 - i * 5,
      altAccuracy: 2,
      accuracy: 4,
    }));
  const a = analyze(points, { lines: b.lines, areas: b.areas });
  logicalRoutePaths(displayGeometry(b.lines).segments, namedRoutes(b));
  assert.equal(JSON.stringify(b), before);
  assert.deepEqual(analyze(points, { lines: b.lines, areas: b.areas }), a);
});
test("baked raster protection and explicit keyless clean-provider configuration", () => {
  assert.equal(rasterSkiPolicy(true, false, true, true, 15).pistes, true);
  assert.equal(rasterSkiPolicy(true, true, true, true, 15).pistes, false);
  assert.equal(rasterSkiPolicy(true, false, false, true, 15).pistes, false);
  assert.equal(rasterSkiPolicy(false, false, true, true, 15).pistes, false);
  assert.equal(rasterSkiPolicy(true, false, true, false, 15).pistes, false);
  assert.equal(rasterSkiPolicy(true, false, true, false, 15).lifts, true);
  assert.equal(rasterSkiPolicy(true, false, true, false, 8).lifts, false);
  assert.equal(rasterSkiPolicy(true, false, true, false, 12).lifts, false);
  assert.equal(rasterSkiPolicy(true, false, true, false, 12).gondolas, true);
  const config = {
    url: "https://example.org/{z}/{x}/{y}.png",
    name: "OWN LICENSED SOURCE",
    attribution: "Owner",
    licenseUrl: "https://example.org/license",
    termsUrl: "https://example.org/terms",
    maxNativeZoom: 17,
    skiLines: "absent",
  };
  assert.ok(validateCleanTopography(config));
  assert.equal(
    validateCleanTopography({ ...config, url: config.url + "?token=secret" }),
    null,
  );
  assert.equal(
    validateCleanTopography({
      ...config,
      url: "http://example.org/{z}/{x}/{y}.png",
    }),
    null,
  );
  assert.equal(
    validateCleanTopography({ ...config, skiLines: "unknown" }),
    null,
  );
  assert.equal(validateCleanTopography(null), null);
});

test("named-route LOD retains provenance/endpoints and never changes original sources", () => {
  const routes = namedRoutes(b),
    paths = logicalRoutePaths(displayGeometry(b.lines).segments, routes),
    before = JSON.stringify(b);
  const far = generalizeLogicalRoutes(paths, routes, 12),
    near = generalizeLogicalRoutes(paths, routes, 17);
  assert.ok(
    far.reduce((s, p) => s + p.coordinates.length, 0) <=
      near.reduce((s, p) => s + p.coordinates.length, 0),
  );
  paths.forEach((p, i) => {
    assert.equal(far[i].sources, p.sources);
    assert.deepEqual(far[i].coordinates[0], p.coordinates[0]);
    assert.deepEqual(far[i].coordinates.at(-1), p.coordinates.at(-1));
  });
  assert.equal(JSON.stringify(b), before);
});
test("name:ru, piste:name and explicit parent membership are evidence; bare ref is not an invented catalogue number", () => {
  const a = {
      ...line("a", [
        [40, 43],
        [40.001, 43],
      ]),
      name: "Dombay",
      osmTags: { name: "Dombay", "name:ru": "Домбай 2", "piste:ref": "5" },
    },
    c = {
      ...line("c", [
        [40, 43],
        [40, 43.001],
      ]),
      name: "Unlabelled",
      osmTags: { "piste:name": "Солнечная" },
    },
    d = {
      ...line("d", [
        [40, 43],
        [40.002, 43],
      ]),
      name: "Unknown",
      osmTags: { "piste:ref": "10" },
      routeRelations: [
        { id: "relation-1", name: "Старый Домбай", difficulty: "easy" },
      ],
    };
  const r = namedRoutes({ ...b, areas: [], lines: [a, c, d] });
  assert.deepEqual(r.find((r) => r.name === "Домбай 2")!.lineIds, ["a"]);
  assert.deepEqual(r.find((r) => r.name === "Солнечная")!.lineIds, ["c"]);
  assert.deepEqual(
    r.find((r) => r.name === "Старый Домбай")!.evidence[0].relationIds,
    ["relation-1"],
  );
  assert.equal(r.at(-1)!.status, "unmatched");
  const conflicting = {
    ...a,
    osmTags: { name: "Домбай 2", "name:ru": "Солнечная" },
  };
  assert.ok(
    namedRoutes({ ...b, areas: [], lines: [conflicting] }).every(
      (r) => r.lineIds.length === 0,
    ),
  );
});
test("one way in two named route relations retains both memberships without arbitrary overwrite", () => {
  const source = {
    ...line("shared", [
      [40, 43],
      [40.001, 43],
    ]),
    name: "Unknown",
    routeRelations: [
      { id: "relation-1", name: "Солнечная", difficulty: "easy" },
      { id: "relation-2", name: "Домбай 2", difficulty: "easy" },
    ],
  };
  const routes = namedRoutes({ ...b, areas: [], lines: [source] });
  assert.equal(routes.filter((r) => r.lineIds.includes("shared")).length, 2);
  const paths = logicalRoutePaths(displayGeometry([source]).segments, routes);
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0].coordinates, source.coordinates);
});
