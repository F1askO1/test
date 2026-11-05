import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { readEnv } from "./network-utils.mjs";
import { fetchResort, validateTarget } from "./ski-fetch.mjs";
const args = process.argv.slice(2),
  get = (key) => {
    const i = args.indexOf(key);
    if (i < 0) return undefined;
    if (!args[i + 1] || args[i + 1].startsWith("--"))
      throw Error("Нет значения " + key);
    return args[i + 1];
  };
const manifest = get("--manifest");
const targets = JSON.parse(
  fs.readFileSync(
    manifest ||
      fileURLToPath(new URL("../map-sources/resorts.json", import.meta.url)),
    "utf8",
  ),
).map(validateTarget);
const id = get("--resort") || "dombay",
  region = get("--region"),
  selected = args.includes("--control")
    ? targets
    : region
      ? targets.filter((t) => t.group === region)
      : targets.filter((t) => t.id === id);
if (!selected.length)
  throw Error(
    "Курорт/регион не найден. По умолчанию загружается только Домбай.",
  );
const endpoint =
  process.env.OVERPASS_URL ||
  (fs.existsSync(".env") ? readEnv(".env").OVERPASS_URL : "") ||
  "https://overpass-api.de/api/interpreter";
let failures = 0;
for (const target of selected) {
  try {
    await fetchResort(target, {
      endpoint,
      root: get("--cache") || "artifacts/maps",
      refresh: args.includes("--refresh"),
    });
  } catch (e) {
    failures++;
    console.error(e.message);
    if (e.status === 403 || e.status === 401) {
      console.error(
        "Источник запрещён политикой/авторизацией. Повторы других курортов не выполняются.",
      );
      process.exitCode = 13;
      break;
    }
  }
}
if (failures && !process.exitCode) process.exitCode = 1;
