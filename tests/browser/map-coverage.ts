import { expect, type Page } from "@playwright/test";
import fs from "node:fs";
// This helper NEVER fulfills tile requests. Actual provider responses are required.
export async function waitForFullTerrain(page: Page, file: string) {
  await expect(
    page.locator(".leaflet-container.leaflet-zoom-anim"),
  ).toHaveCount(0);
  const map = page.locator(".ski-map");
  let stable = 0,
    previous = "";
  try {
    await expect
      .poll(
        async () => {
          const state: Record<string, string | undefined> = await map.evaluate(
            (el) => ({
              ...(el as HTMLElement).dataset,
              mapTransform: (
                el.querySelector(".leaflet-map-pane") as HTMLElement
              )?.style.transform,
            }),
          );
          const key = [
            state.mapView,
            state.mapTransform,
            state.tileVisible,
            state.tileCoverage,
            state.basemapProvider,
          ].join("|");
          const complete =
            state.basemapProvider === "topo" &&
            state.tileState === "ready" &&
            Number(state.tileVisible) > 0 &&
            state.tileLoaded === state.tileVisible &&
            state.tileFailed === "0" &&
            state.tilePending === "0" &&
            Number(state.tileCoverage) >= 0.999999;
          stable = complete && key === previous ? stable + 1 : 0;
          previous = key;
          return stable;
        },
        { timeout: 30000, intervals: [250, 250, 250] },
      )
      .toBeGreaterThanOrEqual(2);
  } finally {
    const diagnostic = await map.evaluate((el) => {
      const view = el.querySelector(".map")!.getBoundingClientRect();
      return {
        state: { ...(el as HTMLElement).dataset },
        viewport: view.toJSON(),
        devicePixelRatio,
        tiles: [...el.querySelectorAll<HTMLImageElement>(".leaflet-tile")].map(
          (i) => ({
            key: i.dataset.tileKey,
            z: i.dataset.tileZ,
            requestZ: i.dataset.requestZ,
            sourcePixelsPerCssPixel:
              i.naturalWidth / i.getBoundingClientRect().width,
            source: new URL(i.src).hostname + new URL(i.src).pathname,
            complete: i.complete,
            width: i.naturalWidth,
            rect: i.getBoundingClientRect().toJSON(),
          }),
        ),
      };
    });
    fs.mkdirSync("artifacts/real-dombay", { recursive: true });
    fs.writeFileSync(file, JSON.stringify(diagnostic, null, 2));
  }
}
