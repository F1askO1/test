// A presentation topology. Source features/coordinates are never modified.
import {
  coordPoint,
  lineLength,
  project,
  type Coord,
  type SkiLine,
} from "./ski.js";
export const closedContour = (l: SkiLine) =>
  l.kind === "piste" &&
  l.osmTags?.area !== "no" &&
  l.coordinates.length > 3 &&
  l.coordinates[0][0] === l.coordinates.at(-1)![0] &&
  l.coordinates[0][1] === l.coordinates.at(-1)![1];
const key = (a: Coord, b: Coord) => [a.join(","), b.join(",")].sort().join("|");
export type DisplaySegment = {
  coordinates: Coord[];
  sources: SkiLine[];
  conflict: boolean;
};
export function displayGeometry(lines: SkiLine[]) {
  const segments = new Map<string, DisplaySegment>();
  const boundaries = lines.filter((l) => l.geometryRole === "area-boundary");
  const contours = lines.filter(
    (l) => closedContour(l) && !boundaries.includes(l),
  );
  const grid = new Map<string, Map<string, Coord>>(),
    cellSize = 0.001;
  for (const l of lines)
    for (const c of l.coordinates) {
      const k =
        l.kind +
        ":" +
        Math.floor(c[0] / cellSize) +
        ":" +
        Math.floor(c[1] / cellSize);
      let cell = grid.get(k);
      if (!cell) {
        cell = new Map();
        grid.set(k, cell);
      }
      cell.set(c.join(","), c);
    }
  const vertices = (kind: string, a: Coord, b: Coord) => {
    const x0 = Math.floor(Math.min(a[0], b[0]) / cellSize),
      x1 = Math.floor(Math.max(a[0], b[0]) / cellSize),
      y0 = Math.floor(Math.min(a[1], b[1]) / cellSize),
      y1 = Math.floor(Math.max(a[1], b[1]) / cellSize);
    const result: Coord[] = [];
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 10000) {
      for (const [key, cell] of grid) {
        const [type, x, y] = key.split(":");
        if (type === kind && +x >= x0 && +x <= x1 && +y >= y0 && +y <= y1)
          result.push(...cell.values());
      }
    } else
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          result.push(...(grid.get(kind + ":" + x + ":" + y)?.values() ?? []));
    return result;
  };
  // Process contours last: their shared edges annotate centerlines, never add a second stroke.
  for (const line of [
    ...lines.filter((l) => !closedContour(l) && !boundaries.includes(l)),
    ...contours,
  ]) {
    for (let i = 1; i < line.coordinates.length; i++) {
      const a = line.coordinates[i - 1],
        b = line.coordinates[i];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      // Split at EXACTLY collinear source vertices, including differently segmented relations.
      const ab = [a, b] as Coord[],
        length = lineLength(ab);
      const cuts = new Map<number, Coord>([
        [0, a],
        [length, b],
      ]);
      for (const c of vertices(line.kind, a, b)) {
        if (
          c[0] < Math.min(a[0], b[0]) ||
          c[0] > Math.max(a[0], b[0]) ||
          c[1] < Math.min(a[1], b[1]) ||
          c[1] > Math.max(a[1], b[1])
        )
          continue;
        const p = project(coordPoint(c), ab);
        if (p.distance < 0.00001 && p.along > 0 && p.along < length)
          cuts.set(p.along, c);
      }
      const sorted = [...cuts].sort((a, b) => a[0] - b[0]).map((c) => c[1]);
      for (let j = 1; j < sorted.length; j++) {
        const cs: Coord[] = [sorted[j - 1], sorted[j]],
          k = line.kind + ":" + key(cs[0], cs[1]);
        let s = segments.get(k);
        if (!s) {
          if (closedContour(line) || boundaries.includes(line)) continue;
          s = { coordinates: cs, sources: [], conflict: false };
          segments.set(k, s);
        }
        if (!s.sources.some((l) => l.id === line.id)) s.sources.push(line);
        s.conflict = new Set(s.sources.map((l) => l.difficulty)).size > 1;
      }
    }
  }
  return {
    segments: [...segments.values()],
    contours,
    sourceCount: lines.length,
  };
}
// Bidirectional, densified Hausdorff-like check: endpoint similarity is insufficient.
// Diagnostic candidates ONLY: close parallel pistes are never automatically collapsed.
export function geometrySeparation(a: Coord[], b: Coord[]) {
  const samples = (cs: Coord[]) =>
    cs.flatMap((p, i) => {
      if (!i) return [p];
      const prev = cs[i - 1],
        n = Math.max(1, Math.ceil(lineLength([prev, p]) / 5));
      return Array.from(
        { length: n },
        (_, j) =>
          [
            prev[0] + ((p[0] - prev[0]) * (j + 1)) / n,
            prev[1] + ((p[1] - prev[1]) * (j + 1)) / n,
          ] as Coord,
      );
    });
  return Math.max(
    ...samples(a).map((p) => project(coordPoint(p), b).distance),
    ...samples(b).map((p) => project(coordPoint(p), a).distance),
  );
}
// Join only degree-two chains with identical provenance/style. This avoids round-cap
// dots and restarting lift dashes at every source vertex, without moving any vertex.
export function displayPaths(segments: DisplaySegment[]): DisplaySegment[] {
  const groups = new Map<string, DisplaySegment[]>();
  for (const s of segments) {
    const key =
      s.sources
        .map((l) => l.id)
        .sort()
        .join("|") +
      ":" +
      s.conflict;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const result: DisplaySegment[] = [];
  for (const group of groups.values()) {
    const adjacency = new Map<string, number[]>(),
      used = new Set<number>();
    group.forEach((s, i) =>
      s.coordinates.forEach((c) => {
        const k = c.join(",");
        adjacency.set(k, [...(adjacency.get(k) ?? []), i]);
      }),
    );
    const walk = (index: number, start: Coord) => {
      const coordinates: Coord[] = [start];
      let i = index,
        p = start;
      while (!used.has(i)) {
        used.add(i);
        const cs = group[i].coordinates,
          q = cs[0][0] === p[0] && cs[0][1] === p[1] ? cs[1] : cs[0];
        coordinates.push(q);
        const next = adjacency.get(q.join(","))!;
        if (next.length !== 2) break;
        const candidate = next.find((j) => !used.has(j));
        if (candidate == null) break;
        i = candidate;
        p = q;
      }
      result.push({ ...group[index], coordinates });
    };
    group.forEach((s, i) => {
      if (used.has(i)) return;
      const end = s.coordinates.find(
        (c) => adjacency.get(c.join(","))!.length !== 2,
      );
      if (end) walk(i, end);
    });
    group.forEach((s, i) => {
      if (!used.has(i)) walk(i, s.coordinates[0]);
    });
  }
  return result;
}
// Screen-space simplification uses only existing source vertices. Endpoints,
// shared junctions, lifts and shared/conflicting segments are locked.
export function generalizeDisplay(
  paths: DisplaySegment[],
  zoom: number,
): DisplaySegment[] {
  const owners = new Map<string, Set<number>>();
  paths.forEach((p, i) =>
    p.coordinates.forEach((c) => {
      const k = c.join(",");
      if (!owners.has(k)) owners.set(k, new Set());
      owners.get(k)!.add(i);
    }),
  );
  const tolerance = zoom < 14 ? 1.1 : zoom < 16 ? 0.55 : 0.18;
  const pixel = (c: Coord) => {
    const s = Math.sin((c[1] * Math.PI) / 180),
      k = 256 * 2 ** zoom;
    return [
      ((c[0] + 180) / 360) * k,
      (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * k,
    ];
  };
  const simplify = (cs: Coord[]) => {
    const keep = new Set([0, cs.length - 1]),
      stack: [number, number][] = [[0, cs.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!,
        p = pixel(cs[a]),
        q = pixel(cs[b]);
      let far = tolerance,
        index = -1;
      for (let i = a + 1; i < b; i++) {
        const r = pixel(cs[i]),
          dx = q[0] - p[0],
          dy = q[1] - p[1],
          f = Math.max(
            0,
            Math.min(
              1,
              ((r[0] - p[0]) * dx + (r[1] - p[1]) * dy) /
                (dx * dx + dy * dy || 1),
            ),
          ),
          d = Math.hypot(r[0] - p[0] - dx * f, r[1] - p[1] - dy * f);
        if (d > far) {
          far = d;
          index = i;
        }
      }
      if (index >= 0) {
        keep.add(index);
        stack.push([a, index], [index, b]);
      }
    }
    return cs.filter((_, i) => keep.has(i));
  };
  return paths.map((path) => {
    if (path.sources[0].kind === "lift" || path.sources.length > 1) return path;
    const coordinates: Coord[] = [];
    let start = 0;
    for (let i = 1; i < path.coordinates.length; i++)
      if (
        i === path.coordinates.length - 1 ||
        owners.get(path.coordinates[i].join(","))!.size > 1
      ) {
        const chunk = simplify(path.coordinates.slice(start, i + 1));
        coordinates.push(...(coordinates.length ? chunk.slice(1) : chunk));
        start = i;
      }
    return { ...path, coordinates };
  });
}
