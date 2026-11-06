import L from "leaflet";
import {
  viewportTileHealth,
  type TileHealth,
  type VisibleTile,
} from "./tile-health";
export class MonitoredTileLayer extends L.TileLayer {
  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const image = super.createTile(coords, done) as HTMLImageElement;
    image.dataset.tileZ = String(coords.z);
    image.dataset.requestZ = String(coords.z + (this.options.zoomOffset ?? 0));
    image.dataset.tileKey = `${coords.z}/${coords.x}/${coords.y}`;
    return image;
  }
}
export function monitorTiles(
  map: L.Map,
  layer: L.TileLayer,
  provider: "topo" | "osm",
  publish: (h: TileHealth) => void,
  failed: () => void,
) {
  const errors = new WeakSet<HTMLImageElement>(),
    attempts = new Set<string>();
  let disposed = false,
    epoch = "",
    deadline = performance.now() + 12000,
    retried = false,
    last = "";
  const update = () => {
    if (disposed) return;
    const box = map.getContainer().getBoundingClientRect(),
      center = map.getCenter(),
      key = [
        center.lat.toFixed(6),
        center.lng.toFixed(6),
        map.getZoom(),
        box.width,
        box.height,
      ].join(":");
    if (epoch !== key) {
      epoch = key;
      retried = false;
      deadline = performance.now() + 12000;
      attempts.clear();
    }
    const size = map.getSize();
    if (Math.abs(size.x - box.width) > 1 || Math.abs(size.y - box.height) > 1) {
      map.invalidateSize({ animate: false, pan: false });
      return;
    }
    const native = Math.min(
      layer.options.maxNativeZoom ?? (provider === "topo" ? 17 : 19),
      Math.round(map.getZoom()),
    );
    const images = [
      ...(layer
        .getContainer()
        ?.querySelectorAll<HTMLImageElement>(".leaflet-tile") ?? []),
    ].filter((i) => Number(i.dataset.tileZ) === native);
    const tiles: VisibleTile[] = images.map((i) => ({
      key: i.dataset.tileKey!,
      source: provider,
      rect: i.getBoundingClientRect(),
      state: errors.has(i)
        ? "failed"
        : i.complete &&
            i.naturalWidth >= 256 &&
            i.classList.contains("leaflet-tile-loaded")
          ? "loaded"
          : "pending",
    }));
    const expired = performance.now() >= deadline,
      status = viewportTileHealth(box, tiles, expired);
    const signature = JSON.stringify(status);
    if (signature !== last) {
      last = signature;
      publish(status);
    }
    if (status.state === "ready") return;
    if (
      (expired || (status.failed > 0 && status.pending === 0)) &&
      !map.getContainer().classList.contains("leaflet-zoom-anim")
    ) {
      if (!retried) {
        retried = true;
        deadline = performance.now() + 12000;
        // Retry only missing/failed visible images once, respecting their normal URL/cache.
        let retriedImages = 0;
        for (let i = 0; i < images.length; i++) {
          const t = tiles[i],
            r = t.rect;
          if (
            t.state === "loaded" ||
            r.x + r.width <= box.x ||
            r.y + r.height <= box.y ||
            r.x >= box.right ||
            r.y >= box.bottom ||
            attempts.has(t.key)
          )
            continue;
          attempts.add(t.key);
          retriedImages++;
          errors.delete(images[i]);
          images[i].src = images[i].src;
        }
        if (!retriedImages) {
          map.invalidateSize({ animate: false, pan: false });
          layer.redraw();
        }
      } else if (expired || (status.failed > 0 && status.pending === 0)) {
        failed();
      }
    }
  };
  const onError = (e: L.TileErrorEvent) => {
    errors.add(e.tile as HTMLImageElement);
    update();
  };
  const onLoad = (e: L.TileEvent) => {
    errors.delete(e.tile as HTMLImageElement);
    update();
  };
  layer.on("tileerror", onError);
  layer.on("tileload", onLoad);
  map.on("moveend zoomend resize", update);
  const timer = window.setInterval(update, 250);
  layer.addTo(map);
  update();
  return () => {
    disposed = true;
    clearInterval(timer);
    layer.off("tileerror", onError);
    layer.off("tileload", onLoad);
    map.off("moveend zoomend resize", update);
  };
}
