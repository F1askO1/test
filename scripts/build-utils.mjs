import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
export function sourceIdentity(root) {
  const hash = createHash("sha256");
  const walk = (relative) => {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) return;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort())
        walk(path.join(relative, name));
    } else {
      hash.update(relative.replaceAll("\\", "/"));
      hash.update(fs.readFileSync(full));
    }
  };
  for (const entry of [
    "frontend",
    "backend",
    "shared",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
  ])
    walk(entry);
  return hash.digest("hex").slice(0, 16);
}
export function needsBuild(root) {
  try {
    const meta = JSON.parse(
      fs.readFileSync(path.join(root, "dist/build-meta.json"), "utf8"),
    );
    return (
      !fs.existsSync(path.join(root, "dist/frontend/index.html")) ||
      !fs.existsSync(path.join(root, "dist/backend/src/index.js")) ||
      meta.id !== sourceIdentity(root)
    );
  } catch {
    return true;
  }
}
export function lockIdentity(root) {
  return createHash("sha256")
    .update(fs.readFileSync(path.join(root, "package-lock.json")))
    .digest("hex");
}
export function needsInstall(root) {
  try {
    const receipt = JSON.parse(
      fs.readFileSync(
        path.join(root, "node_modules/.slopemate-install.json"),
        "utf8",
      ),
    );
    return (
      receipt.lock !== lockIdentity(root) ||
      ["vite", "tsx", "express", "grammy", "socks-proxy-agent"].some(
        (name) =>
          !fs.existsSync(path.join(root, "node_modules", name, "package.json")),
      )
    );
  } catch {
    // npm ci may have been run manually before the first launcher invocation.
    try {
      const declared = JSON.parse(
        fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
      ).packages;
      const installed = JSON.parse(
        fs.readFileSync(
          path.join(root, "node_modules/.package-lock.json"),
          "utf8",
        ),
      ).packages;
      const direct = {
        ...declared[""]?.dependencies,
        ...declared[""]?.devDependencies,
      };
      if (!Object.keys(direct).length) return true;
      for (const name of Object.keys(direct)) {
        const key = "node_modules/" + name;
        const actual = JSON.parse(
          fs.readFileSync(path.join(root, key, "package.json"), "utf8"),
        );
        if (actual.version !== declared[key]?.version) return true;
      }
      return Object.entries(installed).some(
        ([key, pkg]) =>
          !declared[key] ||
          pkg.version !== declared[key].version ||
          (pkg.integrity && pkg.integrity !== declared[key].integrity),
      );
    } catch {
      return true;
    }
  }
}
export function recordInstall(root) {
  fs.writeFileSync(
    path.join(root, "node_modules/.slopemate-install.json"),
    JSON.stringify({ lock: lockIdentity(root) }),
  );
}
export function recordBuild(root) {
  const meta = {
    id: sourceIdentity(root),
    builtAt: new Date().toISOString(),
    version: JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ).version,
  };
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "dist/build-meta.json"),
    JSON.stringify(meta, null, 2),
  );
  return meta;
}
