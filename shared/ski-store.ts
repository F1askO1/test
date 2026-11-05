import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { bundleSchema, catalogSchema } from "../backend/src/ski-data.js";
import { bundleQuality, type ResortTarget } from "./ski-quality.js";
import type { SkiBundle } from "./ski.js";
export const digest = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
export const safeMapName = (n: unknown): n is string =>
  typeof n === "string" &&
  /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.json$/.test(n) &&
  !n.includes("..");
export function atomicFile(file: string, data: string | Buffer) {
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, data, { flag: "w" });
  fs.renameSync(tmp, file);
}
export function installBundles(
  input: SkiBundle[],
  root = path.resolve("map-data"),
  options: { target?: ResortTarget; provenance?: unknown } = {},
) {
  const bundles = input.map((b) => bundleSchema.parse(b));
  const reports = bundles.map((b) => bundleQuality(b, options.target));
  if (!bundles.length || reports.some((r) => r.errors.length))
    throw Error(
      "Набор не прошёл контроль качества: " + JSON.stringify(reports),
    );
  const ids = bundles.map((b) => b.resort.id);
  if (new Set(ids).size !== ids.length) throw Error("Повтор курорта в пакете");
  fs.mkdirSync(root, { recursive: true });
  const lock = path.join(root, ".import.lock");
  let fd: number;
  try {
    fd = fs.openSync(lock, "wx");
  } catch {
    throw Error(
      "Уже выполняется импорт. Проверьте .import.lock после завершения прежнего процесса.",
    );
  }
  try {
    const file = path.join(root, "catalog.json");
    const previous = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : {
          version: 1,
          updatedAt: null,
          source: "",
          attribution: "© OpenStreetMap contributors · ODbL 1.0",
          resorts: [],
          files: {},
          unassigned: 0,
        };
    catalogSchema.parse(previous);
    const files: Record<string, string> = Object.assign(
      Object.create(null),
      previous.files,
    );
    for (const old of Object.values(files))
      if (!safeMapName(old)) throw Error("Некорректное имя прежнего набора");
    for (const b of bundles) {
      const bytes = JSON.stringify(b);
      const name = b.resort.id + "-" + digest(bytes).slice(0, 16) + ".json";
      const dest = path.join(root, name);
      if (!fs.existsSync(dest)) atomicFile(dest, bytes);
      else if (fs.readFileSync(dest, "utf8") !== bytes)
        throw Error("Конфликт immutable файла");
      files[b.resort.id] = name;
    }
    const resorts = [
      ...previous.resorts.filter((r: any) => !ids.includes(r.id)),
      ...bundles.map((b) => b.resort),
    ];
    const quality = {
      ...(previous.quality ?? {}),
      ...Object.fromEntries(reports.map((r) => [r.resortId, r])),
    };
    const catalog = {
      ...previous,
      version: 1,
      updatedAt: new Date().toISOString(),
      source: "Prepared OSM / OpenSkiData resort snapshots",
      resorts,
      files,
      quality,
      notice:
        "Неполные открытые данные. Количество — геометрические участки, не число официальных трасс. Принадлежность по поисковой области требует проверки.",
    };
    const total = {
      resorts: resorts.length,
      pistes: resorts.reduce((s: number, r: any) => s + r.pistes, 0),
      lifts: resorts.reduce((s: number, r: any) => s + r.lifts, 0),
      classified: resorts.reduce((s: number, r: any) => s + r.classified, 0),
    };
    const coverage = {
      updatedAt: catalog.updatedAt,
      counts: total,
      classificationShare: total.pistes
        ? total.classified / total.pistes
        : null,
      reports: quality,
      sourceProvenance: options.provenance ?? null,
      warning:
        "Counts are line features/sections, not independently verified complete resort coverage.",
    };
    atomicFile(
      path.join(root, "coverage.json"),
      JSON.stringify(coverage, null, 2),
    );
    if (fs.existsSync(file))
      atomicFile(
        path.join(root, "catalog.previous.json"),
        fs.readFileSync(file),
      );
    atomicFile(file, JSON.stringify(catalog));
    return { catalog, reports, counts: total };
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
