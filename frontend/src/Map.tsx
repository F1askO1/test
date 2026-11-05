import { Search, Layers, LocateFixed, Info, ChevronDown } from "lucide-react";
import { MapSheet } from "./ski/MapSheet";
import { skiLineStyle, skiHaloStyle, showStations } from "./ski/map-style";
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
    [chooser, setChooser] = useState(false),
    [info, setInfo] = useState(false),
    [zoom, setZoom] = useState(3),
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
      zoomSnap: 0.5,
    }).setView([61, 90], 3);
    map.current = m;
    m.attributionControl.setPrefix(
      '<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>',
    );
    m.createPane("ski-lifts").style.zIndex = "410";
    m.createPane("ski-pistes").style.zIndex = "420";
    m.createPane("ski-selection").style.zIndex = "430";
    m.createPane("ski-track").style.zIndex = "440";
    m.on("zoomend", () => setZoom(m.getZoom()));
    L.control
      .zoom({
        position: "topright",
        zoomInTitle: "Приблизить",
        zoomOutTitle: "Отдалить",
      })
      .addTo(m);
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
    const visible = bundle.lines.filter(
      (l) =>
        !((l.kind === "piste" && !pistes) || (l.kind === "lift" && !lifts)),
    );
    const renderers = {
      piste: L.canvas({ pane: "ski-pistes", padding: 0.2, tolerance: 7 }),
      lift: L.canvas({ pane: "ski-lifts", padding: 0.2, tolerance: 7 }),
      selection: L.canvas({
        pane: "ski-selection",
        padding: 0.2,
        tolerance: 7,
      }),
    };
    // Thin casing only for black/selected lines, drawn BEFORE colors. Never 7px halos on every segment.
    for (const l of visible) {
      const halo = skiHaloStyle(l, zoom);
      if (halo)
        L.polyline(l.coordinates.map(latlng), {
          ...halo,
          renderer: renderers[l.kind],
        }).addTo(g);
    }
    for (const l of visible) {
      const cs = l.coordinates.map(latlng),
        path = L.polyline(cs, {
          ...skiLineStyle(l, zoom),
          renderer: renderers[l.kind],
        }).addTo(g);
      path.bindTooltip(textLabel(l.name), { sticky: true }).on("click", () => {
        setSelected(l);
        setChooser(false);
      });
      if (l.kind === "lift" && showStations(zoom))
        for (const station of l.stations)
          L.circleMarker(latlng(station.coordinate), {
            radius: 2.5,
            color: "#fff",
            weight: 1,
            fillColor: "#414951",
            fillOpacity: 1,
            renderer: renderers.lift,
          })
            .bindTooltip(textLabel(station.name))
            .on("click", () => setSelected(l))
            .addTo(g);
    }
    if (selected && visible.some((l) => l.id === selected.id)) {
      const cs = selected.coordinates.map(latlng),
        halo = skiHaloStyle(selected, zoom, true);
      if (halo)
        L.polyline(cs, { ...halo, renderer: renderers.selection }).addTo(g);
      L.polyline(cs, {
        ...skiLineStyle(selected, zoom, true),
        interactive: false,
        renderer: renderers.selection,
      }).addTo(g);
    }
    return () => {
      g.clearLayers();
      Object.values(renderers).forEach((r) => r.remove());
    };
  }, [bundle, catalog, pistes, lifts, ski?.select, zoom, selected]);

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
        { maxZoom: 16, padding: [14, 14] },
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
        weight: 4.2,
        pane: "ski-track",
        opacity: 0.85,
        interactive: false,
      }).addTo(g);
      L.polyline(segments, {
        color: "#862bd6",
        weight: 2.6,
        opacity: 1,
        pane: "ski-track",
      }).addTo(g);
    }
    if (view.length) {
      const first = view[0],
        p = view.at(-1)!;
      L.circleMarker([first.lat, first.lon], {
        radius: 5,
        pane: "ski-track",
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
        pane: "ski-track",
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
          pane: "ski-track",
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
  const legend = (
    <div className="ski-legend">
      {["beginner", "easy", "intermediate", "advanced"].map((d) => (
        <span key={d}>
          <i style={{ background: pisteColor(d) }} />
          {difficultyLabels[d].split(" · ")[0]}
        </span>
      ))}
      <span>
        <i style={{ background: "#737985" }} />
        Неизвестная
      </span>
      <span>
        <i style={{ background: "#862bd6" }} />
        Мой трек
      </span>
      <span>┄ Подъёмники</span>
    </div>
  );
  return (
    <section
      className={`ski-map ${large ? "ski-map-large" : ""}`}
      aria-label="Карта курорта"
    >
      {ski && (
        <div className="map-searchbar">
          <button
            className="map-search-trigger"
            onClick={() => {
              setSelected(null);
              setChooser(true);
            }}
            aria-label="Поиск и выбор курорта"
          >
            <Search size={19} />
            <span>{bundle?.resort.name || "Найти курорт или трассу"}</span>
            <ChevronDown size={16} />
          </button>
          <button
            className="map-info-trigger"
            onClick={() => {
              setSelected(null);
              setInfo(true);
            }}
            aria-label="О курорте"
          >
            <Info size={21} />
          </button>
        </div>
      )}
      <div className="map-wrap">
        <div
          ref={ref}
          className="map light-ski-map"
          aria-label="Светлая карта катания"
        />
        <div className="ski-map-tools">
          <button
            onClick={() => {
              setSelected(null);
              setLayers(true);
            }}
            aria-label="Слои"
          >
            <Layers size={18} />
            <span>Слои</span>
          </button>
        </div>
        <div className="ski-location-tools">
          <button onClick={locate} aria-label="Моё положение">
            <LocateFixed size={20} />
          </button>
          {live && (
            <button onClick={() => setFollow(!follow)} aria-pressed={follow}>
              {follow ? "Слежение вкл." : "Следовать"}
            </button>
          )}
        </div>
        {tileFailed && (
          <div className="map-tile-notice" role="status">
            <span>Подложка недоступна</span>
            {terrain && (
              <button onClick={() => setTerrain(false)}>Открыть OSM</button>
            )}
          </div>
        )}
        {(locationError || ski?.error) && (
          <div className="map-status-note" role="status">
            {locationError || ski?.error}
          </div>
        )}
        {!bundle && catalog && !catalog.resorts.length && (
          <button className="map-empty-note" onClick={() => setInfo(true)}>
            Карты курортов ещё не установлены <Info size={16} />
          </button>
        )}
      </div>
      {chooser && (
        <MapSheet title="Курорты и трассы" onClose={() => setChooser(false)}>
          <div className="ski-search">
            <label>
              Курорт или трасса
              <input
                autoFocus
                type="search"
                aria-label="Курорт или трасса"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Название курорта или трассы"
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
            <label>
              Курорт
              <select
                aria-label="Курорт"
                value={ski?.id ?? ""}
                onChange={(e) => {
                  ski?.select(e.target.value);
                  setSelected(null);
                  setChooser(false);
                  setQuery("");
                }}
              >
                <option value="">Россия · все курорты</option>
                {(catalog?.resorts ?? [])
                  .filter((r) => r.id === ski?.id || resorts.includes(r))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="ski-results">
            {query &&
              lineResults.map((l) => (
                <button
                  key={l.id}
                  onClick={() => {
                    setSelected(l);
                    setChooser(false);
                    setQuery("");
                    map.current?.fitBounds(
                      L.latLngBounds(l.coordinates.map(latlng)),
                      { padding: [35, 35], maxZoom: 16 },
                    );
                  }}
                >
                  {l.kind === "lift" ? "↗" : "⌁"} {l.name}
                </button>
              ))}
          </div>
          {query && !lineResults.length && !resorts.length && (
            <p className="fine">
              Ничего не найдено. Попробуйте другое название.
            </p>
          )}
        </MapSheet>
      )}
      {layers && (
        <MapSheet title="Слои карты" onClose={() => setLayers(false)}>
          <div className="map-layer-options">
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
          </div>
          {legend}
          <button className="primary" onClick={() => setLayers(false)}>
            Готово
          </button>
        </MapSheet>
      )}
      {info && (
        <MapSheet title="О курорте" onClose={() => setInfo(false)}>
          {bundle ? (
            <>
              <h3>{bundle.resort.name}</h3>
              <div className="resort-info-stats">
                <span>
                  <strong>{bundle.resort.pistes}</strong>участков трасс
                </span>
                <span>
                  <strong>{bundle.resort.lifts}</strong>подъёмников
                </span>
                <span>
                  <strong>{bundle.resort.classified}</strong>с классификацией
                </span>
              </div>
              <p className="fine">
                Данные: {bundle.updatedAt.slice(0, 10)} · {bundle.resort.region}
              </p>
              {legend}
              <p>
                Открытые данные OSM. Полнота и текущее открытие трасс не
                подтверждены.
              </p>
              {bundle.resort.association === "search-window" && (
                <p className="fine">
                  Объекты поисковой области; официальная принадлежность курорту
                  не подтверждена.
                </p>
              )}
              <a
                href={bundle.resort.source}
                target="_blank"
                rel="noopener noreferrer"
              >
                Источник курорта ↗
              </a>
            </>
          ) : (
            <>
              <p>В каталоге {catalog?.resorts.length ?? 0} курортов.</p>
              <p className="fine">
                {catalog?.notice || "Выберите курорт, чтобы увидеть сведения."}
              </p>
              {legend}
            </>
          )}
          <p className="fine">
            Тайлы требуют интернета. Отсутствие подложки не останавливает запись
            GPS. Фиолетовый — ваш маршрут, пунктир — подъёмник.
          </p>
        </MapSheet>
      )}
      {selected && (
        <MapSheet
          title={selected.kind === "piste" ? "Трасса" : "Подъёмник"}
          onClose={() => setSelected(null)}
        >
          <article
            className="ski-feature-card"
            role="region"
            aria-label="Карточка объекта карты"
          >
            <h3>{selected.name}</h3>
            <p>
              {selected.kind === "piste"
                ? (difficultyLabels[selected.difficulty ?? "unknown"] ??
                  difficultyLabels.unknown)
                : `Подъёмник · ${selected.liftType ?? "тип неизвестен"}`}{" "}
              · {(lineLength(selected.coordinates) / 1000).toFixed(2)} км по
              геометрии
            </p>
            {selected.durationSeconds != null && (
              <p>
                Время в OSM: ~{Math.round(selected.durationSeconds / 60)} мин
              </p>
            )}
            {selected.kind === "lift" && (
              <p className="fine">
                {selected.stations.length} известных станций · направление{" "}
                {selected.direction ? "указано в OSM" : "не подтверждено"}
              </p>
            )}
            <a href={selected.source} target="_blank" rel="noopener noreferrer">
              Источник OSM ↗
            </a>
            <p className="fine">
              Статус открытия неизвестен. Не средство безопасной навигации.
            </p>
          </article>
        </MapSheet>
      )}
    </section>
  );
}
