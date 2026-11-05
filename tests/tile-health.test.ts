import { test } from "node:test";
import assert from "node:assert/strict";
import { tileHealth } from "../frontend/src/ski/tile-health.js";
test("tile failure, partial successes and timeout are separate states", () => {
  assert.equal(tileHealth(0, 0).state, "loading");
  assert.equal(tileHealth(0, 3).state, "unavailable");
  assert.equal(tileHealth(1, 3).state, "partial");
  assert.equal(tileHealth(5, 0, true).state, "ready");
  assert.equal(tileHealth(0, 0, true).state, "unavailable");
});
