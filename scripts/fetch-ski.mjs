import { readEnv } from "./network-utils.mjs";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
const query =
  '[out:json][timeout:180][maxsize:268435456];area["ISO3166-1"="RU"]["admin_level"="2"]->.ru;(nwr["landuse"="winter_sports"](area.ru);way["piste:type"="downhill"](area.ru);way["aerialway"](area.ru);node["aerialway"="station"](area.ru););out tags geom;';
const endpoint =
  process.env.OVERPASS_URL ||
  (existsSync(".env") ? readEnv(".env").OVERPASS_URL : "") ||
  "https://overpass-api.de/api/interpreter";
if (
  new URL(endpoint).protocol !== "https:" ||
  new URL(endpoint).username ||
  new URL(endpoint).password
)
  throw Error("Только HTTPS Overpass");
console.log(
  "Явная загрузка OSM России; это не часть обычного запуска. Может занять несколько минут.",
);
const r = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "SlopeMate maps importer (github.com/F1askO1/test)",
  },
  body: new URLSearchParams({ data: query }),
  signal: AbortSignal.timeout(210000),
});
if (!r.ok) throw Error("Overpass HTTP " + r.status);
let length = 0;
const chunks = [];
for await (const chunk of r.body) {
  length += chunk.length;
  if (length > 64 * 1024 * 1024) throw Error("Ответ больше 64 MiB");
  chunks.push(chunk);
}
const data = Buffer.concat(chunks);
const parsed = JSON.parse(data.toString());
if (parsed.remark || !parsed.elements?.length)
  throw Error("Неполный/пустой ответ Overpass. Старая карта не заменена.");
mkdirSync("artifacts/maps", { recursive: true });
writeFileSync("artifacts/maps/russia-overpass.json", data);
console.log(
  "Сохранён artifacts/maps/russia-overpass.json. Затем npm run maps:import -- artifacts/maps/russia-overpass.json",
);
