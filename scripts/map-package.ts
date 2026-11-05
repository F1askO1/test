import fs from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { bundleSchema, catalogSchema } from "../backend/src/ski-data.js";
import {
  installBundles,
  digest,
  safeMapName,
  atomicFile,
} from "../shared/ski-store.js";
const [command, file, rootArg] = process.argv.slice(2);
const root = path.resolve(rootArg || "map-data");
if (!file || !["export", "import", "inspect"].includes(command))
  throw Error(
    "maps:package -- export|inspect|import файл.slopemap [папка-map-data]",
  );
if (command === "export") {
  const catalog = catalogSchema.parse(
    JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8")),
  );
  if (!catalog.resorts.length)
    throw Error("Нельзя экспортировать пустой каталог");
  const entries = catalog.resorts.map((r) => {
    const name = catalog.files?.[r.id];
    if (!safeMapName(name)) throw Error("Неверный файл каталога");
    const bytes = fs.readFileSync(path.join(root, name));
    if (bytes.length > 12 * 1024 * 1024) throw Error("Набор больше 12 MiB");
    const b = bundleSchema.parse(JSON.parse(bytes.toString()));
    if (b.resort.id !== r.id) throw Error("Несоответствие курорта");
    return { id: r.id, sha256: digest(bytes), json: bytes.toString() };
  });
  const payload = Buffer.from(
    JSON.stringify({
      format: "SlopeMateMaps",
      version: 1,
      exportedAt: new Date().toISOString(),
      license: "ODbL-1.0",
      attribution: "© OpenStreetMap contributors",
      entries,
    }),
  );
  if (payload.length > 64 * 1024 * 1024)
    throw Error("Пакет >64 MiB распакованным");
  const dest = path.resolve(file);
  if (fs.existsSync(dest))
    throw Error("Пакет уже существует. Выберите новое имя.");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, gzipSync(payload), { flag: "wx" });
  console.log(
    "Готов переносимый пакет только карт; .env, SQLite и пользовательских GPS в нём нет.",
  );
} else {
  if (fs.statSync(file).size > 32 * 1024 * 1024) throw Error("Пакет >32 MiB");
  const bytes = gunzipSync(fs.readFileSync(file), {
    maxOutputLength: 64 * 1024 * 1024,
  });
  const doc = JSON.parse(bytes.toString());
  if (
    doc.format !== "SlopeMateMaps" ||
    doc.version !== 1 ||
    doc.license !== "ODbL-1.0" ||
    !Array.isArray(doc.entries) ||
    doc.entries.length < 1 ||
    doc.entries.length > 1000
  )
    throw Error("Неверный формат пакета");
  const bundles = doc.entries.map((e: any) => {
    if (
      typeof e.json !== "string" ||
      Buffer.byteLength(e.json) > 12 * 1024 * 1024 ||
      digest(e.json) !== e.sha256
    )
      throw Error("Контрольная сумма не совпала");
    const b = bundleSchema.parse(JSON.parse(e.json));
    if (b.resort.id !== e.id) throw Error("Несоответствие ID");
    return b;
  });
  const summary = bundles.map((b: any) => ({
    id: b.resort.id,
    name: b.resort.name,
    pistes: b.resort.pistes,
    lifts: b.resort.lifts,
    source: b.resort.source,
    association: b.resort.association ?? "unknown",
  }));
  console.log(JSON.stringify(summary, null, 2));
  // Checksums prove transfer integrity, not authenticity or accuracy. Validate all entries before any catalogue mutation.
  if (command === "import") {
    installBundles(bundles, root, {
      provenance: {
        packageSha256: digest(fs.readFileSync(file)),
        exportedAt: doc.exportedAt,
      },
    });
    console.log(
      "Пакет проверен и установлен; существующие другие курорты сохранены.",
    );
  }
}
