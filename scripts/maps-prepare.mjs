import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const target = args.includes("--resort")
  ? args[args.indexOf("--resort") + 1]
  : "dombay";
const targets = JSON.parse(
  fs.readFileSync(path.join(root, "map-sources/resorts.json"), "utf8"),
);
const selected = args.includes("--control")
  ? targets
  : targets.filter((t) => t.id === target);
if (!selected.length) throw Error("Неверный курорт");
const child = (argv) => {
  const r = spawnSync(process.execPath, argv, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (r.error) throw Error("Не удалось запустить подготовку");
  return r.status ?? 1;
};
const checkpoint = path.resolve("artifacts/maps/control-state.json");
fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
const batch = {
  startedAt: new Date().toISOString(),
  jobs: Object.fromEntries(
    selected.map((t) => [t.id, { state: "not-attempted" }]),
  ),
};
function save() {
  const tmp = checkpoint + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(batch, null, 2));
  fs.renameSync(tmp, checkpoint);
}
let failures = 0;
save();
for (const t of selected) {
  batch.jobs[t.id] = { state: "fetching" };
  save();
  const fetchStatus = child([
    "--use-env-proxy",
    path.join(root, "scripts/fetch-ski.mjs"),
    "--resort",
    t.id,
    ...(args.includes("--refresh") ? ["--refresh"] : []),
  ]);
  if (fetchStatus) {
    batch.jobs[t.id] = { state: "fetch-failed", exitCode: fetchStatus };
    save();
    failures++;
    if (fetchStatus === 13 || t.id === "dombay") break;
    continue;
  }
  const file = path.resolve("artifacts/maps/prepared", t.id, "overpass.json");
  const imported = child([
    "--import",
    path.join(root, "node_modules/tsx/dist/loader.mjs"),
    path.join(root, "scripts/import-ski.ts"),
    file,
    "--resort",
    t.id,
  ]);
  batch.jobs[t.id] = {
    state: imported ? "quality-or-import-failed" : "installed",
  };
  save();
  if (imported) {
    failures++;
    if (t.id === "dombay") break;
  }
}
process.exitCode = failures ? 1 : 0;
