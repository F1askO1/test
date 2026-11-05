import {
  lineLength,
  project,
  coordPoint,
  type Coord,
  type Resort,
  type SkiLine,
  type SkiBundle,
  type SkiCatalog,
} from "./ski.js";
type Element = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
};
const coordinate = (p: { lat?: number; lon?: number }): Coord | null =>
  Number.isFinite(p.lon) &&
  Number.isFinite(p.lat) &&
  Math.abs(p.lat!) <= 90 &&
  Math.abs(p.lon!) <= 180
    ? [p.lon!, p.lat!]
    : null;
const clean = (s: string | undefined) =>
  String(s ?? "")
    .replace(/[\x00-\x1f]/g, "")
    .slice(0, 200);
export function normalizeOverpass(
  input: unknown,
  updatedAt = new Date().toISOString(),
) {
  if (!input || !Array.isArray((input as any).elements))
    throw Error("Ожидается Overpass JSON с elements");
  const rawElements = (input as { elements: Element[] }).elements;
  const elements = rawElements.filter(
    (e) =>
      e &&
      ["node", "way", "relation"].includes(e.type) &&
      Number.isSafeInteger(e.id) &&
      e.id > 0,
  );
  if (rawElements.length !== elements.length)
    throw Error("Некорректный OSM ID/type");
  if (elements.length > 200000) throw Error("Слишком много объектов");
  const bundles: SkiBundle[] = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    if (
      t.landuse !== "winter_sports" ||
      /^(disused|abandoned|proposed|construction)$/.test(t.status ?? "")
    )
      continue;
    const cs = (e.geometry ?? [])
      .map(coordinate)
      .filter((x): x is Coord => !!x);
    let bbox: Resort["bbox"];
    if (e.bounds)
      bbox = [
        e.bounds.minlon,
        e.bounds.minlat,
        e.bounds.maxlon,
        e.bounds.maxlat,
      ];
    else if (cs.length)
      bbox = [
        Math.min(...cs.map((c) => c[0])),
        Math.min(...cs.map((c) => c[1])),
        Math.max(...cs.map((c) => c[0])),
        Math.max(...cs.map((c) => c[1])),
      ];
    else {
      const c = coordinate(e);
      if (!c) continue;
      bbox = [c[0], c[1], c[0], c[1]];
    }
    if (
      !bbox.every(Number.isFinite) ||
      bbox[0] < -180 ||
      bbox[2] > 180 ||
      bbox[1] < -90 ||
      bbox[3] > 90 ||
      bbox[0] > bbox[2] ||
      bbox[1] > bbox[3]
    )
      continue;
    const id = `${e.type}-${e.id}`;
    const resort: Resort = {
      id,
      name: clean(t["name:ru"] || t.name) || `Курорт OSM ${e.id}`,
      aliases: [t.name, t.alt_name, t["name:en"]]
        .filter((x): x is string => !!x)
        .map(clean),
      region: clean(t["addr:region"] || t["is_in:state"]),
      center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
      bbox,
      source: `https://www.openstreetmap.org/${e.type}/${e.id}`,
      updatedAt,
      pistes: 0,
      lifts: 0,
      classified: 0,
      completeness: "partial",
    };
    bundles.push({
      resort,
      lines: [],
      attribution: "© OpenStreetMap contributors · ODbL 1.0",
      updatedAt,
    });
  }
  let unassigned = 0;
  const stations = elements.filter(
    (e) => e.tags?.aerialway === "station" && coordinate(e),
  );
  for (const e of elements) {
    const t = e.tags ?? {},
      isPiste = t["piste:type"] === "downhill",
      isLift =
        !!t.aerialway &&
        !["station", "pylon", "goods", "yes", "no"].includes(t.aerialway);
    if (e.type !== "way" || (!isPiste && !isLift)) continue;
    const cs = (e.geometry ?? [])
      .map(coordinate)
      .filter((x): x is Coord => !!x);
    if (cs.length < 2 || cs.length > 30000) continue;
    const mid = cs[Math.floor(cs.length / 2)];
    const candidates = bundles
      .map((b) => {
        const [w, s, ee, n] = b.resort.bbox;
        const inside =
          mid[0] >= w && mid[0] <= ee && mid[1] >= s && mid[1] <= n;
        const dist =
          Math.hypot(
            (mid[0] - b.resort.center[0]) * Math.cos((mid[1] * Math.PI) / 180),
            mid[1] - b.resort.center[1],
          ) * 111195;
        return { b, inside, dist };
      })
      .filter((c) => c.inside || c.dist < 4000)
      .sort((a, b) => Number(b.inside) - Number(a.inside) || a.dist - b.dist);
    if (!candidates[0]) {
      unassigned++;
      continue;
    }
    const b = candidates[0].b;
    const duration = t["aerialway:duration"];
    const minutes =
      duration && /^\d+(\.\d+)?$/.test(duration) ? Number(duration) : null;
    const line: SkiLine = {
      id: `way-${e.id}`,
      name:
        clean(
          t["name:ru"] || t["piste:name"] || t.name || t["piste:ref"] || t.ref,
        ) || `${isPiste ? "Трасса" : "Подъёмник"} OSM ${e.id}`,
      kind: isPiste ? "piste" : "lift",
      coordinates: cs,
      difficulty: clean(t["piste:difficulty"]) || null,
      liftType: isLift ? t.aerialway : undefined,
      durationSeconds:
        minutes && minutes > 0 && minutes < 120 ? minutes * 60 : null,
      direction:
        t.oneway === "yes" || t["piste:oneway"] === "yes"
          ? 1
          : t.oneway === "-1"
            ? -1
            : null,
      source: `https://www.openstreetmap.org/way/${e.id}`,
      stations: [],
    };
    if (!lineLength(cs)) continue;
    if (isLift)
      line.stations = stations
        .filter(
          (s) =>
            (e as any).nodes?.includes(s.id) ||
            project(coordPoint(coordinate(s)!), cs).distance < 3,
        )
        .map((s) => ({
          name: clean(s.tags?.name) || "Станция",
          coordinate: coordinate(s)!,
          role: "unknown",
        }));
    b.lines.push(line);
    if (isPiste) {
      b.resort.pistes++;
      if (
        [
          "beginner",
          "easy",
          "intermediate",
          "advanced",
          "expert",
          "freeride",
        ].includes(line.difficulty ?? "")
      )
        b.resort.classified++;
    } else b.resort.lifts++;
  }
  const catalog: SkiCatalog = {
    version: 1,
    updatedAt,
    source: "OpenStreetMap Overpass snapshot",
    attribution: "© OpenStreetMap contributors · ODbL 1.0",
    resorts: bundles.map((b) => b.resort),
    unassigned,
    notice:
      "Общественная разметка OSM; полнота и статус открытия не подтверждены. Привязка линий к курортам по границам/близости требует проверки.",
  };
  return { catalog, bundles };
}
