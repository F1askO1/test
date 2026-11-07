import { test } from "node:test";
import assert from "node:assert/strict";
import {
  viewportTileHealth,
  type VisibleTile,
} from "../frontend/src/ski/tile-health.js";
const view = { x: 0, y: 0, width: 512, height: 512 };
const tile = (
  key: string,
  x: number,
  y: number,
  state: VisibleTile["state"] = "loaded",
): VisibleTile => ({
  key,
  rect: { x, y, width: 256, height: 256 },
  state,
  source: "topo",
});
test("one successful tile is only 25% viewport coverage, never ready", () => {
  const h = viewportTileHealth(view, [
    tile("a", 0, 0),
    tile("b", 256, 0, "pending"),
    tile("c", 0, 256, "pending"),
    tile("d", 256, 256, "pending"),
  ]);
  assert.equal(h.loaded, 1);
  assert.equal(h.coverage, 0.25);
  assert.equal(h.state, "loading");
  assert.equal(h.pending, 3);
  assert.equal(
    viewportTileHealth(view, [tile("a", 0, 0)], true).state,
    "partial",
  );
});
test("full coverage requires all visible tiles; holes, failures and absent DOM slots are diagnosed", () => {
  const tiles = [
    tile("a", 0, 0),
    tile("b", 256, 0),
    tile("c", 0, 256),
    tile("d", 256, 256),
  ];
  assert.equal(viewportTileHealth(view, tiles).state, "ready");
  tiles[3].state = "failed";
  const h = viewportTileHealth(view, tiles, true);
  assert.equal(h.state, "partial");
  assert.equal(h.failed, 1);
  assert.equal(h.uncovered, 65536);
  assert.equal(viewportTileHealth(view, [], true).state, "unavailable");
});
test("overlapping and offscreen tiles cannot inflate loaded area; fractional boundaries are clipped", () => {
  const h = viewportTileHealth(view, [
    tile("a", 0, 0),
    tile("dup", 0, 0),
    tile("outside", 999, 999),
  ]);
  assert.equal(h.coverage, 0.25);
  assert.equal(h.visible, 2);
  assert.equal(
    viewportTileHealth({ x: 0.5, y: 0.5, width: 255, height: 255 }, [
      tile("a", 0, 0),
    ]).coverage,
    1,
  );
});
test("negative screen coordinates are measured correctly after page scrolling", () => {
  const h = viewportTileHealth({ x: -20, y: -30, width: 100, height: 100 }, [
    {
      ...tile("a", -20, -30),
      rect: { x: -20, y: -30, width: 100, height: 100 },
    },
  ]);
  assert.equal(h.coverage, 1);
  assert.equal(h.state, "ready");
});
