export type Point = {
  lat: number;
  lon: number;
  t: number;
  alt?: number | null;
  accuracy?: number | null;
  altAccuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  breakBefore?: boolean;
};
export type Kind = "descent" | "ascent" | "stop" | "unknown";
export type Edge = {
  from: number;
  to: number;
  kind: Kind;
  distance: number;
  seconds: number;
  speed: number;
  drop: number | null;
};
export type Run = {
  start: number;
  end: number;
  distance: number;
  seconds: number;
  drop: number | null;
};
import { terrainAnalysis, type TerrainAnalysis } from "./terrain.js";
export type Analysis = {
  terrain?: TerrainAnalysis;
  points: Point[];
  edges: Edge[];
  runs: Run[];
  distance: number;
  descentDistance: number;
  maxSpeed: number;
  avgSpeed: number;
  movingSeconds: number;
  duration: number;
  drop: number | null;
  rejected: number;
  gaps: number;
  engineVersion?: number;
  altitudeQuality?: "trusted" | "inferred" | "unavailable";
  liftDistance?: number;
  liftSeconds?: number;
  pisteMatches?: {
    id: string;
    name: string;
    distance: number;
    confidence: string;
  }[];
};
export { distance, trackConfig } from "./track-v1.js";
import { analyze as legacy } from "./track-v1.js";
import { matchLift, matchPiste, lineIndex, type SkiLine } from "./ski.js";
const median = (a: number[]) => {
  const sorted = [...a].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
export function analyze(
  input: Point[],
  context: { lines?: SkiLine[] } = {},
): Analysis {
  const nearby = lineIndex(context.lines ?? []);
  const base = legacy(input, true);
  const { points, edges } = base;
  let trusted = false,
    inferred = false;
  // Trend windows never cross a gap. Estimate on a time span, not individual altitude differences.
  let block = 0;
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    edge.drop = null;
    if (!edge.seconds) {
      block = i + 1;
      continue;
    }
    if (edge.kind === "stop") continue;
    edge.kind = "unknown";
    let j = i;
    while (
      j > block &&
      points[i + 1].t - points[j - 1].t <=
        (points[i + 1].altAccuracy == null ? 90000 : 45000)
    )
      j--;
    const window = points
      .slice(j, i + 2)
      .filter(
        (p) =>
          p.alt != null &&
          Number.isFinite(p.alt) &&
          (p.altAccuracy == null ||
            (Number.isFinite(p.altAccuracy) &&
              p.altAccuracy >= 0 &&
              p.altAccuracy <= 20)),
      );
    if (window.length < 4 || window.at(-1)!.t - window[0].t < 15000) continue;
    const half = Math.max(1, Math.floor(window.length / 3));
    const dh =
      median(window.slice(-half).map((p) => p.alt!)) -
      median(window.slice(0, half).map((p) => p.alt!));
    const reliable = window.every((p) => p.altAccuracy != null);
    const threshold = reliable
      ? Math.max(5, median(window.map((p) => p.altAccuracy!)) * 1.5)
      : 18;
    if (Math.abs(dh) < threshold) continue;
    const direction = dh < 0 ? "descent" : "ascent";
    edge.kind = direction;
    // Backfill only the initial short unclassified moving prefix in this uninterrupted trend.
    for (let k = j; k < i; k++)
      if (edges[k].seconds && edges[k].kind === "unknown")
        edges[k].kind = direction;
    if (reliable) trusted = true;
    else inferred = true;
  }
  let liftDistance = 0,
    liftSeconds = 0;
  const matches = new Map<
    string,
    { id: string; name: string; distance: number; confidence: string }
  >();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!e.seconds) continue;
    if (context.lines?.length) {
      const tail = points.slice(Math.max(0, i - 39), i + 2),
        lift = matchLift(tail, nearby(points[i + 1]));
      if (lift?.confidence === "confirmed") {
        e.kind = "ascent";
        liftDistance += e.distance;
        liftSeconds += e.seconds;
      } else if (e.kind !== "ascent" && e.kind !== "stop") {
        const match = matchPiste(tail, nearby(points[i + 1]));
        if (match) {
          const old = matches.get(match.id) ?? {
            id: match.id,
            name: match.name,
            distance: 0,
            confidence: match.confidence,
          };
          old.distance += e.distance;
          matches.set(match.id, old);
        }
      }
    }
    // Median-smoothed display/record speed; raw coordinates remain unchanged.
    if (e.speed > 0) {
      const nearby = edges
        .slice(Math.max(0, i - 2), Math.min(edges.length, i + 3))
        .filter((x) => x.seconds && x.speed > 0)
        .map((x) => x.distance / x.seconds);
      e.speed = median(nearby);
    }
  }
  let drop = 0,
    hasDrop = false;
  // Vertical records use only trustworthy measured altitude and confirmed downhill blocks.
  let anchor: number | null = null;
  for (const e of edges) {
    if (e.kind !== "descent" || !e.seconds) {
      anchor = null;
      continue;
    }
    const a = points[e.from],
      b = points[e.to];
    if (
      a.alt == null ||
      b.alt == null ||
      a.altAccuracy == null ||
      b.altAccuracy == null ||
      a.altAccuracy < 0 ||
      b.altAccuracy < 0 ||
      a.altAccuracy > 20 ||
      b.altAccuracy > 20
    ) {
      anchor = null;
      continue;
    }
    if (anchor == null) anchor = a.alt;
    const loss = anchor - b.alt;
    if (loss >= Math.max(3, a.altAccuracy, b.altAccuracy)) {
      e.drop = loss;
      drop += loss;
      hasDrop = true;
      anchor = b.alt;
    }
  }
  const runs: Run[] = [];
  let run: Run | undefined,
    pending: Edge[] = [];
  const flush = () => {
    if (run && run.distance >= 50 && run.seconds >= 15) runs.push(run);
    run = undefined;
    pending = [];
  };
  for (const e of edges) {
    if (!e.seconds || e.kind === "ascent") {
      flush();
      continue;
    }
    if (e.kind === "descent") {
      if (!run)
        run = { start: e.from, end: e.to, distance: 0, seconds: 0, drop: null };
      for (const p of pending) {
        run.seconds += p.seconds;
        run.distance += p.distance;
      }
      pending = [];
      run.end = e.to;
      run.distance += e.distance;
      run.seconds += e.seconds;
      if (e.drop != null) run.drop = (run.drop ?? 0) + e.drop;
    } else if (run) {
      pending.push(e);
      if (pending.reduce((s, x) => s + x.seconds, 0) > 25) flush();
    }
  }
  flush();
  const result: Analysis = {
    ...base,
    engineVersion: 2,
    edges,
    runs,
    drop: hasDrop ? drop : null,
    descentDistance: edges
      .filter((e) => e.kind === "descent")
      .reduce((s, e) => s + e.distance, 0),
    maxSpeed: Math.max(0, ...edges.map((e) => e.speed)),
    altitudeQuality: trusted
      ? "trusted"
      : inferred
        ? "inferred"
        : "unavailable",
    liftDistance,
    liftSeconds,
    pisteMatches: [...matches.values()],
  };
  result.terrain = terrainAnalysis(result, context.lines ?? []);
  return result;
}
