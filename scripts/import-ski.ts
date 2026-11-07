import { readFileSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOverpass } from "../shared/ski-import.js";
import {
  normalizeOpenSkiData,
  osmXmlToOverpass,
} from "../shared/ski-alternatives.js";
import { installBundles, digest } from "../shared/ski-store.js";
import type { ResortTarget } from "../shared/ski-quality.js";
const args = process.argv.slice(2),
  file = args[0],
  value = (key: string) => {
    const i = args.indexOf(key);
    return i < 0 ? undefined : args[i + 1];
  };
if (!file || file.startsWith("--"))
  throw Error("Укажите файл .json/.osm и при необходимости --resort dombay.");
if (statSync(file).size > 64 * 1024 * 1024)
  throw Error(
    "Лимит входного файла 64 MiB; сначала выделите курорт из регионального PBF.",
  );
const targetId = value("--resort"),
  targets = JSON.parse(
    readFileSync(
      value("--manifest") ||
        fileURLToPath(new URL("../map-sources/resorts.json", import.meta.url)),
      "utf8",
    ),
  ) as ResortTarget[];
const target = targetId ? targets.find((t) => t.id === targetId) : undefined;
if (targetId && !target) throw Error("Курорт не найден в manifest");
const bytes = readFileSync(file),
  text = bytes.toString("utf8"),
  raw = text.trimStart().startsWith("<")
    ? osmXmlToOverpass(text)
    : JSON.parse(text);
if (raw.remark)
  throw Error("Overpass вернул remark/ошибку. Каталог не заменён.");
const updatedAt = new Date().toISOString();
let bundles;
let rejections: unknown[] = [];
if (raw.type === "FeatureCollection") {
  if (!target) throw Error("Для OpenSkiData укажите --resort");
  bundles = [normalizeOpenSkiData(raw, target, updatedAt)];
} else {
  const normalized = normalizeOverpass(raw, updatedAt, { target });
  bundles = normalized.bundles;
  rejections = normalized.rejections;
}
if (!bundles.length)
  throw Error(
    "Нет привязанных объектов курорта. Если отсутствует winter_sports, укажите --resort dombay (или другой manifest target).",
  );
const provenance = {
  inputSha256: digest(bytes),
  rejections,
  format:
    raw.type === "FeatureCollection"
      ? "OpenSkiData"
      : text.trimStart().startsWith("<")
        ? "OSM XML"
        : "Overpass JSON",
  target: target ?? null,
  importedAt: updatedAt,
};
const result = installBundles(
  bundles,
  resolve(value("--output") || "map-data"),
  { target, provenance },
);
console.log(
  JSON.stringify({ counts: result.counts, quality: result.reports }, null, 2),
);
