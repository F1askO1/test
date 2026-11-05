import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { analyze, type Point, type Analysis } from "../../shared/track";
import {
  pisteColor,
  difficultyLabels,
  lineLength,
  type SkiLine,
  type Coord,
} from "../../shared/ski";
import type { SkiData } from "./ski/useSkiData";
const textLabel = (text: string) => {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
};
const latlng = (c: Coord): L.LatLngTuple => [c[1], c[0]];
export default function TrackMap({
  points,
  run,
  ski,
  analysis,
  live = false,
  large = false,
}: {
  points: Point[];
  run?: { start: number; end: number };
  ski?: SkiData;
  analysis?: Analysis;
  live?: boolean;
  large?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    track = useRef<L.LayerGroup | null>(null),
    features = useRef<L.LayerGroup | null>(null),
    base = useRef<L.TileLayer | null>(null),
    lastView = useRef("");
  const [tileFailed, setTileFailed] = useState(false),
    [layers, setLayers] = useState(false),
    [pistes, setPistes] = useState(true),
    [lifts, setLifts] = useState(true),
    [myTrack, setMyTrack] = useState(true),
    [terrain, setTerrain] = useState(true),
    [follow, setFollow] = useState(live),
    [query, setQuery] = useState(""),
    [region, setRegion] = useState(""),
    [selected, setSelected] = useState<SkiLine | null>(null),
    [locationError, setLocationError] = useState("");
  const followRef = useRef(follow);
  followRef.current = follow;
  const catalog = ski?.catalog,
    bundle = ski?.bundle;
  useEffect(() => {
    if (!ref.current) return;
    const m = L.map(ref.current, {
      zoomControl: false,
      preferCanvas: true,
    }).setView([61, 90], 3);
    map.current = m;
    L.control.zoom({ position: "topright" }).addTo(m);
    track.current = L.layerGroup().addTo(m);
    features.current = L.layerGroup().addTo(m);
    m.on("dragstart", () => setFollow(false));
    const observer = new ResizeObserver(() =>
      m.invalidateSize({ animate: false }),
    );
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    base.current?.remove();
    setTileFailed(false);
    const tiles = L.tileLayer(
      terrain
        ? "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        maxNativeZoom: terrain ? 17 : 19,
        attribution: terrain
          ? '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
          : '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    ).addTo(m);
    base.current = tiles;
    tiles.on("tileerror", () => setTileFailed(true));
    return () => {
      tiles.remove();
    };
  }, [terrain]);
  useEffect(() => {
    const m = map.current,
      g = features.current;
    if (!m || !g) return;
    g.clearLayers();
    if (!bundle) {
      for (const r of catalog?.resorts ?? [])
        L.circleMarker(latlng(r.center), {
          radius: 6,
          color: "#fff",
          weight: 2,
          fillColor: "#17191d",
          fillOpacity: 1,
        })
          .bindTooltip(textLabel(r.name))
          .on("click", () => ski?.select(r.id))
          .addTo(g);
      return;
    }
    for (const l of bundle.lines) {
      if ((l.kind === "piste" && !pistes) || (l.kind === "lift" && !lifts))
        continue;
      const cs = l.coordinates.map(latlng);
      if (l.kind === "piste")
        L.polyline(cs, {
          color: "#fff",
          weight: 7,
          opacity: 0.95,
          interactive: false,
        }).addTo(g);
      const path = L.polyline(cs, {
        color: l.kind === "lift" ? "#32363d" : pisteColor(l.difficulty),
        weight: l.kind === "lift" ? 3 : 4,
        dashArray:
          l.kind === "lift"
            ? "7 5"
            : l.difficulty === "expert" || l.difficulty === "freeride"
              ? "4 4"
              : undefined,
      }).addTo(g);
      path
        .bindTooltip(textLabel(l.name), { sticky: true })
        .on("click", () => setSelected(l));
      if (l.kind === "lift")
        for (const s of l.stations)
          L.circleMarker(latlng(s.coordinate), {
            radius: 4,
            color: "#fff",
            weight: 2,
            fillColor: "#32363d",
            fillOpacity: 1,
          })
            .bindTooltip(textLabel(s.name))
            .on("click", () => setSelected(l))
            .addTo(g);
    }
  }, [bundle, catalog, pistes, lifts, ski?.select]);
  useEffect(() => {
    const m = map.current;
    if (!m || !bundle) return;
    const key = "resort:" + bundle.resort.id;
    if (lastView.current !== key) {
      const [w, s, e, n] = bundle.resort.bbox;
      m.fitBounds(
        [
          [s, w],
          [n, e],
        ],
        { maxZoom: 14, padding: [25, 25] },
      );
      lastView.current = key;
      setSelected(null);
    }
  }, [bundle]);
  useEffect(() => {
    const m = map.current,
      g = track.current;
    if (!m || !g) return;
    g.clearLayers();
    const view = run ? points.slice(run.start, run.end + 1) : points;
    // Reuse worker analysis while recording; historical analysis follows its saved version.
    const a = run ? analyze(view) : (analysis ?? analyze(view));
    if (myTrack) {
      const segments: L.LatLngTuple[][] = [];
      for (const e of a.edges) {
        if (!e.seconds) continue;
        const p = a.points[e.from],
          q = a.points[e.to];
        if (!p || !q) continue;
        segments.push([
          [p.lat, p.lon],
          [q.lat, q.lon],
        ]);
      }
      L.polyline(segments, {
        color: "#fff",
        weight: 7,
        opacity: 0.85,
        interactive: false,
      }).addTo(g);
      L.polyline(segments, { color: "#862bd6", weight: 4, opacity: 1 }).addTo(
        g,
      );
    }
    if (view.length) {
      const first = view[0],
        p = view.at(-1)!;
      L.circleMarker([first.lat, first.lon], {
        radius: 5,
        color: "#fff",
        fillColor: "#862bd6",
        fillOpacity: 1,
      })
        .bindTooltip("Начало записи")
        .addTo(g);
      if (live && p.accuracy != null)
        L.circle([p.lat, p.lon], {
          radius: p.accuracy,
          color: "#2379d5",
          weight: 1,
          fillOpacity: 0.1,
        }).addTo(g);
      L.circleMarker([p.lat, p.lon], {
        radius: 7,
        color: "#fff",
        weight: 3,
        fillColor: live ? "#2379d5" : "#862bd6",
        fillOpacity: 1,
      })
        .bindTooltip(
          live ? "GPS ±" + Math.round(p.accuracy ?? 0) + " м" : "Конец записи",
        )
        .addTo(g);
      if (live && p.heading != null && Number.isFinite(p.heading))
        L.marker([p.lat, p.lon], {
          interactive: false,
          icon: L.divIcon({
            className: "gps-heading",
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            html: `<span style="transform:rotate(${p.heading}deg)">▲</span>`,
          }),
        }).addTo(g);
      const key = `track:${view[0].t}:${run?.start}:${run?.end}`;
      if (live && followRef.current)
        m.setView([p.lat, p.lon], Math.max(14, m.getZoom()), {
          animate: false,
        });
      else if (!live && key !== lastView.current) {
        m.fitBounds(L.latLngBounds(view.map((p) => [p.lat, p.lon])), {
          padding: [30, 30],
          maxZoom: 16,
          animate: false,
        });
        lastView.current = key;
      }
    }
  }, [points, run, analysis, myTrack, live, follow]);
  const locate = () => {
    const p = points.at(-1);
    if (live && p) {
      setFollow(true);
      map.current?.setView([p.lat, p.lon], 16);
      return;
    }
    if (!navigator.geolocation) {
      setLocationError("GPS недоступен");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocationError("");
        const m = map.current;
        if (!m) return;
        m.setView([p.coords.latitude, p.coords.longitude], 14);
        L.circleMarker([p.coords.latitude, p.coords.longitude], {
          radius: 7,
          color: "#fff",
          fillColor: "#2379d5",
          fillOpacity: 1,
        })
          .addTo(m)
          .bindTooltip("Ваше положение");
        L.circle([p.coords.latitude, p.coords.longitude], {
          radius: p.coords.accuracy,
          color: "#2379d5",
          weight: 1,
          fillOpacity: 0.1,
        }).addTo(m);
      },
      () => setLocationError("Не удалось получить GPS. Проверьте разрешение."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  const resorts = (catalog?.resorts ?? []).filter(
    (r) =>
      (!region || r.region === region) &&
      [r.name, ...r.aliases].some((n) =>
        n.toLowerCase().includes(query.toLowerCase()),
      ),
  );
  const lineResults =
    bundle?.lines
      .filter((l) => l.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 20) ?? [];
  return (
    <section className={`ski-map ${large ? "ski-map-large" : ""}`}>
      {ski && (
        <div className="ski-search">
          <label>
            Курорт или трасса
            <input
              type="search"
              aria-label="Курорт или трасса"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти на карте"
            />
          </label>
          <label>
            Регион
            <select
              aria-label="Регион"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              <option value="">Все регионы</option>
              {[
                ...new Set(
                  catalog?.resorts.map((r) => r.region).filter(Boolean),
                ),
              ]
                .sort()
                .map((r) => (
                  <option key={r}>{r}</option>
                ))}
            </select>
          </label>
          {!!catalog?.resorts.length && (
            <label>
              Курорт
              <select
                aria-label="Курорт"
                value={ski.id}
                onChange={(e) => ski.select(e.target.value)}
              >
                <option value="">Россия · все курорты</option>
                {resorts.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {query && lineResults.length > 0 && (
        <div className="ski-results">
          {lineResults.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                setSelected(l);
                map.current?.fitBounds(
                  L.latLngBounds(l.coordinates.map(latlng)),
                  { maxZoom: 16 },
                );
                setQuery("");
              }}
            >
              {l.kind === "lift" ? "↗" : "⌁"} {l.name}
            </button>
          ))}
        </div>
      )}
      <div className="map-wrap">
        <div
          ref={ref}
          className="map light-ski-map"
          aria-label="Светлая карта катания"
        />
        <div className="ski-map-tools">
          <button onClick={() => setLayers(!layers)} aria-expanded={layers}>
            Слои
          </button>
          <button onClick={locate} aria-label="Моё положение">
            ◎
          </button>
          {live && (
            <button onClick={() => setFollow(!follow)}>
              {follow ? "Следим за GPS" : "Следовать"}
            </button>
          )}
        </div>
        {tileFailed && (
          <div className="tile-error" role="status">
            Подложка карты недоступна. Трек и загруженные трассы сохраняются
            независимо от карты.
            {terrain && (
              <button onClick={() => setTerrain(false)}>
                Открыть светлую OSM
              </button>
            )}
          </div>
        )}
        {layers && (
          <div className="ski-layer-sheet">
            <strong>Карта и слои</strong>
            <label>
              <input
                type="checkbox"
                checked={terrain}
                onChange={(e) => setTerrain(e.target.checked)}
              />
              Рельеф OpenTopoMap
            </label>
            <label>
              <input
                type="checkbox"
                checked={pistes}
                onChange={(e) => setPistes(e.target.checked)}
              />
              Трассы
            </label>
            <label>
              <input
                type="checkbox"
                checked={lifts}
                onChange={(e) => setLifts(e.target.checked)}
              />
              Подъёмники и станции
            </label>
            <label>
              <input
                type="checkbox"
                checked={myTrack}
                onChange={(e) => setMyTrack(e.target.checked)}
              />
              Мой трек
            </label>
            <button onClick={() => setLayers(false)}>Готово</button>
          </div>
        )}
      </div>
      <div className="ski-legend">
        {["beginner", "easy", "intermediate", "advanced"].map((d) => (
          <span key={d}>
            <i style={{ background: pisteColor(d) }} />
            {difficultyLabels[d].split(" · ")[0]}
          </span>
        ))}
        <span>
          <i style={{ background: "#862bd6" }} />
          Мой трек
        </span>
      </div>
      {locationError && <p role="status">{locationError}</p>}
      {ski?.error && <p role="status">{ski.error}</p>}
      {ski && (
        <p className="fine">
          {bundle
            ? `${bundle.resort.name} · ${bundle.resort.pistes} трасс · ${bundle.resort.lifts} подъёмников · данные ${bundle.updatedAt.slice(0, 10)}`
            : `Россия · в каталоге ${catalog?.resorts.length ?? 0} курортов`}
          . Разметка OSM, полнота и открытие не подтверждены.
        </p>
      )}
      {catalog && !catalog.resorts.length && (
        <p className="notice">{catalog.notice}</p>
      )}
      {selected && (
        <div
          className="ski-feature-card"
          role="region"
          aria-label="Карточка объекта карты"
        >
          <button className="text-button" onClick={() => setSelected(null)}>
            Закрыть
          </button>
          <h3>{selected.name}</h3>
          <p>
            {selected.kind === "piste"
              ? (difficultyLabels[selected.difficulty ?? "unknown"] ??
                difficultyLabels.unknown)
              : `Подъёмник · ${selected.liftType ?? "тип неизвестен"}`}{" "}
            · {(lineLength(selected.coordinates) / 1000).toFixed(2)} км по
            геометрии
          </p>
          {selected.durationSeconds && (
            <p>
              Время в OSM: ~{Math.round(selected.durationSeconds / 60)} мин, не
              оперативный статус
            </p>
          )}
          <p>
            {selected.stations.length} известных станций · направление{" "}
            {selected.direction ? "указано в OSM" : "не подтверждено"}
          </p>
          <a href={selected.source} target="_blank" rel="noopener noreferrer">
            Источник OSM ↗
          </a>
          <p className="fine">
            Статус открытия неизвестен. Не средство безопасной навигации.
          </p>
        </div>
      )}
    </section>
  );
}
