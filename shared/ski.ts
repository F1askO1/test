import { distance, type Point } from "./track.js";
export type Coord = [number, number]; // longitude, latitude (GeoJSON)
export type SkiLine = {
  id: string;
  name: string;
  kind: "piste" | "lift";
  coordinates: Coord[];
  difficulty: string | null;
  // Optional provenance in new imports; old packages remain readable.
  geometryRole?: "centerline" | "area-boundary";
  osmTags?: Record<string, string>;
  routeRelations?: { id: string; difficulty: string | null; name: string }[];
  liftType?: string;
  durationSeconds?: number | null;
  direction: 1 | -1 | null;
  source: string;
  stations: {
    name: string;
    coordinate: Coord;
    role: "unknown" | "lower" | "upper" | "intermediate";
  }[];
};
export type Resort = {
  id: string;
  name: string;
  aliases: string[];
  region: string;
  center: Coord;
  bbox: [number, number, number, number];
  source: string;
  updatedAt: string;
  pistes: number;
  lifts: number;
  classified: number;
  completeness: "partial";
  association?: "search-window" | "source-membership" | "proximity";
};
export type SkiBundle = {
  areas?: import("./ski-areas.js").SkiArea[];
  resort: Resort;
  lines: SkiLine[];
  attribution: string;
  updatedAt: string;
};
export type SkiCatalog = {
  version: 1;
  updatedAt: string | null;
  source: string;
  attribution: string;
  resorts: Resort[];
  unassigned: number;
  notice?: string;
};
export const difficultyLabels: Record<string, string> = {
  beginner: "Учебная · зелёная",
  novice: "Учебная · зелёная",
  easy: "Лёгкая · синяя",
  intermediate: "Средняя · красная",
  advanced: "Сложная · чёрная",
  expert: "Экспертная",
  freeride: "Фрирайд",
  unknown: "Неизвестная сложность",
};
export const pisteColor = (d: string | null) =>
  ({
    beginner: "#168640",
    novice: "#168640",
    easy: "#1768d5",
    intermediate: "#d42f3d",
    advanced: "#17191d",
  })[d ?? ""] ?? "#737985";
