import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, distance, type Point } from "../shared/track.js";
import { demoTrack } from "../shared/demo.js";
const p = (lat: number, t: number, extra: Partial<Point> = {}): Point => ({
  lat,
  lon: 0,
  t: 1700000000000 + t * 1000,
  accuracy: 3,
  ...extra,
});
test("haversine: equatorial degree and identical points", () => {
  assert.ok(Math.abs(distance(p(0, 0), p(1, 1)) - 111194.9) < 1);
  assert.equal(distance(p(0, 0), p(0, 1)), 0);
});
test("distance-derived speed; sensor speed cannot inflate records", () => {
  const a = analyze([p(0, 0, { speed: 999 }), p(0.001, 10)]);
  assert.ok(Math.abs(a.distance - 111.195) < 0.1);
  assert.ok(Math.abs(a.maxSpeed - 11.1195) < 0.01);
  assert.equal(a.runs.length, 0);
  assert.equal(a.drop, null);
  assert.equal(a.edges[0].kind, "unknown");
});
test("outliers, bad accuracy and duplicate timestamps are rejected", () => {
  const a = analyze([
    p(0, 0),
    p(80, 2),
    p(0.001, 10),
    p(0.001, 10),
    p(0.002, 15, { accuracy: 200 }),
    p(0.003, 20),
  ]);
  assert.equal(a.rejected, 3);
  assert.equal(a.maxSpeed, 0);
  assert.equal(a.gaps, 2);
});
test("long gaps and explicit visibility breaks never bridge distance", () => {
  for (const points of [
    [p(0, 0), p(0.01, 60)],
    [p(0, 0), p(0.001, 10, { breakBefore: true })],
  ]) {
    const a = analyze(points);
    assert.equal(a.distance, 0);
    assert.equal(a.gaps, 1);
  }
});
test("stops are retained for time but excluded from movement", () => {
  const a = analyze([p(0, 0), p(0, 10), p(0, 20)]);
  assert.equal(a.duration, 20);
  assert.equal(a.movingSeconds, 0);
  assert.ok(a.edges.every((e) => e.kind === "stop"));
});
test("trusted synthetic altitude separates ascent and descent", () => {
  const a = analyze(demoTrack());
  assert.equal(a.runs.length, 2);
  assert.ok(a.descentDistance < a.distance);
  assert.ok(a.drop! > 400);
  assert.ok(a.edges.some((e) => e.kind === "ascent"));
});
test("unreliable altitude never produces vertical records", () => {
  const a = analyze(demoTrack().map((p) => ({ ...p, altAccuracy: null })));
  assert.equal(a.drop, null);
  assert.equal(a.runs.length, 0);
  assert.ok(a.distance > 0);
});
test("invalid coordinates and impossible time are ignored", () => {
  const a = analyze([p(91, 0), p(0, 0), p(0.001, -1), p(0.001, 10)]);
  assert.equal(a.rejected, 2);
  assert.equal(a.points.length, 2);
});
