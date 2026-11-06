import { assembleRings, type SkiArea } from "./ski-areas.js";
import { inside, geometryIssues, type ResortTarget } from "./ski-quality.js";
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
  members?: { type: string; ref: number; role?: string }[];
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
  options: { target?: ResortTarget } = {},
) {
  if (!input || !Array.isArray((input as any).elements))
    throw Error("Ожидается Overpass JSON с elements");
  const rawElements = (input as { elements: Element[] }).elements;
  let elements = rawElements.filter(
    (e) =>
      e &&
      ["node", "way", "relation"].includes(e.type) &&
      Number.isSafeInteger(e.id) &&
      e.id > 0,
  );
  if (rawElements.length !== elements.length)
    throw Error("Некорректный OSM ID/type");
  if (elements.length > 200000) throw Error("Слишком много объектов");
  const originalById = new Map(
    rawElements.map((e) => [e.type + ":" + e.id, e]),
  );
  const parents = new Map<number, Element[]>();
  for (const e of elements)
    if (
      e.type === "relation" &&
      e.tags?.route === "piste" &&
      e.tags?.["piste:type"] === "downhill"
    )
      for (const m of e.members ?? []) {
        if (m.type === "way") {
          const a = parents.get(m.ref) ?? [];
          a.push(e);
          parents.set(m.ref, a);
        }
      }
  elements = elements.map((e) => {
    const ps = e.type === "way" ? parents.get(e.id) : undefined;
    if (!ps?.length) return e;
    const tags = { ...e.tags };
    tags["piste:type"] ??= "downhill";
    for (const key of ["piste:difficulty", "piste:name"]) {
      const values = [
        ...new Set(
          ps
            .map(
              (p) =>
                p.tags?.[key] ||
                (key === "piste:name" ? p.tags?.name : undefined),
            )
            .filter(Boolean),
        ),
      ];
      if (!tags[key] && values.length === 1) tags[key] = values[0]!;
    }
    return { ...e, tags };
  });
  const bundles: SkiBundle[] = [];
  const target = options.target;
  if (target) {
    const [w, s, e, n] = target.bbox;
    bundles.push({
      resort: {
        id: "ru-" + target.id,
        name: target.name,
        aliases: target.aliases,
        region: target.region,
        center: [(w + e) / 2, (s + n) / 2],
        bbox: target.bbox,
        source: `https://www.openstreetmap.org/?bbox=${target.bbox.join(",")}`,
        updatedAt,
        pistes: 0,
        lifts: 0,
        classified: 0,
        completeness: "partial",
        association: "search-window",
      },
      lines: [],
      attribution: "© OpenStreetMap contributors · ODbL 1.0",
      updatedAt,
    });
  }

  for (const e of elements) {
    const t = e.tags ?? {};
    if (
      target ||
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
      association: "proximity",
    };
    bundles.push({
      resort,
      lines: [],
      attribution: "© OpenStreetMap contributors · ODbL 1.0",
      updatedAt,
    });
  }
  const rejections: { source: string; reasons: string[] }[] = [];
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
    if (cs.length !== (e.geometry ?? []).length || geometryIssues(cs).length) {
      rejections.push({
        source: `${e.type}/${e.id}`,
        reasons: ["invalid-geometry-or-unassigned"],
      });
      unassigned++;
      continue;
    }
    if (
      target &&
      cs.filter((c) => inside(c, target.bbox)).length / cs.length < 0.8
    ) {
      rejections.push({
        source: `${e.type}/${e.id}`,
        reasons: ["invalid-geometry-or-unassigned"],
      });
      unassigned++;
      continue;
    }
    const claimed = t["piste:resort"];
    if (
      target &&
      claimed &&
      ![target.name, ...target.aliases].some((n) =>
        claimed.toLowerCase().includes(n.toLowerCase()),
      )
    ) {
      rejections.push({
        source: `${e.type}/${e.id}`,
        reasons: ["invalid-geometry-or-unassigned"],
      });
      unassigned++;
      continue;
    }
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
      rejections.push({
        source: `${e.type}/${e.id}`,
        reasons: ["invalid-geometry-or-unassigned"],
      });
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
      geometryRole:
        t.area === "yes" ||
        (parents.get(e.id) ?? []).some((p) => p.tags?.type === "multipolygon")
          ? "area-boundary"
          : "centerline",
      osmTags: {
        ...(originalById.get(e.type + ":" + e.id)?.tags ?? {}),
      },
      routeRelations: (parents.get(e.id) ?? []).map((p) => ({
        id: `relation-${p.id}`,
        difficulty: p.tags?.["piste:difficulty"] ?? null,
        name: clean(p.tags?.name || p.tags?.["piste:name"]),
      })),
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
          "novice",
          "beginner",
          "easy",
          "intermediate",
          "advanced",
          "expert",
          "freeride",
          "extreme",
        ].includes(line.difficulty ?? "")
      )
        b.resort.classified++;
    } else b.resort.lifts++;
  }
  if (target && bundles[0].lines.length) {
    const cs = bundles[0].lines.flatMap((l) => l.coordinates);
    const b: [number, number, number, number] = [
      Math.min(...cs.map((c) => c[0])),
      Math.min(...cs.map((c) => c[1])),
      Math.max(...cs.map((c) => c[0])),
      Math.max(...cs.map((c) => c[1])),
    ];
    bundles[0].resort.bbox = b;
    bundles[0].resort.center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  }
  const wayCoordinates = new Map(
    rawElements
      .filter((e) => e.type === "way")
      .map((e) => [
        e.id,
        (e.geometry ?? []).map(coordinate).filter((c): c is Coord => !!c),
      ]),
  );
  for (const bundle of bundles) {
    const ids = new Set(bundle.lines.map((l) => l.id)),
      areas: SkiArea[] = [];
    for (const r of rawElements.filter(
      (e) =>
        e.type === "relation" &&
        e.tags?.type === "multipolygon" &&
        e.tags?.["piste:type"] === "downhill",
    )) {
      const members = (r.members ?? []).filter((m) => m.type === "way");
      if (!members.some((m) => ids.has("way-" + m.ref))) continue;
      const outer = assembleRings(
        members
          .filter((m) => m.role !== "inner")
          .map((m) => wayCoordinates.get(m.ref) ?? [])
          .filter((cs) => cs.length >= 2),
      );
      const inner = assembleRings(
        members
          .filter((m) => m.role === "inner")
          .map((m) => wayCoordinates.get(m.ref) ?? [])
          .filter((cs) => cs.length >= 2),
      );
      const missing = members.some((m) => !wayCoordinates.has(m.ref));
      areas.push({
        id: "relation-" + r.id,
        name:
          clean(r.tags?.name || r.tags?.["piste:name"]) ||
          "Площадь OSM " + r.id,
        difficulty: r.tags?.["piste:difficulty"] ?? null,
        grooming: r.tags?.["piste:grooming"],
        rings: [...outer.rings, ...inner.rings],
        sources: members.map((m) => "way-" + m.ref),
        complete:
          !missing &&
          !outer.incomplete &&
          !inner.incomplete &&
          outer.rings.length > 0,
      });
    }
    for (const l of bundle.lines.filter((l) => l.osmTags?.area === "yes")) {
      const assembled = assembleRings([l.coordinates]);
      areas.push({
        id: l.id,
        name: l.name,
        difficulty: l.difficulty,
        grooming: l.osmTags?.["piste:grooming"],
        rings: assembled.rings,
        sources: [l.id],
        complete: assembled.rings.length > 0,
      });
    }
    bundle.areas = areas;
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
  return { catalog, bundles, rejections };
}
