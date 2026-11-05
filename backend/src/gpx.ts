import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Point } from "../../shared/track.js";
export const MAX_GPX_BYTES = 5 * 1024 * 1024,
  MAX_POINTS = 40000;
export function parseGpx(buffer: Buffer): Point[] {
  if (buffer.length > MAX_GPX_BYTES) throw new Error("GPX больше 5 МБ");
  const xml = buffer.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("DTD и XML-сущности запрещены");
  let depth = 0;
  for (const match of xml.matchAll(/<([^>]+)>/g)) {
    const tag = match[1].trim();
    if (tag.startsWith("?") || tag.startsWith("!")) continue;
    if (tag.startsWith("/")) depth--;
    else if (!tag.endsWith("/")) depth++;
    if (depth > 64) throw new Error("XML имеет слишком большую вложенность");
  }
  if (XMLValidator.validate(xml) !== true) throw new Error("Некорректный XML");
  const doc = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    processEntities: false,
    isArray: (name) =>
      ["trk", "trkseg", "trkpt", "rte", "rtept"].includes(name),
  }).parse(xml);
  if (!doc.gpx) throw new Error("Ожидается документ GPX");
  const segments: any[][] = [];
  for (const trk of doc.gpx.trk ?? [])
    for (const seg of trk.trkseg ?? []) segments.push(seg.trkpt ?? []);
  for (const rte of doc.gpx.rte ?? []) segments.push(rte.rtept ?? []);
  const points: Point[] = [];
  for (const segment of segments)
    for (let i = 0; i < segment.length; i++) {
      const p = segment[i];
      if (points.length >= MAX_POINTS)
        throw new Error("Слишком много точек (максимум 40 000)");
      const lat = Number(p.lat),
        lon = Number(p.lon),
        t = Date.parse(p.time);
      if (
        !Number.isFinite(lat) ||
        Math.abs(lat) > 90 ||
        !Number.isFinite(lon) ||
        Math.abs(lon) > 180
      )
        throw new Error("Некорректные координаты");
      if (
        typeof p.time !== "string" ||
        !/(Z|[+-]\d\d:\d\d)$/.test(p.time) ||
        !Number.isFinite(t)
      )
        throw new Error("Каждой точке нужна дата с часовым поясом");
      const alt = p.ele == null ? null : Number(p.ele);
      if (alt != null && !Number.isFinite(alt))
        throw new Error("Некорректная высота");
      // GPX has no standard vertical accuracy: do not infer trustworthy descents from elevation alone.
      points.push({
        lat,
        lon,
        t,
        alt,
        accuracy: null,
        altAccuracy: null,
        breakBefore: i === 0 && points.length > 0,
      });
    }
  if (points.length < 2) throw new Error("Нужны минимум две точки с временем");
  return points;
}
