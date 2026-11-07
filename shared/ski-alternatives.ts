import { XMLParser, XMLValidator } from "fast-xml-parser";
import { normalizeOverpass } from "./ski-import.js";
import { geometryIssues, inside, type ResortTarget } from "./ski-quality.js";
import type { SkiBundle, SkiLine, Coord } from "./ski.js";
// Bounded local OSM XML extracts only. Large regional PBF must first be clipped with osmium.
export function osmXmlToOverpass(xml: string) {
  if (
    Buffer.byteLength(xml) > 64 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw Error("Неверный/слишком большой OSM XML; DTD/ENTITY запрещены");
  let depth = 0;
  for (const match of xml.matchAll(/<([^>]+)>/g)) {
    const t = match[1].trim();
    if (t.startsWith("?") || t.startsWith("!")) continue;
    if (t.startsWith("/")) depth--;
    else if (!t.endsWith("/")) depth++;
    if (depth > 64) throw Error("Вложенность OSM XML >64");
  }
  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    processEntities: false,
    isArray: (n) =>
      ["node", "way", "relation", "tag", "nd", "member"].includes(n),
  }).parse(xml);
  if (!doc.osm) throw Error("Ожидается OSM XML, не GPX");
  const tags = (e: any) =>
    Object.fromEntries(
      (e.tag ?? []).map((t: any) => [String(t.k), String(t.v)]),
    );
  const nodes = new Map<number, any>(
    (doc.osm.node ?? []).map((n: any) => [
      Number(n.id),
      {
        type: "node",
        id: Number(n.id),
        lat: Number(n.lat),
        lon: Number(n.lon),
        tags: tags(n),
      },
    ]),
  );
  const elements: any[] = [...nodes.values()];
  for (const w of doc.osm.way ?? []) {
    const ids = (w.nd ?? []).map((n: any) => Number(n.ref));
    const geometry = ids
      .map((id: number) => nodes.get(id))
      .map((n: any) =>
        n ? { lat: n.lat, lon: n.lon } : { lat: NaN, lon: NaN },
      );
    elements.push({
      type: "way",
      id: Number(w.id),
      tags: tags(w),
      nodes: ids,
      geometry,
    });
  }
  for (const r of doc.osm.relation ?? [])
    elements.push({
      type: "relation",
      id: Number(r.id),
      tags: tags(r),
      members: (r.member ?? []).map((m: any) => ({
        type: String(m.type),
        ref: Number(m.ref),
        role: String(m.role ?? ""),
      })),
    });
  return { elements };
}
export function normalizeOpenSkiData(
  doc: any,
  target: ResortTarget,
  updatedAt: string,
): SkiBundle {
  if (
    doc?.type !== "FeatureCollection" ||
    !Array.isArray(doc.features) ||
    doc.features.length > 200000
  )
    throw Error("Ожидается ограниченный OpenSkiData FeatureCollection");
  const bundle = normalizeOverpass({ elements: [] }, updatedAt, { target })
    .bundles[0];
  const names = [target.name, ...target.aliases].map((n) => n.toLowerCase());
  const ids = new Set<string>();
  for (const f of doc.features) {
    const p = f.properties ?? {};
    if (p.type !== "run" && p.type !== "lift") continue;
    if (p.type === "run" && !p.uses?.includes("downhill")) continue;
    if (p.status && p.status !== "operating") continue;
    const members = p.skiAreas ?? [];
    const explicitMatch = members.some((a: any) =>
      names.some((n) =>
        String(a.properties?.name ?? "")
          .toLowerCase()
          .includes(n),
      ),
    );
    if (members.length && !explicitMatch) continue;
    const osm = (p.sources ?? []).find(
      (s: any) =>
        s.type === "openstreetmap" && /^(way|relation)\/\d+$/.test(s.id),
    );
    if (!osm) continue;
    const parts =
      f.geometry?.type === "LineString"
        ? [f.geometry.coordinates]
        : f.geometry?.type === "MultiLineString"
          ? f.geometry.coordinates
          : [];
    for (let i = 0; i < parts.length; i++) {
      const cs = parts[i]?.map((c: number[]) => [c[0], c[1]]) as Coord[];
      if (
        geometryIssues(cs).length ||
        cs.filter((c) => inside(c, target.bbox)).length / cs.length < 0.8
      )
        continue;
      const id =
        "osk-" +
        String(p.id)
          .replace(/[^A-Za-z0-9_-]/g, "")
          .slice(0, 70) +
        "-" +
        i;
      if (ids.has(id)) continue;
      ids.add(id);
      const stations = (p.stations ?? [])
        .filter(
          (s: any) =>
            s.geometry?.type === "Point" &&
            Array.isArray(s.geometry.coordinates) &&
            s.geometry.coordinates.length >= 2,
        )
        .map((s: any) => ({
          name: String(s.properties?.name ?? "Станция").slice(0, 200),
          coordinate: s.geometry.coordinates.slice(0, 2) as Coord,
          role: "unknown" as const,
        }));
      const line: SkiLine = {
        id,
        name: String(p.name || p.ref || `OSM ${osm.id}`).slice(0, 200),
        kind: p.type === "run" ? "piste" : "lift",
        coordinates: cs,
        difficulty: typeof p.difficulty === "string" ? p.difficulty : null,
        liftType: p.type === "lift" ? p.liftType : undefined,
        durationSeconds:
          p.type === "lift" && Number.isFinite(p.duration) && p.duration > 0
            ? p.duration
            : null,
        direction: p.oneway === true ? 1 : null,
        source: "https://www.openstreetmap.org/" + osm.id,
        stations,
      };
      bundle.lines.push(line);
    }
  }
  bundle.resort.pistes = bundle.lines.filter((l) => l.kind === "piste").length;
  bundle.resort.lifts = bundle.lines.filter((l) => l.kind === "lift").length;
  bundle.resort.classified = bundle.lines.filter(
    (l) =>
      l.kind === "piste" &&
      [
        "novice",
        "beginner",
        "easy",
        "intermediate",
        "advanced",
        "expert",
        "freeride",
        "extreme",
      ].includes(l.difficulty ?? ""),
  ).length;
  bundle.attribution =
    "© OpenStreetMap contributors · ODbL 1.0; processed by OpenSkiData";
  return bundle;
}
