import type { SkiArea } from "../../shared/ski-areas";
import { monitorTiles, MonitoredTileLayer } from "./ski/tile-monitor";
import {
  displayGeometry,
  displayPaths,
  generalizeDisplay,
  closedContour,
} from "../../shared/ski-display";
import { viewportTileHealth, type TileHealth } from "./ski/tile-health";
import type { TerrainSegment } from "../../shared/terrain";
import { Search, Layers, LocateFixed, Info, ChevronDown } from "lucide-react";
import { MapSheet } from "./ski/MapSheet";
import { skiLineStyle, skiHaloStyle, showStations } from "./ski/map-style";
import { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { analyze, type Point, type Analysis } from "../../shared/track";
import {
  pisteColor,
  difficultyLabels,
  lineLength,
  project,
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
    trackRenderer = useRef<L.Canvas | null>(null),
    renderedAnalysis = useRef<Analysis | null>(null),
    featureRenderers = useRef<{
      piste: L.Canvas;
      lift: L.Canvas;
      selection: L.Canvas;
    } | null>(null),
    lastView = useRef("");
  const [tileStatus, setTileStatus] = useState<TileHealth>(
      viewportTileHealth({ x: 0, y: 0, width: 0, height: 0 }, []),
    ),
    [retryToken, setRetryToken] = useState(0),
    [fallback, setFallback] = useState(false),
    [rawGeometry, setRawGeometry] = useState(false),
    [selectedArea, setSelectedArea] = useState<SkiArea | null>(null),
    [sharedSources, setSharedSources] = useState<SkiLine[]>([]),
    [terrainSegment, setTerrainSegment] = useState<TerrainSegment | null>(null);
  const [tileFailed, setTileFailed] = useState(false),
    [layers, setLayers] = useState(false),
    [chooser, setChooser] = useState(false),
    [info, setInfo] = useState(false),
    [zoom, setZoom] = useState(3),
    [mapView, setMapView] = useState(""),
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
  const display = useMemo(() => displayGeometry(bundle?.lines ?? []), [bundle]);
  const paths = useMemo(() => displayPaths(display.segments), [display]);
  const visualPaths = useMemo(
    () => generalizeDisplay(paths, zoom),
    [paths, zoom],
  );
  useEffect(() => {
    if (!ref.current) return;
    const m = L.map(ref.current, {
      zoomControl: false,
      fadeAnimation: false,
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
    trackRenderer.current = L.canvas({ pane: "ski-track", tolerance: 7 });
    featureRenderers.current = {
      piste: L.canvas({ pane: "ski-pistes", padding: 0.2, tolerance: 7 }),
      lift: L.canvas({ pane: "ski-lifts", padding: 0.2, tolerance: 7 }),
      selection: L.canvas({
        pane: "ski-selection",
        padding: 0.2,
        tolerance: 7,
      }),
    };
    m.on("zoomend", () => setZoom(m.getZoom()));
    m.on("moveend", () =>
      setMapView(
        `${m.getCenter().lat.toFixed(7)},${m.getCenter().lng.toFixed(7)},${m.getZoom()}`,
      ),
    );
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
    m.setMaxZoom(terrain ? 17 : 19);
    const retina = window.devicePixelRatio > 1,
      providerMax = terrain ? 17 : 19;
    const tiles = new MonitoredTileLayer(
      terrain
        ? "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: providerMax,
        maxNativeZoom: providerMax - (retina ? 1 : 0),
        tileSize: retina ? 128 : 256,
        zoomOffset: retina ? 1 : 0,
        detectRetina: false,
        attribution: terrain
          ? '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
          : '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    );
    base.current = tiles;
    const stop = monitorTiles(
      m,
      tiles,
      terrain ? "topo" : "osm",
      (status) => {
        setTileStatus(status);
        setTileFailed(
          status.state === "unavailable" || status.state === "partial",
        );
      },
      () => {
        if (terrain) {
          setFallback(true);
          setTerrain(false);
        }
      },
    );
    return () => {
      stop();
      tiles.remove();
    };
  }, [terrain, retryToken]);
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
    // Reuse renderers across zoom/state changes. Removing Canvas during a
    // Leaflet zoom callback can leave a pending redraw with a destroyed context.
    const renderers = featureRenderers.current!;
    const draw = (
      coordinates: Coord[],
      sources: SkiLine[],
      conflict = false,
    ) => {
      const l = sources[0];
      if (!visible.includes(l)) return;
      const style = conflict
        ? { ...skiLineStyle(l, zoom), color: "#626674", dashArray: "2 3" }
        : skiLineStyle(l, zoom);
      const halo = conflict ? null : skiHaloStyle(l, zoom);
      if (halo)
        L.polyline(coordinates.map(latlng), {
          ...halo,
          renderer: renderers[l.kind],
        }).addTo(g);
      L.polyline(coordinates.map(latlng), {
        ...style,
        renderer: renderers[l.kind],
      })
        .bindTooltip(
          textLabel(
            conflict
              ? "Общий участок: конфликт сложности"
              : sources.map((l) => l.name).join(" / "),
          ),
          { sticky: true },
        )
        .on("click", () => {
          setSharedSources(sources);
          setSelected(l);
          setChooser(false);
        })
        .addTo(g);
    };
    if (!rawGeometry && pistes)
      for (const area of bundle.areas ?? []) {
        if (!area.complete) continue;
        L.polygon(
          area.rings.map((r) => r.map(latlng)),
          {
            renderer: renderers.piste,
            stroke: false,
            fillColor: pisteColor(area.difficulty),
            fillOpacity: 0.085,
            fillRule: "evenodd",
          },
        )
          .bindTooltip(textLabel(area.name + " · площадная трасса OSM"))
          .on("click", () => {
            setSelected(null);
            setSelectedArea(area);
          })
          .addTo(g);
      }
    if (rawGeometry) visible.forEach((l) => draw(l.coordinates, [l]));
    else {
      // Legacy rings lost area tags during import. Show as contextual contours,
      // not as several colored ski centerlines. Never invent a centerline.
      for (const l of display.contours.filter((l) => visible.includes(l))) {
        L.polygon(l.coordinates.map(latlng), {
          renderer: renderers.piste,
          color: "#798594",
          weight: zoom >= 16 ? 0.65 : 0,
          dashArray: "2 4",
          fillColor: pisteColor(l.difficulty),
          fillOpacity: 0.045,
        })
          .bindTooltip(textLabel("Замкнутый контур OSM: " + l.name))
          .on("click", () => {
            setSharedSources([l]);
            setSelected(l);
          })
          .addTo(g);
      }
    }
    if (!rawGeometry)
      visualPaths.forEach((s) => draw(s.coordinates, s.sources, s.conflict));
    if (lifts && showStations(zoom)) {
      const seen = new Set<string>();
      for (const l of visible.filter((l) => l.kind === "lift"))
        for (const station of l.stations) {
          const key = station.coordinate.join(",");
          if (seen.has(key)) continue;
          seen.add(key);
          L.circleMarker(latlng(station.coordinate), {
            radius: 2.5,
            color: "#fff",
            weight: 1,
            fillColor: "#414951",
            fillOpacity: 1,
            renderer: renderers.lift,
          })
            .bindTooltip(textLabel(station.name))
            .on("click", () => {
              setSharedSources([l]);
              setSelected(l);
            })
            .addTo(g);
        }
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
      // Renderers live until m.remove(); only source paths are replaced.
    };
  }, [
    bundle,
    catalog,
    pistes,
    lifts,
    ski?.select,
    zoom,
    selected,
    display,
    paths,
    visualPaths,
    rawGeometry,
  ]);

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
    const a = run
      ? analyze(view, { lines: bundle?.lines, areas: bundle?.areas })
      : (analysis ??
        analyze(view, { lines: bundle?.lines, areas: bundle?.areas }));
    renderedAnalysis.current = a;
    if (myTrack && a.edges.length) {
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
        renderer: trackRenderer.current!,
        opacity: 0.85,
        interactive: false,
      }).addTo(g);
      if (!a.terrain)
        L.polyline(segments, {
          color: "#862bd6",
          weight: 2.6,
          opacity: 1,
          pane: "ski-track",
          renderer: trackRenderer.current!,
        }).addTo(g);
    }
    if (myTrack && a.terrain)
      for (const segment of a.terrain.segments) {
        const cs = a.points
          .slice(segment.from, segment.to + 1)
          .map((p) => [p.lat, p.lon] as L.LatLngTuple);
        if (cs.length < 2) continue;
        const off = segment.type === "off_piste",
          unknown = segment.type === "unknown";
        L.polyline(cs, {
          pane: "ski-track",
          renderer: trackRenderer.current!,
          color: off ? "#bc40df" : unknown ? "#747d8b" : "#862bd6",
          weight: off ? 3.5 : 2.6,
          dashArray: off ? "1 7" : unknown ? "3 5" : undefined,
          lineCap: "round",
        })
          .bindTooltip(
            textLabel(
              off
                ? "Вероятный фрирайд"
                : segment.type === "piste"
                  ? "Личный трек: трасса"
                  : segment.type === "lift"
                    ? "Личный трек: подъёмник"
                    : "Не определено",
            ),
          )
          .on("click", () => setTerrainSegment(segment))
          .addTo(g);
      }
    if (view.length) {
      const first = view[0],
        p = view.at(-1)!;
      L.circleMarker([first.lat, first.lon], {
        radius: 5,
        pane: "ski-track",
        renderer: trackRenderer.current!,
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
        renderer: trackRenderer.current!,
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
  }, [points, run, analysis, myTrack, live, follow, bundle]);
  // Canvas elements cover the entire viewport: DOM hit testing cannot pass
  // through an empty higher pane to lower lift/piste canvases. Pick centrally
  // in geographic space, including touch tolerance, rather than relying on that.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const click = (event: L.LeafletMouseEvent) => {
      const point = { lon: event.latlng.lng, lat: event.latlng.lat, t: 1 };
      const tolerance =
        (9 * 40075016.686 * Math.cos((point.lat * Math.PI) / 180)) /
        (256 * 2 ** m.getZoom());
      const personal = myTrack ? renderedAnalysis.current : null;
      if (personal?.terrain) {
        const matches = personal.terrain.segments
          .map((segment) => ({
            segment,
            distance: project(
              point,
              personal.points
                .slice(segment.from, segment.to + 1)
                .map((p) => [p.lon, p.lat] as Coord),
            ).distance,
          }))
          .sort((a, b) => a.distance - b.distance);
        if (matches[0]?.distance <= tolerance) {
          setSelectedArea(null);
          setSelected(null);
          setTerrainSegment(matches[0].segment);
          setChooser(false);
          return;
        }
      }
      const candidates = paths
        .filter((p) => (p.sources[0].kind === "piste" ? pistes : lifts))
        .map((p) => ({
          path: p,
          distance: project(point, p.coordinates).distance,
        }))
        .sort((a, b) => a.distance - b.distance);
      if (candidates[0]?.distance <= tolerance) {
        const sources = candidates[0].path.sources;
        setSelectedArea(null);
        setTerrainSegment(null);
        setSharedSources(sources);
        setSelected(sources[0]);
        setChooser(false);
      }
    };
    m.on("click", click);
    return () => {
      m.off("click", click);
    };
  }, [paths, pistes, lifts, myTrack]);
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
          renderer: trackRenderer.current!,
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
      .filter(
        (l) =>
          l.geometryRole !== "area-boundary" &&
          l.name.toLowerCase().includes(query.toLowerCase()),
      )
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
      data-map-view={mapView}
      data-basemap-provider={terrain ? "topo" : "osm"}
      data-tile-state={tileStatus.state}
      data-tile-loaded={tileStatus.loaded}
      data-tile-failed={tileStatus.failed}
      data-tile-pending={tileStatus.pending}
      data-tile-visible={tileStatus.visible}
      data-tile-coverage={tileStatus.coverage.toFixed(6)}
      data-display-segments={display.segments.length}
      data-source-lines={bundle?.lines.length ?? 0}
      data-geometry-mode={rawGeometry ? "raw" : "normalized"}
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
        {(tileFailed || fallback || tileStatus.state === "loading") && (
          <div className="map-tile-notice" role="status">
            <span>
              {tileStatus.state === "loading"
                ? "Загрузка подложки · " +
                  Math.round(tileStatus.coverage * 100) +
                  "%"
                : tileStatus.state === "partial"
                  ? "Подложка неполная · " +
                    Math.round(tileStatus.coverage * 100) +
                    "%"
                  : tileFailed
                    ? "Подложка недоступна"
                    : "Рельеф недоступен · резерв OSM"}
            </span>
            {tileFailed && (
              <button onClick={() => setRetryToken((n) => n + 1)}>
                Повторить
              </button>
            )}
            {terrain && (
              <button
                onClick={() => {
                  setFallback(true);
                  setTerrain(false);
                }}
              >
                Открыть OSM
              </button>
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
                    setSharedSources([l]);
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
            {query &&
              (bundle?.areas ?? [])
                .filter((a) =>
                  a.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      setSelected(null);
                      setSelectedArea(a);
                      setChooser(false);
                      setQuery("");
                      map.current?.fitBounds(
                        L.latLngBounds(a.rings.flatMap((r) => r.map(latlng))),
                        { padding: [35, 35], maxZoom: 16 },
                      );
                    }}
                  >
                    ▱ {a.name} · площадь
                  </button>
                ))}
          </div>
          {query &&
            !lineResults.length &&
            !resorts.length &&
            !(bundle?.areas ?? []).some((a) =>
              a.name.toLowerCase().includes(query.toLowerCase()),
            ) && (
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
                onChange={(e) => {
                  setFallback(false);
                  setTerrain(e.target.checked);
                }}
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
          <label className="fine">
            <input
              type="checkbox"
              checked={rawGeometry}
              onChange={(e) => setRawGeometry(e.target.checked)}
            />{" "}
            Исходные линии OSM (диагностика)
          </label>
          {legend}
          <p className="fine">
            Контуры — замкнутые объекты OSM с неподтверждённым назначением.
            Общий участок с конфликтом сложности — серый точечный.
          </p>
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
                  <strong>{bundle.resort.pistes}</strong>OSM-участков
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
              <p className="fine">
                Исходных объектов: {bundle.lines.length}. Уникальных линейных
                рёбер: {display.segments.length}. Замкнутых контуров:{" "}
                {display.contours.length}. Ребро — часть геометрии, не отдельная
                трасса.
                {bundle.areas && (
                  <>
                    {" "}
                    Линейных участков трасс:{" "}
                    {
                      bundle.lines.filter(
                        (l) =>
                          l.kind === "piste" &&
                          l.geometryRole !== "area-boundary",
                      ).length
                    }
                    ; границ площадей:{" "}
                    {
                      bundle.lines.filter(
                        (l) => l.geometryRole === "area-boundary",
                      ).length
                    }
                    ; площадей: {bundle.areas.length}.
                  </>
                )}
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
            Подложка: {terrain ? "OpenTopoMap" : "OpenStreetMap"} ·{" "}
            {tileStatus.state} · загружено {tileStatus.loaded}, ошибок{" "}
            {tileStatus.failed}.{" "}
            {fallback
              ? "Включён резерв; он не содержит топографического рельефа."
              : ""}
          </p>
          <p className="fine">
            Тайлы требуют интернета. Отсутствие подложки не останавливает запись
            GPS. Фиолетовый — ваш маршрут, пунктир — подъёмник.
          </p>
        </MapSheet>
      )}
      {terrainSegment && (
        <MapSheet
          title={
            terrainSegment.type === "off_piste"
              ? "Вероятный фрирайд"
              : "Участок личного трека"
          }
          onClose={() => setTerrainSegment(null)}
        >
          <p>
            {terrainSegment.type === "off_piste"
              ? "Вне известных трасс — не подтверждено"
              : terrainSegment.type === "piste"
                ? "По известной трассе"
                : terrainSegment.type === "lift"
                  ? "Подъёмник"
                  : "Не определено"}
          </p>
          <p>
            {Math.round(terrainSegment.distance)} м ·{" "}
            {Math.round(terrainSegment.seconds)} с ·{" "}
            {terrainSegment.avgSpeed != null
              ? (terrainSegment.avgSpeed * 3.6).toFixed(1) + " км/ч"
              : "скорость неизвестна"}
          </p>
          <p>
            Перепад:{" "}
            {terrainSegment.drop == null
              ? "нет достоверных данных"
              : Math.round(terrainSegment.drop) + " м"}
            . Уверенность:{" "}
            {terrainSegment.confidence === "probable"
              ? "вероятно"
              : terrainSegment.confidence === "confirmed"
                ? "подтверждено"
                : "недостаточно данных"}
            .
          </p>
          <p className="fine">
            Аналитика записанного движения. Неполная карта может не содержать
            настоящую трассу. Это не официальный маршрут и не оценка
            безопасности склона.
          </p>
        </MapSheet>
      )}
      {selectedArea && (
        <MapSheet
          title="Площадная трасса"
          onClose={() => setSelectedArea(null)}
        >
          <h3>{selectedArea.name}</h3>
          {selectedArea.grooming === "backcountry" && (
            <p>Внетрассовая / неподготовленная площадь по разметке OSM.</p>
          )}
          <p>
            {difficultyLabels[selectedArea.difficulty ?? "unknown"] ??
              selectedArea.difficulty}
          </p>
          <p className="fine">
            Подтверждённая площадная геометрия OSM. Это площадь катания, а не
            набор осевых маршрутов. Открытие и безопасность не подтверждены.
          </p>
          <a
            href={
              "https://www.openstreetmap.org/" +
              selectedArea.id
                .replace("relation-", "relation/")
                .replace("way-", "way/")
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            Источник OSM
          </a>
          <details>
            <summary>Исходные границы: {selectedArea.sources.length}</summary>
            {selectedArea.sources.map((id) => (
              <p key={id}>{id}</p>
            ))}
          </details>
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
            {selected.geometryRole === "area-boundary" && (
              <p className="fine">
                Граница площадной трассы OSM, не отдельная осевая линия спуска.
                Длина периметра не равна длине катания.
              </p>
            )}
            {closedContour(selected) && !selected.geometryRole && (
              <p className="fine">
                Замкнутый контур OSM. В старом пакете отсутствуют теги area:
                назначение не подтверждено. Это не доказанная осевая линия
                трассы; длина периметра не равна длине спуска.
              </p>
            )}
            {sharedSources.length > 1 && (
              <div>
                <p>
                  {selected.geometryRole === "area-boundary"
                    ? "Исходные границы площади:"
                    : "Общий геометрический участок. Все исходные объекты:"}
                </p>
                {sharedSources.map((l) => (
                  <p key={l.id}>
                    <a
                      href={l.source}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {l.id}
                    </a>{" "}
                    ·{" "}
                    {difficultyLabels[l.difficulty ?? "unknown"] ??
                      l.difficulty}
                  </p>
                ))}
              </div>
            )}
            <p>
              {selected.kind === "piste"
                ? (difficultyLabels[selected.difficulty ?? "unknown"] ??
                  difficultyLabels.unknown)
                : `Подъёмник · ${selected.liftType ?? "тип неизвестен"}`}{" "}
              · {(lineLength(selected.coordinates) / 1000).toFixed(2)} км по
              геометрии
            </p>
            {!!selected.routeRelations?.length && (
              <div>
                <p>Маршруты OSM этого участка:</p>
                {selected.routeRelations.map((r) => (
                  <p key={r.id}>
                    <a
                      href={
                        "https://www.openstreetmap.org/relation/" +
                        r.id.replace("relation-", "")
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {r.name || r.id}
                    </a>{" "}
                    ·{" "}
                    {difficultyLabels[r.difficulty ?? "unknown"] ??
                      r.difficulty}
                  </p>
                ))}
                <p className="fine">
                  При конфликте тегов сложность участка не выбирается
                  произвольно.
                </p>
              </div>
            )}
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
