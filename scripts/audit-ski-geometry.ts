// Read-only audit of a user-supplied bundle. Never opens a database or edits map-data.
import fs from "node:fs";
import {
  displayGeometry,
  displayPaths,
  generalizeDisplay,
  closedContour,
  geometrySeparation,
} from "../shared/ski-display.js";
import {
  lineLength,
  coordPoint,
  project,
  type SkiBundle,
  type Coord,
} from "../shared/ski.js";
const file = process.argv[2];
if (!file)
  throw Error(
    "Usage: node --import tsx scripts/audit-ski-geometry.ts bundle.json",
  );
const bundle: SkiBundle = JSON.parse(fs.readFileSync(file, "utf8")),
  lines = bundle.lines;
const canonical = (cs: Coord[]) =>
  [JSON.stringify(cs), JSON.stringify([...cs].reverse())].sort()[0];
const exact = new Map<string, string[]>(),
  edges = new Map<string, typeof lines>();
for (const l of lines) {
  const k = l.kind + canonical(l.coordinates);
  exact.set(k, [...(exact.get(k) ?? []), l.id]);
  for (let i = 1; i < l.coordinates.length; i++) {
    const k = l.kind + canonical([l.coordinates[i - 1], l.coordinates[i]]);
    edges.set(k, [...(edges.get(k) ?? []), l]);
  }
}
const approximate: { ids: string[]; separationMeters: number }[] = [];
for (let i = 0; i < lines.length; i++)
  for (let j = i + 1; j < lines.length; j++) {
    const a = lines[i],
      b = lines[j];
    if (a.kind !== b.kind || closedContour(a) || closedContour(b)) continue;
    const x = lineLength(a.coordinates),
      y = lineLength(b.coordinates);
    if (Math.min(x, y) < 20 || Math.abs(x - y) / Math.max(x, y) > 0.1) continue;
    const separationMeters = geometrySeparation(a.coordinates, b.coordinates);
    if (separationMeters <= 3)
      approximate.push({ ids: [a.id, b.id], separationMeters });
  }
const partialCandidates: {
  ids: string[];
  shorterCoverage: number;
  sampledMeters: number;
}[] = [];
for (let i = 0; i < lines.length; i++)
  for (let j = i + 1; j < lines.length; j++) {
    const a = lines[i],
      b = lines[j];
    if (a.kind !== b.kind || closedContour(a) || closedContour(b)) continue;
    const [short, long] =
      lineLength(a.coordinates) < lineLength(b.coordinates) ? [a, b] : [b, a];
    if (lineLength(short.coordinates) < 30) continue;
    let hit = 0,
      total = 0;
    for (let k = 1; k < short.coordinates.length; k++) {
      const x = short.coordinates[k - 1],
        y = short.coordinates[k],
        len = lineLength([x, y]),
        n = Math.max(1, Math.ceil(len / 5));
      for (let t = 0; t < n; t++) {
        const f = (t + 0.5) / n,
          p: [number, number] = [
            x[0] + (y[0] - x[0]) * f,
            x[1] + (y[1] - x[1]) * f,
          ];
        total += len / n;
        if (project(coordPoint(p), long.coordinates).distance <= 3)
          hit += len / n;
      }
    }
    if (hit >= 30 && hit / total >= 0.8)
      partialCandidates.push({
        ids: [short.id, long.id],
        shorterCoverage: hit / total,
        sampledMeters: total,
      });
  }
const orient = (a: Coord, b: Coord, c: Coord) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const selfCrossings: { id: string; edges: number[] }[] = [];
for (const l of lines)
  for (let i = 1; i < l.coordinates.length; i++)
    for (let j = i + 2; j < l.coordinates.length; j++) {
      const [a, b, c, d] = [
        l.coordinates[i - 1],
        l.coordinates[i],
        l.coordinates[j - 1],
        l.coordinates[j],
      ];
      if (
        orient(a, b, c) * orient(a, b, d) < 0 &&
        orient(c, d, a) * orient(c, d, b) < 0
      )
        selfCrossings.push({ id: l.id, edges: [i - 1, j - 1] });
    }
const display = displayGeometry(lines);
console.log(
  JSON.stringify(
    {
      resort: bundle.resort.id,
      sourceObjects: lines.length,
      sourceRoles: {
        boundaries: lines.filter((l) => l.geometryRole === "area-boundary")
          .length,
        centerlinePistes: lines.filter(
          (l) => l.kind === "piste" && l.geometryRole === "centerline",
        ).length,
      },
      confirmedAreas: bundle.areas?.map((a) => ({
        id: a.id,
        name: a.name,
        rings: a.rings.length,
        complete: a.complete,
        sourceWays: a.sources.length,
      })),
      lod: [12, 13, 15, 17].map((zoom) => ({
        zoom,
        vertices: generalizeDisplay(
          displayPaths(display.segments),
          zoom,
        ).reduce((n, p) => n + p.coordinates.length, 0),
      })),
      pistes: bundle.resort.pistes,
      lifts: bundle.resort.lifts,
      repeatedIds: lines
        .map((l) => l.id)
        .filter((id, i, ids) => ids.indexOf(id) !== i),
      exactWholeLineGroups: [...exact.values()].filter((g) => g.length > 1),
      sourceEdges: [...edges.values()].reduce((n, g) => n + g.length, 0),
      uniqueSourceEdges: edges.size,
      sharedSourceEdges: [...edges.values()]
        .filter((g) => g.length > 1)
        .map((g) => ({
          sources: g.map((l) => l.source),
          difficulties: g.map((l) => l.difficulty),
        })),
      approximateCandidatesOnly: approximate,
      partialApproximateCandidatesOnly: partialCandidates,
      selfCrossings,
      closedContours: display.contours.map((l) => ({
        id: l.id,
        source: l.source,
        vertices: l.coordinates.length,
        areaTag: l.osmTags?.area ?? "NOT_PRESERVED_IN_PACKAGE",
      })),
      displayLinearSegments: display.segments.length,
      renderedPaths: displayPaths(display.segments).length,
      displaySharedSegments: display.segments.filter(
        (s) => s.sources.length > 1,
      ).length,
      displayConflictSegments: display.segments.filter((s) => s.conflict)
        .length,
      sourceIdsPreserved: lines.length,
      warning:
        "Approximate candidates are NOT automatically merged. Closed legacy contours have unconfirmed area semantics. Counts are edges, not official routes.",
    },
    null,
    2,
  ),
);
