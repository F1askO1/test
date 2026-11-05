import { distance } from "./track.js";
import { coordPoint, lineLength, type SkiBundle } from "./ski.js";
export type ResortTarget = {
  id: string;
  name: string;
  aliases: string[];
  region: string;
  bbox: [number, number, number, number];
  selection?: string;
  group?: string;
};
export function inside(c: number[], b: number[]) {
  return c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3];
}
export function geometryIssues(cs: unknown): string[] {
  if (!Array.isArray(cs) || cs.length < 2 || cs.length > 30000)
    return ["point-count"];
  if (
    cs.some(
      (c) =>
        !Array.isArray(c) ||
        c.length < 2 ||
        !Number.isFinite(c[0]) ||
        !Number.isFinite(c[1]) ||
        Math.abs(c[0]) > 180 ||
        Math.abs(c[1]) > 90,
    )
  )
    return ["invalid-coordinate"];
  const points = cs as [number, number][];
  const issues = [];
  if (lineLength(points) < 5) issues.push("zero-or-short-length");
  if (
    points
      .slice(1)
      .some((c, i) => distance(coordPoint(points[i]), coordPoint(c)) > 3000)
  )
    issues.push("segment-over-3km-review");
  if (lineLength(points) > 40000) issues.push("line-over-40km-review");
  if (new Set(points.map((c) => c.join(","))).size < 2)
    issues.push("duplicate-geometry");
  return issues;
}
export function bundleQuality(bundle: SkiBundle, target?: ResortTarget) {
  const errors: string[] = [],
    warnings: string[] = [],
    ids = new Set<string>(),
    geometries = new Map<string, string>();
  const classified = new Map<string, number>();
  let pistes = 0,
    lifts = 0;
  for (const line of bundle.lines) {
    if (ids.has(line.id)) errors.push("duplicate-id:" + line.id);
    ids.add(line.id);
    for (const issue of geometryIssues(line.coordinates))
      errors.push(line.id + ":" + issue);
    const serial = line.coordinates.map((c) => c.join(",")).join(";"),
      reverse = [...line.coordinates]
        .reverse()
        .map((c) => c.join(","))
        .join(";");
    const key = line.kind + ":" + [serial, reverse].sort()[0];
    if (geometries.has(key))
      warnings.push(
        "duplicate-source-geometry:" + line.id + ":" + geometries.get(key),
      );
    geometries.set(key, line.id);
    if (
      target &&
      line.coordinates.filter((c) => inside(c, target.bbox)).length /
        line.coordinates.length <
        0.8
    )
      errors.push("outside-selection:" + line.id);
    if (line.kind === "piste") {
      pistes++;
      const diff = line.difficulty || "unknown";
      classified.set(diff, (classified.get(diff) || 0) + 1);
    } else {
      lifts++;
      if (line.coordinates.length < 2)
        errors.push("lift-without-line:" + line.id);
    }
  }
  if (!pistes) errors.push("no-downhill-pistes");
  if (!lifts) errors.push("no-lift-lines");
  if (!bundle.lines.length) errors.push("empty-bundle");
  const classifiedCount = bundle.lines.filter(
    (l) =>
      l.kind === "piste" &&
      [
        "beginner",
        "novice",
        "easy",
        "intermediate",
        "advanced",
        "expert",
        "freeride",
        "extreme",
      ].includes(l.difficulty ?? ""),
  ).length;
  if (
    bundle.resort.pistes !== pistes ||
    bundle.resort.lifts !== lifts ||
    bundle.resort.classified !== classifiedCount
  )
    errors.push("counter-mismatch");
  if (classifiedCount < pistes)
    warnings.push("unknown-difficulty:" + String(pistes - classifiedCount));
  const result = {
    resortId: bundle.resort.id,
    status: errors.length ? "rejected" : "usable-partial",
    pistes,
    lifts,
    classified: classifiedCount,
    classificationShare: pistes ? classifiedCount / pistes : null,
    difficulties: Object.fromEntries(classified),
    errors,
    warnings,
    association: target
      ? "search-window-not-official-boundary"
      : (bundle.resort.association ?? "source-or-proximity"),
    geometry: "source-lines-not-drawn",
    at: bundle.updatedAt,
  };
  return result;
}