export const coordPoint = (c: Coord): Point => ({ lon: c[0], lat: c[1], t: 1 });
export function lineLength(cs: Coord[]) {
  let d = 0;
  for (let i = 1; i < cs.length; i++)
    d += distance(coordPoint(cs[i - 1]), coordPoint(cs[i]));
  return d;
}
const lengths = new WeakMap<Coord[], number>();
export function project(p: Point, cs: Coord[]) {
  let total = lengths.get(cs);
  if (total == null) {
    total = lineLength(cs);
    lengths.set(cs, total);
  }
  let best = { distance: Infinity, along: 0, total, segment: 0 };
  let along = 0;
  const scale = 111195,
    cos = Math.cos((p.lat * Math.PI) / 180);
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1],
      b = cs[i],
      x = (a[0] - p.lon) * scale * cos,
      y = (a[1] - p.lat) * scale,
      dx = (b[0] - a[0]) * scale * cos,
      dy = (b[1] - a[1]) * scale;
    const f = Math.max(
      0,
      Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)),
    );
    const d = Math.hypot(x + dx * f, y + dy * f),
      len = distance(coordPoint(a), coordPoint(b));
    if (d < best.distance)
      best = {
        distance: d,
        along: along + f * len,
        total: best.total,
        segment: i - 1,
      };
    along += len;
  }
  return best;
}
export function matchPiste(points: Point[], lines: SkiLine[]) {
  const recent = points.slice(-5);
  if (
    recent.length < 3 ||
    recent.some((p) => (p.accuracy ?? 100) > 30) ||
    recent.slice(1).some((p, i) => p.breakBefore || p.t - recent[i].t > 35000)
  )
    return null;
  const scores = lines
    .filter(
      (l) =>
        l.kind === "piste" &&
        l.geometryRole !== "area-boundary" &&
        l.osmTags?.area !== "yes" &&
        (l.osmTags?.area === "no" ||
          l.coordinates[0][0] !== l.coordinates.at(-1)![0] ||
          l.coordinates[0][1] !== l.coordinates.at(-1)![1]),
    )
    .map((line) => ({
      line,
      score:
        recent.reduce((s, p) => s + project(p, line.coordinates).distance, 0) /
        recent.length,
    }))
    .sort((a, b) => a.score - b.score);
  if (
    !scores[0] ||
    scores[0].score > Math.max(12, ...recent.map((p) => p.accuracy ?? 0)) ||
    (scores[1] && scores[1].score - scores[0].score < 12)
  )
    return null;
  const path = recent.map((p) => project(p, scores[0].line.coordinates));
  const moved = recent
    .slice(1)
    .reduce((s, p, i) => s + distance(p, recent[i]), 0);
  const advance = Math.abs(path.at(-1)!.along - path[0].along);
  if (advance < 15 || advance < moved * 0.7) return null;
  return {
    id: scores[0].line.id,
    name: scores[0].line.name,
    difficulty: scores[0].line.difficulty,
    confidence: "probable" as const,
  };
}
export type LiftMatch = {
  id: string;
  name: string;
  state: "candidate" | "moving" | "stopped" | "arriving" | "completed";
  remaining: number;
  progress: number;
  etaSeconds: number | null;
  confidence: "probable" | "confirmed";
};
export function matchLift(points: Point[], lines: SkiLine[]): LiftMatch | null {
  const end = points.at(-1);
  if (!end) return null;
  const recent = points.filter((p) => p.t >= end.t - 90000).slice(-40);
  if (
    recent.length < 4 ||
    end.t - recent[0].t < 15000 ||
    recent.some((p) => (p.accuracy ?? 100) > 30) ||
    recent.slice(1).some((p, i) => p.breakBefore || p.t - recent[i].t > 35000)
  )
    return null;
  const candidates = lines
    .filter((l) => l.kind === "lift")
    .map((line) => ({
      line,
      ps: recent.map((p) => project(p, line.coordinates)),
    }))
    .filter((c) =>
      c.ps.every((p, i) => p.distance <= Math.max(12, recent[i].accuracy ?? 0)),
    );
  if (candidates.length !== 1) return null;
  const { line, ps } = candidates[0];
  const delta = ps.at(-1)!.along - ps[0].along,
    dt = (end.t - recent[0].t) / 1000;
  const elevation = recent.filter(
    (p) =>
      p.alt != null &&
      p.altAccuracy != null &&
      p.altAccuracy >= 0 &&
      p.altAccuracy <= 20,
  );
  const dh =
    elevation.length > 2 ? elevation.at(-1)!.alt! - elevation[0].alt! : null;
  // Never infer a ride merely from proximity. Require a known direction or trusted upward trend.
  const dir =
    line.direction ??
    (dh != null &&
    dh > Math.max(8, ...elevation.map((p) => p.altAccuracy!)) &&
    Math.abs(delta) > 20
      ? delta > 0
        ? 1
        : -1
      : null);
  if (
    !dir ||
    delta * dir < 15 ||
    Math.abs(delta) / dt > 15 ||
    (dh != null && dh < -8)
  )
    return null;
  const forward =
    ps.slice(1).filter((p, i) => (p.along - ps[i].along) * dir >= -8).length /
    (ps.length - 1);
  if (forward < 0.8) return null;
  const upward =
    dh != null && dh > Math.max(8, ...elevation.map((p) => p.altAccuracy!));
  const confirmed = dt >= 25 && delta * dir >= 35 && upward;
  const last = ps.at(-1)!,
    progress =
      dir === 1 ? last.along / last.total : 1 - last.along / last.total;
  const stationDistances = line.stations
    .map((s) => project(coordPoint(s.coordinate), line.coordinates).along)
    .filter((x) => (dir === 1 ? x > last.along + 10 : x < last.along - 10));
  const target = stationDistances.length
    ? dir === 1
      ? Math.min(...stationDistances)
      : Math.max(...stationDistances)
    : dir === 1
      ? last.total
      : 0;
  const remaining = Math.abs(target - last.along);
  const tailIndex = recent.findIndex((p) => p.t >= end.t - 15000);
  const tailSeconds = (end.t - recent[tailIndex].t) / 1000;
  const stopped =
    tailSeconds >= 10 && Math.abs(last.along - ps[tailIndex].along) < 5;
  const speed = Math.abs(delta) / dt;
  const eta = confirmed && !stopped && speed >= 0.8 ? remaining / speed : null;
  return {
    id: line.id,
    name: line.name,
    state: !confirmed
      ? "candidate"
      : stopped
        ? "stopped"
        : remaining < 15
          ? "completed"
          : remaining < 80
            ? "arriving"
            : "moving",
    remaining,
    progress: Math.max(0, Math.min(1, progress)),
    etaSeconds: eta,
    confidence: confirmed ? "confirmed" : "probable",
  };
}

export function lineIndex(lines: SkiLine[]) {
  const cells = new Map<string, Set<SkiLine>>(),
    size = 0.005;
  for (const line of lines) {
    for (let i = 1; i < line.coordinates.length; i++) {
      const a = line.coordinates[i - 1],
        b = line.coordinates[i];
      const x0 = Math.floor(Math.min(a[0], b[0]) / size) - 1,
        x1 = Math.floor(Math.max(a[0], b[0]) / size) + 1,
        y0 = Math.floor(Math.min(a[1], b[1]) / size) - 1,
        y1 = Math.floor(Math.max(a[1], b[1]) / size) + 1;
      if ((x1 - x0) * (y1 - y0) > 10000) continue;
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const key = x + ":" + y;
          let cell = cells.get(key);
          if (!cell) {
            cell = new Set();
            cells.set(key, cell);
          }
          cell.add(line);
        }
    }
  }
  return (p: Point) => [
    ...(cells.get(Math.floor(p.lon / size) + ":" + Math.floor(p.lat / size)) ??
      []),
  ];
}
