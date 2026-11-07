import { test } from "node:test";
import assert from "node:assert/strict";
import {
  skiLineStyle,
  skiHaloStyle,
  showStations,
} from "../frontend/src/ski/map-style.js";
import type { SkiLine } from "../shared/ski.js";
const line: SkiLine = {
  id: "style-only",
  name: "Style test",
  kind: "piste",
  difficulty: "easy",
  coordinates: [
    [40, 43],
    [40.001, 43.001],
  ],
  direction: null,
  source: "https://www.openstreetmap.org/copyright",
  stations: [],
};
test("ski widths remain thin across zoom levels; broad casings are not applied to every source segment", () => {
  const before = JSON.stringify(line);
  for (const z of [10, 12, 14, 15, 16, 18]) {
    assert.ok(skiLineStyle(line, z).weight! <= 2.1);
    assert.equal(skiHaloStyle(line, z), null);
  }
  assert.ok(skiLineStyle(line, 12).weight! < skiLineStyle(line, 16).weight!);
  assert.ok(
    skiLineStyle(line, 16, true).weight! > skiLineStyle(line, 16).weight!,
  );
  assert.ok(skiHaloStyle({ ...line, difficulty: "advanced" }, 16));
  assert.ok(skiHaloStyle(line, 16, true));
  assert.equal(JSON.stringify(line), before);
});
test("lift lines are lighter and distinct, stations only appear at useful zoom", () => {
  const lift = { ...line, kind: "lift" as const };
  for (const z of [12, 14, 16]) {
    assert.ok(skiLineStyle(lift, z).weight! < skiLineStyle(line, z).weight!);
    assert.ok(skiLineStyle(lift, z).dashArray);
    assert.equal(skiHaloStyle(lift, z), null);
  }
  assert.equal(showStations(14), false);
  assert.equal(showStations(15), true);
});
