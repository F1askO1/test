import fs from "node:fs";
import net from "node:net";
import { randomUUID, randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
export class LauncherError extends Error {}
export function redact(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets
    .filter(Boolean)
    .sort((a, b) => b.length - a.length))
    out = out.split(secret).join("[REDACTED]");
  return out
    .replace(/\b\d{5,}:[A-Za-z0-9_-]{15,}\b/g, "[BOT_TOKEN]")
    .replace(
      /((?:https?|socks5h?):\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi,
      "$1[REDACTED]@",
    )
    .replace(/([?&](?:token|key|password|secret)=)[^\s&#]+/gi, "$1[REDACTED]");
}
// Keep exception messages out of diagnostics: they can contain URLs, headers and account information.
export function errorCode(e) {
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" &&
    /^(E[A-Z_]{2,32}|UND_ERR_[A-Z_]+)$/.test(code)
    ? code
    : "NETWORK_OR_CONFIG_ERROR";
}
export function readEnv(path) {
  return parseEnv(fs.readFileSync(path, "utf8"));
}
export function assertPublicEnv(env) {
  if (env.DEV_AUTH !== "false")
    throw new LauncherError(
      "Для публичного запуска установите DEV_AUTH=false в .env.",
    );
  if (!env.BOT_TOKEN)
    throw new LauncherError("Добавьте BOT_TOKEN в локальный .env (не в чат).");
  if (env.HOST && env.HOST !== "127.0.0.1")
    throw new LauncherError("Launcher требует HOST=127.0.0.1.");
}
export function validateAppUrl(raw) {
  const u = new URL(raw);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash
  )
    throw new LauncherError(
      "APP_URL: нужен HTTPS origin без пути, пароля и параметров.",
    );
  return u.origin;
}
export function updateAppUrlText(text, url) {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  if (bom) text = text.slice(1);
  const value = validateAppUrl(url);
  let found = false;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text
    .split(/\r?\n/)
    .filter((line) => {
      if (/^\s*(?:export\s+)?APP_URL\s*=/.test(line)) {
        if (found) return false;
        found = true;
      }
      return true;
    })
    .map((line) =>
      /^\s*(?:export\s+)?APP_URL\s*=/.test(line) ? `APP_URL=${value}` : line,
    );
  if (!found) {
    if (lines.at(-1) === "") lines.pop();
    lines.push(`APP_URL=${value}`, "");
  }
  return bom + lines.join(newline);
}
export function saveAppUrl(path, url) {
  const original = fs.readFileSync(path, "utf8");
  const updated = updateAppUrlText(original, url),
    temp = path + ".launcher-" + randomUUID() + ".tmp";
  let created = false;
  try {
    fs.writeFileSync(temp, updated, { mode: 0o600, flag: "wx" });
    created = true;
    fs.renameSync(temp, path);
  } finally {
    if (created && fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
export function classifyCloudflare(status, body = "") {
  if (/\b1033\b/.test(body))
    return "1033: нет доступного соединения cloudflared с Cloudflare. Проверьте процесс, edge-соединение и TUN/DNS.";
  if (status === 502)
    return "502: Cloudflare не получил корректный ответ origin. Проверьте локальный /api/health и порт приложения.";
  return `HTTP ${status}: публичная проверка не прошла.`;
}
export async function health(url, { timeout = 8000, fetchFn = fetch } = {}) {
  try {
    const r = await fetchFn(url, {
      signal: AbortSignal.timeout(timeout),
      headers: { "Cache-Control": "no-cache" },
    });
    const text = await r.text();
    let ok = false;
    try {
      ok = r.ok && JSON.parse(text).ok === true;
    } catch {}
    return {
      ok,
      status: r.status,
      reason: ok ? "ok" : classifyCloudflare(r.status, text),
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      reason: `Сеть/DNS/TLS: ${errorCode(e)}. Не отключайте проверку сертификатов.`,
    };
  }
}
export async function tcp(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => finish(false));
    s.once("error", () => finish(false));
    s.once("connect", () => finish(true));
  });
}
export async function freePort(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}
export function parseTunnelLine(line) {
  return {
    url: line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i)?.[0],
    registered: /Registered tunnel connection/.test(line),
    disconnected:
      /failed to serve|connection.*(?:closed|lost)|TLS handshake.*error|Unable to establish|no more connections/i.test(
        line,
      ),
  };
}
// An exclusive lock blocks a second launcher; stale files are removed only when the PID demonstrably does not exist.
export function lockFile(
  path,
  pid = process.pid,
  isAlive = (p) => {
    try {
      process.kill(p, 0);
      return true;
    } catch (e) {
      return e.code !== "ESRCH";
    }
  },
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(path, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid }));
      fs.closeSync(fd);
      return () => {
        try {
          const data = JSON.parse(fs.readFileSync(path, "utf8"));
          if (data.pid === pid) fs.unlinkSync(path);
        } catch {}
      };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let data;
      try {
        data = JSON.parse(fs.readFileSync(path, "utf8"));
      } catch {
        throw new LauncherError(
          "Lock повреждён: проверьте процессы и файл launcher.lock вручную.",
        );
      }
      if (!Number.isInteger(data.pid) || data.pid < 1 || isAlive(data.pid))
        throw new LauncherError(
          "Другой экземпляр launcher ещё работает (или PID занят). Закройте его; процессы не завершаются автоматически.",
        );
      fs.unlinkSync(path);
    }
  }
  throw new LauncherError("Не удалось получить lock launcher.");
}
export async function proxyCheck(raw) {
  if (!raw) return { configured: false, tcp: null };
  const u = new URL(raw);
  if (
    !["socks5:", "socks5h:"].includes(u.protocol) ||
    !u.port ||
    u.search ||
    u.hash ||
    (u.pathname && u.pathname !== "/")
  )
    throw new LauncherError(
      "TELEGRAM_PROXY_URL: ожидается socks5://host:port.",
    );
  return {
    configured: true,
    tcp: await tcp(u.hostname.replace(/^\[|\]$/g, ""), Number(u.port)),
  };
}
export async function endpointIdentity(
  origin,
  expected,
  { fetchFn = fetch } = {},
) {
  try {
    const url = validateAppUrl(origin);
    if (!expected || !/^[A-Za-z0-9_-]{8,80}$/.test(expected))
      return {
        ok: false,
        reason:
          "DEPLOYMENT_ID не задан или неверен: нельзя подтвердить принадлежность endpoint.",
      };
    const r = await fetchFn(url + "/api/status", {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { "Cache-Control": "no-cache" },
    });
    if (!r.ok)
      return {
        ok: false,
        reason: classifyCloudflare(r.status, await r.text()),
      };
    const s = await r.json();
    return {
      ok:
        s.http === "ready" &&
        s.database === "ready" &&
        s.mode === "production-private" &&
        s.deploymentId === expected,
      reason:
        s.deploymentId === expected
          ? "Проверьте HTTP/SQLite/private mode"
          : "Адрес устарел или ведёт к другому deployment (identity mismatch).",
      status: s,
    };
  } catch (e) {
    return { ok: false, reason: "Endpoint: " + errorCode(e) };
  }
}
export function prepareLocalDiagnostics(file) {
  const env = readEnv(file);
  if (env.RUN_TARGET === "remote") return [];
  const additions = [];
  if (!env.DEPLOYMENT_ID) additions.push(["DEPLOYMENT_ID", randomUUID()]);
  if (!env.DIAGNOSTICS_TOKEN)
    additions.push(["DIAGNOSTICS_TOKEN", randomBytes(32).toString("hex")]);
  if (!additions.length) return [];
  const original = fs.readFileSync(file, "utf8"),
    newline = original.includes("\r\n") ? "\r\n" : "\n";
  let text = original;
  for (const [key, value] of additions) {
    const matcher = new RegExp("^\\s*(?:export\\s+)?" + key + "\\s*=");
    text = text
      .split(/\r?\n/)
      .filter((line) => !matcher.test(line))
      .join(newline);
    if (!text.endsWith(newline)) text += newline;
    text += key + "=" + value + newline;
  }
  const temp = file + ".launcher-" + randomUUID() + ".tmp";
  let created = false;
  try {
    fs.writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
    created = true;
    fs.renameSync(temp, file);
  } finally {
    if (created && fs.existsSync(temp)) fs.unlinkSync(temp);
  }
  return additions.map(([key]) => key);
}
