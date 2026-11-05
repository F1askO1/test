import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
export const phases = ["sites", "pistes", "lifts", "stations"];
export const sha = (s) => createHash("sha256").update(s).digest("hex");
export function validateTarget(t) {
  if (
    !t ||
    !/^[a-z0-9-]{1,60}$/.test(t.id) ||
    typeof t.name !== "string" ||
    !Array.isArray(t.bbox) ||
    t.bbox.length !== 4
  )
    throw Error("Неверная цель загрузки");
  const [w, s, e, n] = t.bbox;
  if (
    !t.bbox.every(Number.isFinite) ||
    w < -180 ||
    e > 180 ||
    s < -85 ||
    n > 85 ||
    e <= w ||
    n <= s ||
    e - w > 2 ||
    n - s > 2
  )
    throw Error("Слишком большое или неверное поисковое окно");
  return t;
}
export function queryFor(target, phase) {
  validateTarget(target);
  const [w, s, e, n] = target.bbox,
    b = `(${s},${w},${n},${e})`;
  const q = {
    sites: `(nwr["landuse"="winter_sports"]${b};relation["site"="piste"]${b};);`,
    pistes: `relation["route"="piste"]["piste:type"="downhill"]${b}->.routes;(.routes;way(r.routes);way["piste:type"="downhill"]${b};);`,
    lifts: `way["aerialway"]${b};`,
    stations: `node["aerialway"="station"]${b};`,
  }[phase];
  if (!q) throw Error("Неверная часть запроса");
  return `[out:json][timeout:45][maxsize:33554432];${q}out body geom;`;
}
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
export function overpassDocument(value) {
  if (
    !value ||
    !Array.isArray(value.elements) ||
    value.elements.length > 100000 ||
    value.remark
  )
    throw Object.assign(Error("Неполный/неверный ответ Overpass"), {
      retryable: true,
    });
  return value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function code(e) {
  return e?.status
    ? `HTTP_${e.status}`
    : e?.name === "TimeoutError"
      ? "TIMEOUT"
      : e?.code === "ENOENT"
        ? "CACHE_MISSING"
        : "NETWORK_OR_RESPONSE";
}
async function fetchResortUnlocked(
  target,
  {
    root = "artifacts/maps",
    endpoint = "https://overpass-api.de/api/interpreter",
    fetchFn = fetch,
    sleepFn = sleep,
    log = console.log,
    maxAttempts = 3,
    now = () => new Date().toISOString(),
    random = Math.random,
    refresh = false,
  } = {},
) {
  validateTarget(target);
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("Нужен HTTPS endpoint без учётных данных/параметров");
  const dir = path.resolve(root, "raw", target.id);
  fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, "state.json");
  let state = {
    version: 2,
    target,
    endpoint: url.origin + url.pathname,
    parts: {},
  };
  try {
    const previous = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (previous.version === 2 && previous.endpoint === state.endpoint)
      state = { ...state, parts: previous.parts };
  } catch {}
  if (refresh) state.parts = {};
  const documents = [];
  for (const phase of phases) {
    const query = queryFor(target, phase),
      fingerprint = sha(query + state.endpoint),
      file = path.join(dir, phase + ".json"),
      old = state.parts[phase];
    let document;
    if (old?.state === "ready" && old.fingerprint === fingerprint) {
      try {
        const bytes = fs.readFileSync(file);
        if (sha(bytes) !== old.sha256) throw Error("checksum");
        document = overpassDocument(JSON.parse(bytes.toString()));
        log(`${target.name} / ${phase}: сохранённый результат проверен`);
      } catch {
        document = undefined;
      }
    }
    if (!document) {
      for (
        let attempt = 1;
        attempt <= Math.min(3, Math.max(1, maxAttempts));
        attempt++
      ) {
        state.parts[phase] = {
          state: "fetching",
          fingerprint,
          attempt,
          at: now(),
        };
        atomicJson(stateFile, state);
        log(`${target.name} / ${phase}: попытка ${attempt}/3`);
        try {
          const response = await fetchFn(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent":
                "SlopeMate resort preparation (github.com/F1askO1/test)",
            },
            body: new URLSearchParams({ data: query }),
            signal: AbortSignal.timeout(60000),
          });
          if (!response.ok) {
            const e = Object.assign(Error("HTTP " + response.status), {
              status: response.status,
              retryable: [408, 429, 500, 502, 503, 504].includes(
                response.status,
              ),
              retryAfter:
                Math.min(
                  30,
                  Math.max(0, Number(response.headers.get("retry-after")) || 0),
                ) * 1000,
            });
            throw e;
          }
          const chunks = [];
          let length = 0;
          for await (const chunk of response.body) {
            length += chunk.length;
            if (length > 32 * 1024 * 1024)
              throw Object.assign(Error("Ответ больше 32 MiB"), {
                retryable: false,
              });
            chunks.push(chunk);
          }
          document = overpassDocument(
            JSON.parse(Buffer.concat(chunks).toString()),
          );
          const bytes = Buffer.from(JSON.stringify(document));
          const tmp = file + ".tmp";
          fs.writeFileSync(tmp, bytes);
          fs.renameSync(tmp, file);
          state.parts[phase] = {
            state: "ready",
            fingerprint,
            sha256: sha(bytes),
            elements: document.elements.length,
            fetchedAt: now(),
            attempt,
          };
          atomicJson(stateFile, state);
          break;
        } catch (e) {
          // Undici wraps a CONNECT rejection in nested causes rather than a Response.
          let cause = e;
          for (
            let depth = 0;
            cause && depth < 6;
            depth++, cause = cause.cause
          ) {
            const match = String(cause.message ?? "").match(
              /^Proxy response \((\d{3})\)/,
            );
            if (match) {
              e.status = Number(match[1]);
              e.retryable = [408, 429, 500, 502, 503, 504].includes(e.status);
              break;
            }
          }
          const retry =
            (e.retryable !== false && !e.status) || e.retryable === true;
          state.parts[phase] = {
            state: "failed",
            fingerprint,
            attempt,
            at: now(),
            error: code(e),
          };
          atomicJson(stateFile, state);
          if (!retry || attempt >= Math.min(3, Math.max(1, maxAttempts))) {
            throw Object.assign(
              Error(
                `${target.name}: ${phase} не загружена (${code(e)}). Готовые части сохранены; повторный запуск продолжит загрузку.`,
              ),
              { status: e.status, code: code(e) },
            );
          }
          await sleepFn(
            Math.max(
              e.retryAfter || 0,
              Math.min(15000, 1500 * 2 ** (attempt - 1) + random() * 500),
            ),
          );
        }
      }
    }
    documents.push(document);
    if (phase !== phases.at(-1)) await sleepFn(1200);
  }
  const objects = new Map();
  for (const doc of documents)
    for (const e of doc.elements) {
      const id = e.type + "/" + e.id;
      const previous = objects.get(id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(e))
        throw Error(
          "Источник изменился между частями; повторите подготовку с новым snapshot.",
        );
      objects.set(id, e);
    }
  const output = path.resolve(root, "prepared", target.id);
  fs.mkdirSync(output, { recursive: true });
  const provenance = {
    target,
    source: state.endpoint,
    retrievedAt: now(),
    parts: state.parts,
    license: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors",
    synthetic: false,
  };
  atomicJson(path.join(output, "overpass.json"), {
    version: 0.6,
    generator: "SlopeMate batched Overpass",
    elements: [...objects.values()],
  });
  atomicJson(path.join(output, "provenance.json"), provenance);
  log(
    `${target.name}: все части сохранены; ${objects.size} OSM-объектов. Это ещё не публикация каталога.`,
  );
  return { directory: output, target, elements: objects.size };
}

export async function fetchResort(target, options = {}) {
  validateTarget(target);
  const dir = path.resolve(options.root || "artifacts/maps", "raw", target.id);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, ".fetch.lock");
  try {
    const text = fs.readFileSync(lock, "utf8"),
      old = JSON.parse(text);
    if (
      old.host !== os.hostname() ||
      !Number.isInteger(old.pid) ||
      old.pid <= 0
    )
      throw Error(
        "Есть lock другого ПК/неверный lock; проверьте завершение подготовки.",
      );
    let alive = true;
    try {
      process.kill(old.pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") alive = false;
    }
    if (alive)
      throw Error(
        "Этот курорт уже загружается; второй процесс не запускается.",
      );
    if (fs.readFileSync(lock, "utf8") === text) fs.unlinkSync(lock);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const fd = fs.openSync(lock, "wx");
  fs.writeFileSync(
    fd,
    JSON.stringify({ pid: process.pid, host: os.hostname() }),
  );
  try {
    return await fetchResortUnlocked(target, options);
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
