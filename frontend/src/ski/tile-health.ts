export type Rect = { x: number; y: number; width: number; height: number };
export type VisibleTile = {
  key: string;
  rect: Rect;
  state: "loaded" | "failed" | "pending";
  source: string;
};
export type TileHealth = {
  loaded: number;
  failed: number;
  pending: number;
  visible: number;
  coverage: number;
  uncovered: number;
  state: "loading" | "ready" | "partial" | "unavailable";
  sources: string[];
};
// Union of clipped rectangles, not sum (overlap/old zoom tiles cannot inflate coverage).
export function viewportTileHealth(
  view: Rect,
  tiles: VisibleTile[],
  timedOut = false,
): TileHealth {
  const intersect = (r: Rect) => {
    const x = Math.max(view.x, r.x),
      y = Math.max(view.y, r.y),
      right = Math.min(view.x + view.width, r.x + r.width),
      bottom = Math.min(view.y + view.height, r.y + r.height);
    return right > x && bottom > y
      ? { x, y, width: right - x, height: bottom - y }
      : null;
  };
  const visible = tiles
    .map((t) => ({ ...t, clip: intersect(t.rect) }))
    .filter((t) => t.clip);
  const loaded = visible.filter((t) => t.state === "loaded"),
    failed = visible.filter((t) => t.state === "failed").length,
    pending = visible.filter((t) => t.state === "pending").length;
  const rects = loaded.map((t) => t.clip!),
    xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.width]))].sort(
      (a, b) => a - b,
    );
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const bands = rects
      .filter((r) => r.x < xs[i] && r.x + r.width > xs[i - 1])
      .map((r) => [r.y, r.y + r.height])
      .sort((a, b) => a[0] - b[0]);
    let start: number | null = null,
      end = 0,
      covered = 0;
    for (const [a, b] of bands) {
      if (start === null) {
        start = a;
        end = b;
      } else if (a > end) {
        covered += end - (start ?? 0);
        start = a;
        end = b;
      } else end = Math.max(end, b);
    }
    covered += end - (start ?? 0);
    area += (xs[i] - xs[i - 1]) * covered;
  }
  const total = view.width * view.height,
    coverage = total > 0 ? Math.min(1, area / total) : 0,
    uncovered = Math.max(0, total - area);
  const complete =
    total > 0 &&
    uncovered <= Math.max(1, total * 1e-6) &&
    pending === 0 &&
    failed === 0;
  return {
    loaded: loaded.length,
    failed,
    pending,
    visible: visible.length,
    coverage,
    uncovered,
    sources: [...new Set(visible.map((t) => t.source))],
    state: complete
      ? "ready"
      : !timedOut && pending > 0
        ? "loading"
        : loaded.length
          ? "partial"
          : timedOut || failed
            ? "unavailable"
            : "loading",
  };
}
