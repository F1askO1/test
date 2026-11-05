import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { analyze, type Point } from "../../shared/track";
export default function TrackMap({
  points,
  run,
}: {
  points: Point[];
  run?: { start: number; end: number };
}) {
  const [tileFailed, setTileFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layer = useRef<L.LayerGroup | null>(null),
    last = useRef("");
  useEffect(() => {
    if (!ref.current) return;
    const m = L.map(ref.current, {
      zoomControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      inertia: false,
    }).setView([43.67, 40.26], 12);
    map.current = m;
    last.current = "";
    L.control.zoom({ position: "topright" }).addTo(m);
    const tiles = L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      },
    ).addTo(m);
    const onTileError = () => setTileFailed(true);
    tiles.on("tileerror", onTileError);
    layer.current = L.layerGroup().addTo(m);
    const observer = new ResizeObserver(() =>
      m.invalidateSize({ animate: false }),
    );
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      tiles.off("tileerror", onTileError);
      m.stop();
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current,
      g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const view = run ? points.slice(run.start, run.end + 1) : points;
    const a = analyze(view);
    for (const e of a.edges) {
      const p = a.points[e.from],
        q = a.points[e.to];
      if (!e.seconds) continue;
      L.polyline(
        [
          [p.lat, p.lon],
          [q.lat, q.lon],
        ],
        {
          color:
            e.kind === "ascent"
              ? "#95a1ad"
              : e.kind === "stop"
                ? "#788478"
                : e.speed > 15
                  ? "#ff8864"
                  : e.speed > 8
                    ? "#ddf870"
                    : "#6bdac4",
          weight: 5,
          opacity: 0.95,
        },
      ).addTo(g);
    }
    if (view.length) {
      const first = view[0],
        end = view.at(-1)!;
      L.circleMarker([first.lat, first.lon], {
        radius: 6,
        color: "#fff",
        fillColor: "#111715",
        fillOpacity: 1,
      })
        .bindTooltip("Начало")
        .addTo(g);
      L.circleMarker([end.lat, end.lon], {
        radius: 8,
        color: "#fff",
        fillColor: "#c6f16b",
        fillOpacity: 1,
      })
        .bindTooltip("Последняя точка")
        .addTo(g);
      const key = `${view[0].t}:${run?.start ?? ""}:${run?.end ?? ""}`;
      if (key !== last.current) {
        const bounds = L.latLngBounds(
          view.map((p) => [p.lat, p.lon] as [number, number]),
        );
        m.fitBounds(bounds, { padding: [30, 30], maxZoom: 16, animate: false });
        last.current = key;
      }
    }
  }, [points, run]);
  return (
    <div className="map-wrap">
      <div ref={ref} className="map" />
      {tileFailed && (
        <div className="tile-error" role="status">
          Подложка карты недоступна. Проверьте сеть. GPS-трек сохраняется
          независимо от карты.
        </div>
      )}
      {!points.length && (
        <div className="map-hint">
          Карта района Красной Поляны для ориентира.
          <br />
          Ваш маршрут появится после записи или импорта.
        </div>
      )}
    </div>
  );
}
