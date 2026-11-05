import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const target = process.argv[2];
if (!target) {
  console.error(
    "Usage: node deploy/prepare-env.mjs /etc/slopemate/slopemate.env",
  );
  process.exitCode = 1;
} else {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const source = fs
      .readFileSync(new URL("./server.env.example", import.meta.url), "utf8")
      .replace(/^DEPLOYMENT_ID=$/m, "DEPLOYMENT_ID=" + randomUUID())
      .replace(
        /^DIAGNOSTICS_TOKEN=$/m,
        "DIAGNOSTICS_TOKEN=" + randomBytes(32).toString("hex"),
      );
    fs.writeFileSync(target, source, { flag: "wx", mode: 0o600 });
    console.log(
      "Production env created. Edit BOT_TOKEN and APP_URL locally. Existing files are never overwritten; no credentials were printed.",
    );
  } catch (e) {
    console.error(
      e.code === "EEXIST"
        ? "Configuration already exists; left unchanged."
        : "Cannot create configuration; check permissions.",
    );
    process.exitCode = 1;
  }
}
