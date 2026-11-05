import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const [input, id = "dombay"] = process.argv.slice(2);
if (!input || !fs.existsSync(input))
  throw Error("Укажите локальную региональную .osm.pbf и ID курорта.");
const root = fileURLToPath(new URL("..", import.meta.url));
const target = JSON.parse(
  fs.readFileSync(path.join(root, "map-sources/resorts.json"), "utf8"),
).find((t) => t.id === id);
if (!target) throw Error("Курорт не найден");
const stat = fs.statSync(input),
  key = createHash("sha256")
    .update(path.resolve(input) + stat.size + stat.mtimeMs)
    .digest("hex")
    .slice(0, 12);
const dir = path.resolve("artifacts/maps/regional", id + "-" + key);
fs.mkdirSync(dir, { recursive: true });
const exe = process.env.OSMIUM_PATH || "osmium";
const run = (args) => {
  const p = spawnSync(exe, args, {
    stdio: "inherit",
    windowsHide: true,
    timeout: 15 * 60000,
  });
  if (p.error || p.status !== 0)
    throw Error(
      "Требуется osmium-tool; региональный файл не изменялся. Подробнее docs/REAL_RESORT_IMPORT_RU.md",
    );
};
run([
  "extract",
  path.resolve(input),
  "--bbox",
  target.bbox.join(","),
  "--strategy",
  "complete_ways",
  "--output",
  path.join(dir, "extract.pbf"),
  "--overwrite",
]);
run([
  "tags-filter",
  path.join(dir, "extract.pbf"),
  "w/piste:type=downhill",
  "w/aerialway",
  "n/aerialway=station",
  "wr/landuse=winter_sports",
  "r/route=piste",
  "--output",
  path.join(dir, "filtered.pbf"),
  "--overwrite",
]);
run([
  "cat",
  path.join(dir, "filtered.pbf"),
  "--output-format",
  "osm",
  "--output",
  path.join(dir, "resort.osm"),
  "--overwrite",
]);
console.log("Извлечено: " + path.join(dir, "resort.osm"));
console.log("Затем maps:import с --resort " + target.id);
