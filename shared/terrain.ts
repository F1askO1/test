import { containsArea, type SkiArea } from "./ski-areas.js";
import type { Analysis, Point } from "./track.js";
import {
  matchLift,
  matchPiste,
  project,
  lineIndex,
  type SkiLine,
} from "./ski.js";
import { closedContour } from "./ski-display.js";
export type TerrainKind = "piste" | "off_piste" | "lift" | "unknown";
export type TerrainEdge = {
  from: number;
  to: number;
  type: TerrainKind;
  confidence: "probable" | "confirmed" | "unknown";
  reason: string;
  sourceIds: string[];
};
export type TerrainSegment = TerrainEdge & {
  distance: number;
  seconds: number;
  drop: number | null;
  avgSpeed: number | null;
};
export type TerrainAnalysis = {
  version: 1;
  mapCoverage: "partial" | "complete" | "none";
  sourceIds: string[];
  edges: TerrainEdge[];
  segments: TerrainSegment[];
  pisteDistance: number;
  offPisteDistance: number;
  offPisteSeconds: number;
  offPisteCount: number;
  unknownDistance: number;
  unknownShare: number;
};
export const terrainConfig = {
  maxAccuracy: 20,
  enterDistance: 40,
  enterSeconds: 30,
  enterMeters: 100,
  returnSeconds: 10,
  returnMeters: 30,
};
export function terrainAnalysis(
  a: Analysis,
  lines: SkiLine[],
  coverage: "partial" | "complete" | "none" = lines.length ? "partial" : "none",
  areas: SkiArea[] = [],
): TerrainAnalysis {
  const nearby = lineIndex(lines);
  const pistes = lines.filter(
    (l) =>
      l.kind === "piste" &&
      l.geometryRole !== "area-boundary" &&
      !closedContour(l) &&
      l.osmTags?.area !== "yes",
  );
  const all = lines.flatMap((l) => l.coordinates),
    bbox = all.length
      ? [
          Math.min(...all.map((c) => c[0])),
          Math.min(...all.map((c) => c[1])),
          Math.max(...all.map((c) => c[0])),
          Math.max(...all.map((c) => c[1])),
        ]
      : null;
  const result: TerrainEdge[] = [],
    outside: number[] = [],
    returning: number[] = [];
  let active = false;
  const markOutside = () =>
    outside.forEach((j) => {
      result[j] = {
        ...result[j],
        type: "off_piste",
        confidence: "probable",
        reason:
          coverage === "complete"
            ? "sustained-downhill-outside-pistes"
            : "outside-known-pistes-partial-map",
      };
    });
  for (let i = 0; i < a.edges.length; i++) {
    const e = a.edges[i],
      p = a.points[e.from],
      q = a.points[e.to];
    const r: TerrainEdge = {
      from: e.from,
      to: e.to,
      type: "unknown",
      confidence: "unknown",
      reason: "insufficient-data",
      sourceIds: [],
    };
    result.push(r);
    const reset = () => {
      outside.length = 0;
      returning.length = 0;
      active = false;
    };
    if (
      !e.seconds ||
      q.breakBefore ||
      e.seconds > 35 ||
      !coverage ||
      coverage === "none" ||
      (!pistes.length && !areas.some((a) => a.complete))
    ) {
      reset();
      continue;
    }
    const local = nearby(q),
      localPistes = local.filter((l) => pistes.includes(l));
    const tail = a.points.slice(Math.max(0, e.to - 18), e.to + 1);
    const lift = matchLift(tail, local);
    if (lift?.confidence === "confirmed") {
      Object.assign(r, {
        type: "lift",
        confidence: "confirmed",
        reason: "confirmed-lift",
        sourceIds: [lift.id],
      });
      reset();
      continue;
    }
    if (
      e.kind !== "descent" ||
      e.speed > 25 ||
      e.distance / e.seconds > 25 ||
      [p, q].some(
        (v) =>
          v.accuracy == null ||
          !Number.isFinite(v.accuracy) ||
          v.accuracy < 0 ||
          v.accuracy > terrainConfig.maxAccuracy,
      )
    ) {
      r.reason = "not-reliable-descent";
      reset();
      continue;
    }
    // Restrict classification to actual mapped extent, not a guessed nationwide coverage.
    if (
      !bbox ||
      q.lon < bbox[0] ||
      q.lon > bbox[2] ||
      q.lat < bbox[1] ||
      q.lat > bbox[3]
    ) {
      r.reason = "outside-map-extent";
      reset();
      continue;
    }
    const lineMatch = matchPiste(tail, localPistes);
    const areaMatches = areas.filter(
      (a) => containsArea(p, a) && containsArea(q, a),
    );
    if (
      !lineMatch &&
      new Set(areaMatches.map((a) => [a.difficulty, a.grooming].join(":")))
        .size > 1
    ) {
      r.reason = "conflicting-area-tags";
      r.sourceIds = areaMatches.map((a) => a.id);
      reset();
      continue;
    }
    const area = areaMatches[0];
    const match =
      lineMatch ??
      (area
        ? {
            id: area.id,
            name: area.name,
            difficulty: area.difficulty,
            confidence: "probable" as const,
          }
        : null);
    if (match) {
      r.sourceIds = [match.id];
      const line = pistes.find((l) => l.id === match.id);
      const mappedFreeride =
        match.difficulty === "freeride" ||
        line?.osmTags?.["piste:grooming"] === "backcountry" ||
        (!line && area?.grooming === "backcountry");
      Object.assign(r, {
        type: mappedFreeride ? "off_piste" : "piste",
        confidence: "probable",
        reason: mappedFreeride ? "mapped-freeride-route" : "matched-piste",
      });
      if (active) {
        returning.push(i);
        const seconds = returning.reduce((n, j) => n + a.edges[j].seconds, 0),
          meters = returning.reduce((n, j) => n + a.edges[j].distance, 0);
        if (
          seconds < terrainConfig.returnSeconds ||
          meters < terrainConfig.returnMeters
        )
          Object.assign(r, {
            type: "unknown",
            confidence: "unknown",
            reason: "return-candidate",
          });
        else {
          for (const j of returning)
            Object.assign(result[j], {
              type: mappedFreeride ? "off_piste" : "piste",
              confidence: "probable",
              reason: mappedFreeride
                ? "mapped-freeride-route"
                : "matched-piste",
            });
          reset();
        }
      } else outside.length = 0;
      continue;
    }
    returning.length = 0;
    // Missing legacy area semantics must never turn a possible mapped ski area into freeride.
    const containing = lines.filter(closedContour).filter((l) => {
      let inside = false;
      const cs = l.coordinates;
      for (let j = 0, k = cs.length - 1; j < cs.length; k = j++) {
        const x = cs[j],
          y = cs[k];
        if (
          x[1] > q.lat !== y[1] > q.lat &&
          q.lon < ((y[0] - x[0]) * (q.lat - x[1])) / (y[1] - x[1]) + x[0]
        )
          inside = !inside;
      }
      return inside;
    });
    if (containing.length) {
      r.reason = "inside-unverified-contour";
      r.sourceIds = containing.map((l) => l.id);
      reset();
      continue;
    }
    const near = Math.min(
      ...localPistes.map((l) =>
        Math.min(
          project(p, l.coordinates).distance,
          project(q, l.coordinates).distance,
        ),
      ),
    );
    const enter = Math.max(
      terrainConfig.enterDistance,
      2 * Math.max(p.accuracy!, q.accuracy!) + 15,
    );
    const trend = tail.filter((v) => q.t - v.t <= 25000);
    const measured =
      trend.length >= 4 &&
      trend.every(
        (v) =>
          v.alt != null &&
          Number.isFinite(v.alt) &&
          v.altAccuracy != null &&
          Number.isFinite(v.altAccuracy) &&
          v.altAccuracy >= 0 &&
          v.altAccuracy <= 20,
      );
    const falling =
      measured &&
      trend[0].alt! - q.alt! >
        Math.max(8, 2 * Math.max(...trend.map((v) => v.altAccuracy!)));
    if (near <= enter || !falling) {
      r.reason =
        near <= enter ? "near-piste-or-ambiguous" : "untrusted-altitude";
      reset();
      continue;
    }
    outside.push(i);
    const seconds = outside.reduce((n, j) => n + a.edges[j].seconds, 0),
      meters = outside.reduce((n, j) => n + a.edges[j].distance, 0);
    r.reason = "outside-candidate";
    if (
      active ||
      (seconds >= terrainConfig.enterSeconds &&
        meters >= terrainConfig.enterMeters)
    ) {
      active = true;
      markOutside();
    }
  }
  const segments: TerrainSegment[] = [];
  for (let i = 0; i < result.length; i++) {
    const r = result[i],
      e = a.edges[i];
    if (!e.seconds) continue;
    let s = segments.at(-1);
    if (
      !s ||
      s.to !== r.from ||
      s.type !== r.type ||
      s.reason !== r.reason ||
      s.sourceIds.join() !== r.sourceIds.join()
    ) {
      s = {
        ...r,
        sourceIds: [...r.sourceIds],
        distance: 0,
        seconds: 0,
        drop: null,
        avgSpeed: null,
      };
      segments.push(s);
    }
    s.to = r.to;
    s.distance += e.distance;
    s.seconds += e.seconds;
    if (e.drop != null) s.drop = (s.drop ?? 0) + e.drop;
    s.avgSpeed = s.seconds > 0 ? s.distance / s.seconds : null;
  }
  const sum = (k: TerrainKind, field: "distance" | "seconds") =>
    segments.filter((s) => s.type === k).reduce((n, s) => n + s[field], 0);
  const total = a.edges.reduce((n, e) => n + e.distance, 0),
    unknown = sum("unknown", "distance");
  return {
    version: 1,
    mapCoverage: coverage,
    sourceIds: lines.map((l) => l.id),
    edges: result,
    segments,
    pisteDistance: sum("piste", "distance"),
    offPisteDistance: sum("off_piste", "distance"),
    offPisteSeconds: sum("off_piste", "seconds"),
    offPisteCount: segments.filter((s) => s.type === "off_piste").length,
    unknownDistance: unknown,
    unknownShare: total ? unknown / total : 0,
  };
}
