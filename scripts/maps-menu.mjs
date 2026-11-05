import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";
import readline from "node:readline/promises";
const root = fileURLToPath(new URL("..", import.meta.url));
process.chdir(root);
if (Number(process.versions.node.split(".")[0]) !== 24)
  throw Error("Нужен Node.js 24");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const ask = async (q) => (await rl.question(q)).trim().replace(/^"|"$/g, "");
const targets = JSON.parse(fs.readFileSync("map-sources/resorts.json", "utf8"));
const run = (script, args = [], ts = false) => {
  const loader = path.join(root, "node_modules/tsx/dist/loader.mjs");
  if (ts && !fs.existsSync(loader)) {
    console.log("Сначала выполните 01_INSTALL.bat.");
    return false;
  }
  const result = spawnSync(
    process.execPath,
    [
      ...(ts ? ["--import", loader] : ["--use-env-proxy"]),
      path.join(root, "scripts", script),
      ...args,
    ],
    { stdio: "inherit" },
  );
  if (result.error || result.status !== 0) {
    console.log(
      "Операция не завершена. Готовые части/предыдущие карты сохранены.",
    );
    return false;
  }
  return true;
};
async function choose() {
  console.log(targets.map((t, i) => `${i + 1}. ${t.name}`).join("\n"));
  const n = Number((await ask("Курорт [1 — Домбай]: ")) || "1");
  return targets[n - 1];
}
async function pick() {
  if (process.platform === "win32") {
    try {
      const script =
        "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='Карты (*.slopemap;*.json;*.osm;*.pbf)|*.slopemap;*.json;*.osm;*.pbf'; if($d.ShowDialog() -eq 'OK'){[Console]::Write($d.FileName)}";
      const file = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-STA", "-Command", script],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
      if (file) return file;
    } catch {}
  }
  return ask("Путь к локальному файлу (можно перетащить в окно): ");
}
try {
  for (;;) {
    console.log(
      "\nКарты SlopeMate — подготовка и перенос\n1. Загрузить и подготовить один курорт (начните с Домбая)\n2. Загрузить пять контрольных курортов с продолжением\n3. Импортировать Overpass JSON / OpenSkiData GeoJSON / OSM XML\n4. Экспортировать установленные карты для другого ПК\n5. Проверить и установить переносимый пакет .slopemap\n6. Выделить курорт из локального регионального PBF (нужен osmium)\n7. Получить свежие данные одного курорта (не использовать кэш)\n0. Выход",
    );
    const choice = await ask("Выбор: ");
    if (choice === "0") break;
    if (choice === "1") {
      const t = await choose();
      if (t) run("maps-prepare.mjs", ["--resort", t.id]);
    } else if (choice === "7") {
      const t = await choose();
      if (t) run("maps-prepare.mjs", ["--resort", t.id, "--refresh"]);
    } else if (choice === "2") run("maps-prepare.mjs", ["--control"]);
    else if (choice === "3") {
      const f = await pick(),
        t = await choose();
      if (f && t) run("import-ski.ts", [f, "--resort", t.id], true);
    } else if (choice === "4") {
      const dir = path.join(root, "map-exports");
      fs.mkdirSync(dir, { recursive: true });
      const filename = path.join(
        dir,
        "slopemate-" +
          new Date().toISOString().replace(/[:.]/g, "-") +
          ".slopemap",
      );
      if (run("map-package.ts", ["export", filename], true))
        console.log("Скопируйте этот файл на другой ПК: " + filename);
    } else if (choice === "5") {
      const f = await pick();
      if (f && run("map-package.ts", ["inspect", f], true)) {
        console.log(
          "Контрольная сумма проверяет целостность, но не достоверность источника. Устанавливайте пакет только от доверенного отправителя.",
        );
        if (
          (await ask("Установить эти курорты? Введите ДА: ")).toUpperCase() ===
          "ДА"
        )
          run("map-package.ts", ["import", f], true);
      }
    } else if (choice === "6") {
      const f = await pick(),
        t = await choose();
      if (f && t) run("extract-ski.mjs", [f, t.id]);
    }
  }
} finally {
  rl.close();
}
