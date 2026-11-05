// Per-viewport health; partial tile failure must not hide a working basemap.
export type TileHealth = {
  loaded: number;
  failed: number;
  state: "loading" | "ready" | "partial" | "unavailable";
};
export function tileHealth(
  loaded: number,
  failed: number,
  timedOut = false,
): TileHealth {
  return {
    loaded,
    failed,
    state:
      loaded > 0
        ? failed
          ? "partial"
          : "ready"
        : timedOut || failed >= 3
          ? "unavailable"
          : "loading",
  };
}
