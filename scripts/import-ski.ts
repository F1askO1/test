import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  existsSync,
  statSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { normalizeOverpass } from "../shared/ski-import.js";
const file = process.argv[2];
if (!file)
  throw Error(
    "Укажите Overpass JSON: npm run maps:import -- path/to/russia.json. Сетевая загрузка: npm run maps:fetch",
  );
if (statSync(file).size > 64 * 1024 * 1024)
  throw Error("Лимит входного файла 64 MiB");
const raw = JSON.parse(readFileSync(file, "utf8"));
if (raw.remark)
  throw Error("Overpass вернул remark/ошибку. Каталог не заменён.");
const { catalog, bundles } = normalizeOverpass(raw);
if (!bundles.length)
  throw Error("Нет курортов с landuse=winter_sports. Старый каталог сохранён.");
const root = resolve("map-data");
mkdirSync(root, { recursive: true });
// Versioned filenames: catalogue changes atomically only when all bundles are ready.
const lock = resolve(root, ".import.lock");
let fd: number;
try {
  fd = openSync(lock, "wx");
} catch {
  throw Error(
    "Уже выполняется импорт; проверьте .import.lock после аварийного завершения.",
  );
}
try {
  const stamp = Date.now().toString(36);
  const files: Record<string, string> = {};
  for (const bundle of bundles) {
    const name = `${bundle.resort.id}-${stamp}.json`;
    writeFileSync(resolve(root, name), JSON.stringify(bundle));
    files[bundle.resort.id] = name;
  }
  const tmp = resolve(root, "catalog.tmp");
  if (existsSync(resolve(root, "catalog.json")))
    writeFileSync(
      resolve(root, "catalog.previous.json"),
      readFileSync(resolve(root, "catalog.json")),
    );
  writeFileSync(tmp, JSON.stringify({ ...catalog, files }));
  renameSync(tmp, resolve(root, "catalog.json"));
  const controls = [
    "Роза Хутор",
    "Красная Поляна",
    "Газпром",
    "Архыз",
    "Домбай",
    "Эльбрус",
    "Шерегеш",
    "Манжерок",
    "Большой Вудъявр",
    "Абзаково",
    "Банное",
    "Белокуриха",
    "Солнечная долина",
    "Сорочаны",
    "Волен",
    "Степаново",
    "Игора",
  ];
  writeFileSync(
    resolve(root, "coverage.json"),
    JSON.stringify(
      {
        updatedAt: catalog.updatedAt,
        counts: {
          resorts: catalog.resorts.length,
          pistes: catalog.resorts.reduce((s, r) => s + r.pistes, 0),
          lifts: catalog.resorts.reduce((s, r) => s + r.lifts, 0),
          classified: catalog.resorts.reduce((s, r) => s + r.classified, 0),
          unassigned: catalog.unassigned,
        },
        controls: controls.map((name) => ({
          name,
          matches: catalog.resorts
            .filter((r) =>
              [r.name, ...r.aliases].some((n) =>
                n.toLowerCase().includes(name.toLowerCase()),
              ),
            )
            .map((r) => ({ id: r.id, pistes: r.pistes, lifts: r.lifts })),
        })),
        note: "Контроль названий, не проверка полноты и не список всех курортов.",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      resorts: catalog.resorts.length,
      pistes: catalog.resorts.reduce((s, r) => s + r.pistes, 0),
      lifts: catalog.resorts.reduce((s, r) => s + r.lifts, 0),
      classified: catalog.resorts.reduce((s, r) => s + r.classified, 0),
      unassigned: catalog.unassigned,
    }),
  );
} finally {
  closeSync(fd);
  unlinkSync(lock);
}
