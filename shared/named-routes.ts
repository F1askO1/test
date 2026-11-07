// Editorial catalogue names supplied in the task; official site could not be
// independently fetched (CONNECT 403). A name match is NOT operator approval
// of the geometry, official difficulty, opening status or complete route extent.
import type { SkiBundle, SkiLine, Coord } from "./ski.js";
import { generalizeDisplay, type DisplaySegment } from "./ski-display.js";
export const dombayCatalogue = {
  url: "https://dombai-kd.ru/karta-trass/",
  basis: "user-provided-list" as const,
  names: [
    "Мусса — Ачитара",
    "Домбайская поляна",
    "Сулахат",
    "Старый Домбай",
    "Домбай 2",
    "Аманауз",
    "Солнечная",
    "Лесная",
    "Учебный склон",
    "Поляна Лии",
  ],
};
export const normalizedRouteName = (name: string) =>
  name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export type NamedRoute = {
  id: string;
  name: string;
  lineIds: string[];
  areaIds: string[];
  difficulties: string[];
  components: number;
  status: "osm-name-match" | "unmatched";
  extent: "not-operator-verified";
  evidence: { id: string; fields: string[]; relationIds: string[] }[];
};
export function namedRoutes(bundle: SkiBundle): NamedRoute[] {
  if (bundle.resort.id !== "ru-dombay") return [];
  return dombayCatalogue.names.map((name, i) => {
    const key = normalizedRouteName(name);
    const evidence: NamedRoute["evidence"] = [];
    const known = new Set(dombayCatalogue.names.map(normalizedRouteName));
    const lines = bundle.lines.filter((l) => {
      if (l.kind !== "piste" || l.geometryRole !== "centerline") return false;
      const fields = ["name:ru", "piste:name", "name"].filter(
        (f) => !!l.osmTags?.[f],
      );
      const labels = fields.length
        ? fields.map((f) => l.osmTags![f])
        : [l.name];
      const direct = new Set(
        labels.map(normalizedRouteName).filter((k) => known.has(k)),
      );
      // Conflicting direct tags do not establish a unique identity.
      if (direct.size > 1) return false;
      const relationIds = (l.routeRelations ?? [])
        .filter((r) => normalizedRouteName(r.name) === key)
        .map((r) => r.id);
      if (!direct.has(key) && !relationIds.length) return false;
      evidence.push({
        id: l.id,
        fields: fields.length
          ? fields.filter((f) => normalizedRouteName(l.osmTags![f]) === key)
          : direct.has(key)
            ? ["display-name"]
            : [],
        relationIds,
      });
      return true;
    });
    const areas = (bundle.areas ?? []).filter(
      (a) => a.complete && normalizedRouteName(a.name) === key,
    );
    const parent = lines.map((_, i) => i),
      root = (i: number): number =>
        parent[i] === i ? i : (parent[i] = root(parent[i]));
    const owner = new Map<string, number>();
    lines.forEach((l, i) =>
      l.coordinates.forEach((c) => {
        const k = c.join(",");
        if (owner.has(k)) parent[root(i)] = root(owner.get(k)!);
        else owner.set(k, i);
      }),
    );
    return {
      id: "dombay-catalogue-" + i,
      name,
      lineIds: lines.map((l) => l.id),
      areaIds: areas.map((a) => a.id),
      difficulties: [
        ...new Set(
          [
            ...lines.map((l) => l.difficulty),
            ...areas.map((a) => a.difficulty),
          ].map((d) => d ?? "unknown"),
        ),
      ],
      components: new Set(lines.map((_, i) => root(i))).size,
      status: lines.length || areas.length ? "osm-name-match" : "unmatched",
      extent: "not-operator-verified",
      evidence: [
        ...evidence,
        ...areas.map((a) => ({
          id: a.id,
          fields: ["area-name"],
          relationIds: a.id.startsWith("relation-") ? [a.id] : [],
        })),
      ],
    };
  });
}
// Joins ONLY actual degree-two chains of a single logical name and compatible
// difficulty. Separate components/branches never get invented connecting edges.
export function logicalRoutePaths(
  segments: DisplaySegment[],
  routes: NamedRoute[],
): DisplaySegment[] {
  const membership = new Map<string, string[]>(),
    groups = new Map<string, DisplaySegment[]>();
  routes.forEach((r) =>
    r.lineIds.forEach((id) =>
      membership.set(id, [...(membership.get(id) ?? []), r.id]),
    ),
  );
  for (const s of segments) {
    const ids = [
      ...new Set(
        s.sources.flatMap((l) => membership.get(l.id) ?? ["source:" + l.id]),
      ),
    ].sort();
    const key = [
      s.sources[0].kind,
      ids.join("|"),
      s.conflict ? "conflict" : s.sources[0].difficulty,
    ].join(":");
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const result: DisplaySegment[] = [];
  for (const group of groups.values()) {
    const adjacent = new Map<string, number[]>(),
      used = new Set<number>();
    group.forEach((s, i) =>
      s.coordinates.forEach((c) => {
        const k = c.join(",");
        adjacent.set(k, [...(adjacent.get(k) ?? []), i]);
      }),
    );
    const walk = (first: number, start: Coord) => {
      let index = first,
        p = start;
      const coordinates: Coord[] = [start],
        sources = new Map<string, SkiLine>();
      while (!used.has(index)) {
        used.add(index);
        const edge = group[index];
        edge.sources.forEach((l) => sources.set(l.id, l));
        const q =
          edge.coordinates[0].join(",") === p.join(",")
            ? edge.coordinates[1]
            : edge.coordinates[0];
        coordinates.push(q);
        const next = adjacent.get(q.join(","))!;
        if (next.length !== 2) break;
        const candidate = next.find((i) => !used.has(i));
        if (candidate == null) break;
        index = candidate;
        p = q;
      }
      result.push({
        coordinates,
        sources: [...sources.values()],
        conflict: group[first].conflict,
      });
    };
    group.forEach((s, i) => {
      const end = s.coordinates.find(
        (c) => adjacent.get(c.join(","))!.length !== 2,
      );
      if (end && !used.has(i)) walk(i, end);
    });
    group.forEach((s, i) => {
      if (!used.has(i)) walk(i, s.coordinates[0]);
    });
  }
  return result;
}
export function generalizeLogicalRoutes(
  paths: DisplaySegment[],
  routes: NamedRoute[],
  zoom: number,
): DisplaySegment[] {
  const owner = new Map<string, string[]>();
  routes.forEach((r) =>
    r.lineIds.forEach((id) => owner.set(id, [...(owner.get(id) ?? []), r.id])),
  );
  const input = paths.map((p) => {
    const roots = new Set(
      p.sources.flatMap((l) => owner.get(l.id) ?? [undefined]),
    );
    return p.sources.length > 1 &&
      !p.conflict &&
      roots.size === 1 &&
      !roots.has(undefined)
      ? { ...p, sources: [p.sources[0]] }
      : p;
  });
  return generalizeDisplay(input, zoom).map((p, i) => ({
    ...p,
    sources: paths[i].sources,
  }));
}
