import { needsBuild, needsInstall, recordInstall } from "./build-utils.mjs";
import { parseFunnelStatus } from "./funnel.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import readline from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  endpointIdentity,
  prepareLocalDiagnostics,
  LauncherError,
  redact,
  errorCode,
  readEnv,
  assertPublicEnv,
  validateAppUrl,
  saveAppUrl,
  health,
  freePort,
  proxyCheck,
  parseTunnelLine,
  lockFile,
} from "./network-utils.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const mode = process.argv[2] ?? "menu",
  envPath = path.join(root, ".env"),
  logs = path.join(root, "logs");
fs.mkdirSync(logs, { recursive: true });
let env = {},
  secrets = [],
  release,
  stopping = false,
  tunnelState = { registered: false, url: "", pid: 0 },
  httpChild,
  activeIdentity;
const children = new Set(),
  stamp = new Date().toISOString().replace(/[:.]/g, "-"),
  logPath = path.join(logs, `launcher-${stamp}.log`);
function write(message) {
  const safe = redact(message, [...secrets, root, os.homedir()]);
  console.log(safe);
  fs.appendFileSync(logPath, safe + "\n", { mode: 0o600 });
}
function load() {
  if (!fs.existsSync(envPath))
    throw new LauncherError(
      "Нет .env. Сначала запустите 01_INSTALL.bat, затем 05_EDIT_ENV.bat.",
    );
  env = readEnv(envPath);
  secrets = [env.BOT_TOKEN, env.TELEGRAM_PROXY_URL, env.DIAGNOSTICS_TOKEN];
  if (env.TELEGRAM_PROXY_URL) {
    try {
      const u = new URL(env.TELEGRAM_PROXY_URL);
      secrets.push(
        decodeURIComponent(u.password),
        decodeURIComponent(u.username),
      );
    } catch {}
  }
}
function npmCli() {
  const candidates = [
    path.join(
      path.dirname(process.execPath),
      "node_modules/npm/bin/npm-cli.js",
    ),
    path.resolve(
      path.dirname(process.execPath),
      "../lib/node_modules/npm/bin/npm-cli.js",
    ),
  ];
  const cli = candidates.find((p) => fs.existsSync(p));
  if (!cli)
    throw new LauncherError(
      "npm CLI не найден рядом с Node.js. Установите Node.js 24 LTS с npm.",
    );
  return cli;
}
function nodeCheck() {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new LauncherError("Установите Node.js 24 LTS.");
  try {
    const version = execFileSync(process.execPath, [npmCli(), "--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    write(`Node ${process.versions.node}; npm ${version}`);
  } catch {
    throw new LauncherError(
      "npm не найден рядом с Node.js. Переустановите Node.js 24 LTS с npm.",
    );
  }
}
function npm(args, extra = {}) {
  const cli = npmCli();
  return child(process.execPath, [cli, ...args], extra);
}
function capture(p, tag, onLine = () => {}) {
  for (const stream of [p.stdout, p.stderr]) {
    let buffer = "";
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 65536 && !buffer.includes("\n")) {
        buffer = "";
        write(`[${tag}] oversized log line omitted`);
        return;
      }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (line) {
          onLine(line);
          write(`[${tag}] ${line}`);
        }
      }
    });
    stream?.on("end", () => {
      if (buffer) {
        onLine(buffer);
        write(`[${tag}] ${buffer}`);
      }
    });
  }
}
function child(
  command,
  args,
  { vars = {}, tag = "process", onLine = () => {}, ipc = false } = {},
) {
  const options = {
    cwd: root,
    env: { ...process.env, ...env, ...vars, DEBUG: "", NODE_DEBUG: "" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", ...(ipc ? ["ipc"] : [])],
  };
  const p = spawn(command, args, options);
  children.add(p);
  p.on("error", (e) => write(`[${tag}] ${errorCode(e)}`));
  p.on("exit", (code, signal) => {
    children.delete(p);
    write(`[${tag}] PID ${p.pid} завершён; code=${code ?? signal}`);
  });
  capture(p, tag, onLine);
  write(`[${tag}] PID ${p.pid ?? "not started"}`);
  return p;
}
function result(p) {
  return new Promise((resolve, reject) => {
    p.once("error", () => reject(new Error("Не удалось запустить процесс.")));
    p.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error("Команда завершилась с ошибкой; см. безопасный лог."),
          ),
    );
  });
}
async function stopChild(p) {
  if (!p || p.exitCode !== null || p.signalCode || !children.has(p)) return;
  const exited = new Promise((resolve) => p.once("exit", resolve));
  if (p.connected) p.send("shutdown", () => {});
  else if (process.platform === "win32") {
    await new Promise((resolve) => {
      const k = spawn("taskkill.exe", ["/PID", String(p.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      k.once("error", resolve);
      k.once("exit", resolve);
    });
  } else p.kill("SIGTERM");
  await Promise.race([exited, delay(7000, undefined, { ref: false })]);
  if (children.has(p) && p.exitCode === null) {
    // Only a child still owned by this live launcher; never enumerate-and-kill unrelated cloudflared/node.
    if (process.platform === "win32") {
      await new Promise((resolve) => {
        const k = spawn("taskkill.exe", ["/PID", String(p.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        k.once("error", resolve);
        k.once("exit", resolve);
      });
    } else p.kill("SIGKILL");
    await Promise.race([exited, delay(2000, undefined, { ref: false })]);
  }
}
let shutdownTask;
function shutdown() {
  if (shutdownTask) return shutdownTask;
  shutdownTask = shutdownOwned();
  return shutdownTask;
}
async function shutdownOwned() {
  stopping = true;
  write("Останавливаем только процессы этого launcher…");
  for (const p of [...children].reverse()) await stopChild(p);
  release?.();
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void shutdown().then(() => process.exit(0));
  });
async function processList() {
  if (process.platform !== "win32") return [];
  try {
    const raw = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "@(Get-CimInstance Win32_Process -Filter \"name LIKE 'cloudflared%.exe' OR name='node.exe'\" | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; name=$_.Name; known=($null -ne $_.CommandLine); slopemate=($_.CommandLine -match '3001|SlopeMate|dist[\\/]backend[\\/]src[\\/]index.js') } }) | ConvertTo-Json -Compress".replace(
          "3001|SlopeMate",
          String(port()) + "|SlopeMate",
        ),
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    throw new LauncherError(
      "Не удалось проверить процессы Windows через CIM. Запуск отменён: проверьте PowerShell/права.",
    );
  }
}
async function conflicts() {
  const processes = await processList();
  const tunnels = processes.filter((p) => /^cloudflared.*\.exe$/i.test(p.name));
  if (tunnels.length) {
    write(
      `Найдены cloudflared PID: ${tunnels.map((p) => p.pid).join(", ")}. Их логи и метрики относятся к отдельным процессам. Чужие процессы не останавливаем.`,
    );
    if (tunnels.some((p) => !p.known))
      throw new LauncherError(
        "Не удалось прочитать принадлежность cloudflared. Проверьте процессы вручную; новый туннель не запущен.",
      );
    if (tunnels.some((p) => p.slopemate))
      throw new LauncherError(
        "Уже найден cloudflared, связанный с портом SlopeMate. Закройте его исходное окно и повторите.",
      );
  }
}
function cloudflareCommand() {
  const executable = env.CLOUDFLARED_PATH || "cloudflared.exe";
  try {
    execFileSync(executable, ["--version"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {
    throw new LauncherError(
      "cloudflared не найден. Установите официальную утилиту или задайте CLOUDFLARED_PATH в .env.",
    );
  }
  return executable;
}
function port() {
  const n = Number(env.PORT || 3001);
  if (!Number.isInteger(n) || n < 1 || n > 65535)
    throw new LauncherError("PORT: неверный номер.");
  return n;
}
function local() {
  return `http://127.0.0.1:${port()}`;
}
async function waitHealth(url, p, timeout = 25000) {
  const end = Date.now() + timeout;
  let observation;
  while (Date.now() < end && !stopping) {
    if (p && (p.exitCode !== null || p.signalCode))
      throw new LauncherError("Процесс HTTP завершился до готовности.");
    observation = await health(url, { timeout: 3000 });
    if (observation.ok) return;
    await delay(1000);
  }
  throw new LauncherError(`HTTP не готов: ${observation?.reason ?? "timeout"}`);
}
function startHttp(botEnabled) {
  return child(process.execPath, ["dist/backend/src/index.js"], {
    ipc: true,
    tag: "http",
    vars: {
      NODE_ENV: "production",
      DEV_AUTH: "false",
      HOST: "127.0.0.1",
      BOT_ENABLED: String(botEnabled),
      DEBUG: "",
      NODE_DEBUG: "",
    },
  });
}
async function startTunnel() {
  const exe = cloudflareCommand();
  await conflicts();
  const localHealth = await health(local() + "/api/health");
  if (!localHealth.ok)
    throw new LauncherError(
      "Локальный /api/health недоступен. Туннель не запущен.",
    );
  const protocol = env.TUNNEL_PROTOCOL || "http2",
    ip = env.TUNNEL_EDGE_IP_VERSION || "4";
  if (
    !["http2", "quic", "auto"].includes(protocol) ||
    !["4", "6", "auto"].includes(ip)
  )
    throw new LauncherError(
      "Неверные TUNNEL_PROTOCOL / TUNNEL_EDGE_IP_VERSION.",
    );
  // Only cloudflared goes direct, irrespective of inherited HTTP proxy settings. Does not bypass OS TUN/routes.
  const direct = {
    BOT_TOKEN: "",
    TELEGRAM_PROXY_URL: "",
    DIAGNOSTICS_TOKEN: "",
  };
  for (const name of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ])
    direct[name] = "";
  const p = child(
    exe,
    [
      "tunnel",
      "--protocol",
      protocol,
      "--edge-ip-version",
      ip,
      "--url",
      local(),
      "--metrics",
      "127.0.0.1:0",
      "--no-autoupdate",
    ],
    {
      tag: "cloudflared",
      vars: direct,
      onLine: (line) => {
        const event = parseTunnelLine(line);
        if (event.url) tunnelState.url = event.url;
        if (event.registered) tunnelState.registered = true;
        if (event.disconnected) {
          tunnelState.registered = false;
          write(
            "Cloudflare: наблюдается обрыв edge-соединения. Ожидаем проверку публичного health; новый URL автоматически не создаём.",
          );
        }
      },
    },
  );
  tunnelState.pid = p.pid;
  const end = Date.now() + 90000;
  while (Date.now() < end && !stopping) {
    if (p.exitCode !== null || p.signalCode)
      throw new LauncherError(
        "cloudflared завершился до проверки доступности.",
      );
    if (tunnelState.url && tunnelState.registered) {
      const first = await health(tunnelState.url + "/api/health");
      if (first.ok) {
        await delay(2000);
        const second = await health(tunnelState.url + "/api/health");
        if (second.ok) {
          write(
            `Quick Tunnel проверен двумя запросами: ${tunnelState.url}; PID ${p.pid}`,
          );
          fs.writeFileSync(
            path.join(logs, "tunnel-state.json"),
            JSON.stringify(
              {
                pid: p.pid,
                launcherPid: process.pid,
                url: tunnelState.url,
                created: new Date().toISOString(),
              },
              null,
              2,
            ),
          );
          return p;
        }
      } else write(first.reason);
    }
    await delay(2000);
  }
  throw new LauncherError(
    "Quick Tunnel не прошёл публичную проверку за 90 секунд. См. лог; проверьте сеть/TUN. URL сам по себе не доказывает доступность.",
  );
}
async function monitor() {
  write(
    "Launcher остаётся открытым. Для остановки введите q и Enter или нажмите Ctrl+C.",
  );
  const input = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  input.on("line", (line) => {
    if (line.trim().toLowerCase() === "q")
      void shutdown().then(() => process.exit(0));
  });
  let ticks = 0;
  while (!stopping) {
    await delay(10000);
    if (stopping) break;
    const localResult = await health(local() + "/api/health");
    if (!localResult.ok) write("HTTP: " + localResult.reason);
    if (tunnelState.url) {
      const publicResult = await health(tunnelState.url + "/api/health");
      if (activeIdentity) {
        const match = await endpointIdentity(tunnelState.url, activeIdentity);
        if (!match.ok) write(match.reason);
      }
      if (!publicResult.ok) {
        write("Публичный health: " + publicResult.reason);
        write(
          `Локальный origin: ${localResult.ok ? "доступен" : "недоступен"}. ${tunnelState.pid ? "Проверьте лог cloudflared PID " + tunnelState.pid : "Проверьте существующий Tailscale Funnel и APP_URL"}.`,
        );
      }
    }
    if (++ticks % 3 === 0) await componentStatus();
    if (!children.size) {
      write("Управляемые процессы завершились. Повторный запуск — вручную.");
      break;
    }
  }
  input.close();
}
async function componentStatus() {
  try {
    const response = await fetch(
      local() + (env.DIAGNOSTICS_TOKEN ? "/api/diagnostics" : "/api/status"),
      {
        headers: env.DIAGNOSTICS_TOKEN
          ? { Authorization: "Bearer " + env.DIAGNOSTICS_TOKEN }
          : {},
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!response.ok) {
      write(
        env.DIAGNOSTICS_TOKEN
          ? "Защищённая диагностика недоступна; проверьте DIAGNOSTICS_TOKEN локально."
          : "Статус HTTP недоступен.",
      );
      return;
    }
    const s = await response.json();
    write(
      `Сборка: ${s.buildId ?? "неизвестна"}; HTTP: ${s.http}; SQLite: ${s.database}; бот: ${s.telegram?.bot}; Telegram API: ${s.telegram?.api}; proxy: ${s.telegram?.proxy}; меню: ${s.telegram?.setup ?? "unknown"}`,
    );
  } catch {
    write("Статусы компонентов недоступны.");
  }
}
async function diagnostics() {
  nodeCheck();
  load();
  write(
    "Диагностика не выполняет Telegram API-запросы и не запускает polling.",
  );
  if (env.RUN_TARGET === "remote") {
    const check = await endpointIdentity(env.APP_URL, env.DEPLOYMENT_ID);
    write(
      check.ok ? "Удалённый endpoint и deployment совпадают." : check.reason,
    );
    if (check.ok)
      write(
        `HTTP=${check.status.http}; SQLite=${check.status.database}; bot=${check.status.telegram?.bot}; API=${check.status.telegram?.api}; menu=${check.status.telegram?.menu}`,
      );
    return;
  }
  let processes = [];
  try {
    processes = await processList();
  } catch {
    write(
      "Проверка PID через Windows CIM недоступна; продолжаем read-only проверки порта, Funnel и HTTPS.",
    );
  }
  write(
    `Связанные node PID (эвристика CommandLine): ${
      processes
        .filter((p) => p.name === "node.exe" && p.slopemate)
        .map((p) => p.pid)
        .join(", ") || "нет/не Windows"
    }`,
  );
  const lockPath = path.join(logs, "launcher.lock");
  if (fs.existsSync(lockPath)) {
    try {
      const pid = JSON.parse(fs.readFileSync(lockPath, "utf8")).pid;
      write(
        `Lock launcher PID: ${Number.isInteger(pid) ? pid : "некорректный"}. Диагностика не меняет lock.`,
      );
    } catch {
      write("Lock launcher повреждён; проверьте исходное окно и PID вручную.");
    }
  }
  if (env.PUBLIC_ENDPOINT_MODE === "quick-test") {
    write(
      "Cloudflare quick-test PID: " +
        processes
          .filter((p) => /^cloudflared.*\.exe$/i.test(p.name))
          .map((p) => p.pid)
          .join(", "),
    );
    try {
      cloudflareCommand();
      write("cloudflared найден (только quick-test).");
    } catch (e) {
      write(e.message);
    }
  } else {
    const actual = inspectFunnel();
    if (actual && env.APP_URL && actual !== validateAppUrl(env.APP_URL))
      write("Funnel URL не совпадает с APP_URL. Проверьте .env.");
  }
  const proxy = await proxyCheck(env.TELEGRAM_PROXY_URL);
  write(
    `Прокси: ${proxy.configured ? (proxy.tcp ? "TCP доступен (SOCKS/Telegram ещё не доказаны)" : "TCP недоступен") : "не задан, прямой Telegram API"}`,
  );
  write(
    `Порт ${port()}: ${(await freePort(port())) ? "свободен" : "занят (проверьте владельца)"}`,
  );
  const h = await health(local() + "/api/health");
  write("HTTP local: " + (h.ok ? "ok" : h.reason));
  await componentStatus();
  if (env.APP_URL) {
    try {
      const url = validateAppUrl(env.APP_URL);
      const p = await health(url + "/api/health");
      if (env.DEPLOYMENT_ID) {
        const match = await endpointIdentity(url, env.DEPLOYMENT_ID);
        write(match.ok ? "APP_URL deployment совпадает." : match.reason);
      }
      write("HTTP public: " + (p.ok ? "ok" : p.reason));
      if (p.status === 502)
        write(
          "Origin сейчас " +
            (h.ok
              ? "доступен: проверьте адрес, PID и логи туннеля"
              : "недоступен: сначала исправьте HTTP"),
        );
    } catch {
      write("APP_URL: некорректный HTTPS origin");
    }
  } else write("APP_URL не задан.");
  write(`Отчёт без токенов/паролей: ${logPath}`);
}
async function remoteMonitor() {
  const url = validateAppUrl(env.APP_URL);
  const first = await endpointIdentity(url, env.DEPLOYMENT_ID);
  if (!first.ok) throw new LauncherError(first.reason);
  write(
    "Постоянный удалённый endpoint подтверждён. Backend, SQLite и бот управляются systemd на сервере; локальные копии не запускаются.",
  );
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.on("line", (line) => {
    if (line.trim().toLowerCase() === "q")
      void shutdown().then(() => process.exit(0));
  });
  write("q + Enter — закрыть монитор. Удалённый сервер продолжит работу.");
  while (!stopping) {
    const result = await endpointIdentity(url, env.DEPLOYMENT_ID);
    if (result.ok)
      write(
        `REMOTE HTTP=${result.status.http}; DB=${result.status.database}; bot=${result.status.telegram?.bot}; API=${result.status.telegram?.api}; menu=${result.status.telegram?.menu}`,
      );
    else write(result.reason);
    await delay(15000);
  }
  rl.close();
}
async function startExternal(polling = false) {
  const funnelUrl = inspectFunnel();
  if (funnelUrl && env.APP_URL && funnelUrl !== validateAppUrl(env.APP_URL))
    throw new LauncherError(
      "APP_URL отличается от работающего Funnel. Исправьте .env; сеть не перенастраивалась.",
    );
  if (!env.APP_URL && funnelUrl) {
    saveAppUrl(envPath, funnelUrl);
    load();
    write("APP_URL определён из уже работающего Funnel.");
  }
  const url = validateAppUrl(env.APP_URL);

  if (!(await freePort(port())))
    throw new LauncherError(
      "HTTP-порт занят. Закройте прежний запуск SlopeMate.",
    );
  httpChild = startHttp(false);
  await waitHealth(local() + "/api/health", httpChild);
  const localStatus = await (
    await fetch(local() + "/api/status", { signal: AbortSignal.timeout(5000) })
  ).json();
  activeIdentity = env.DEPLOYMENT_ID || localStatus.deploymentId;
  const verification = await endpointIdentity(url, activeIdentity);
  if (!verification.ok) throw new LauncherError(verification.reason);
  if (localStatus.buildId !== verification.status?.buildId)
    throw new LauncherError(
      "Публичный адрес отдаёт другую сборку. Проверьте старый сервер/Funnel; исходники и dist не совпадают с endpoint.",
    );
  if (polling) {
    await stopChild(httpChild);
    httpChild = startHttp(true);
    await waitHealth(local() + "/api/health", httpChild);
  }
  await waitHealth(url + "/api/health", httpChild);
  write(
    polling
      ? "Mini App готово. Full Bot инициализируется отдельно; смотрите статус API."
      : "Mini App готово. Telegram polling отключён. Откройте кнопку, настроенную в BotFather.",
  );
  tunnelState.url = url;
  await componentStatus();
  await monitor();
}
async function dependencies() {
  if (needsInstall(root)) {
    write("Устанавливаем зависимости по lockfile…");
    await result(
      npm(["ci", "--include=dev"], {
        tag: "npm",
        vars: {
          NODE_ENV: "development",
          BOT_TOKEN: "",
          DIAGNOSTICS_TOKEN: "",
          TELEGRAM_PROXY_URL: "",
        },
      }),
    );
    recordInstall(root);
  } else {
    recordInstall(root);
    write("Зависимости актуальны; npm ci не требуется.");
  }
}
async function currentBuild() {
  if (needsBuild(root)) {
    write("Исходники обновлены — собираем новую версию…");
    await result(
      npm(["run", "build"], {
        tag: "build",
        vars: {
          NODE_ENV: "production",
          BOT_TOKEN: "",
          DIAGNOSTICS_TOKEN: "",
          TELEGRAM_PROXY_URL: "",
        },
      }),
    );
  } else write("Production-сборка актуальна.");
}
function tailscaleExecutable() {
  const candidates = [
    env.TAILSCALE_PATH,
    process.env.ProgramFiles &&
      path.join(process.env.ProgramFiles, "Tailscale", "tailscale.exe"),
    process.platform === "win32" ? "tailscale.exe" : "tailscale",
  ].filter(Boolean);
  for (const exe of candidates) {
    try {
      execFileSync(exe, ["version"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 5000,
      });
      return exe;
    } catch {}
  }
  return null;
}
function inspectFunnel() {
  const exe = tailscaleExecutable();
  if (!exe) {
    write(
      "Tailscale не найден. Укажите TAILSCALE_PATH или проверьте APP_URL вручную.",
    );
    return null;
  }
  try {
    const output = execFileSync(exe, ["funnel", "status", "--json"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    const url = parseFunnelStatus(JSON.parse(output), port());
    write(
      url
        ? "Funnel уже работает и направлен на порт приложения. Используем без пересоздания."
        : "Не найден активный публичный Funnel на нужный порт. Проверьте Tailscale; launcher не открывает публичный доступ.",
    );
    return url;
  } catch {
    write(
      "Не удалось прочитать Funnel status JSON. Проверьте версию Tailscale, вход и права. Ничего не перенастроено.",
    );
    return null;
  }
}
async function checkFunnel() {
  const actual = inspectFunnel();
  if (actual && env.APP_URL && validateAppUrl(env.APP_URL) !== actual)
    throw new LauncherError(
      "APP_URL не совпадает с активным Funnel. Обновите адрес через 05_EDIT_ENV.bat.",
    );
  if (!env.APP_URL)
    throw new LauncherError(
      "Укажите HTTPS APP_URL существующего Funnel в .env.",
    );
  const result = await health(validateAppUrl(env.APP_URL) + "/api/health");
  write(result.ok ? "Публичный HTTPS health готов." : result.reason);
  return actual;
}
async function main(action) {
  if (fs.existsSync(envPath)) load();
  nodeCheck();
  if (action === "install") {
    await dependencies();
    if (!fs.existsSync(envPath))
      fs.copyFileSync(".env.example", envPath, fs.constants.COPYFILE_EXCL);
    const generated = prepareLocalDiagnostics(envPath);
    load();
    if (generated.length)
      write(
        "Подготовлены локальные " +
          generated.join(", ") +
          "; значения сохранены только в .env.",
      );
    await currentBuild();
    write("Установка завершена. Отредактируйте .env через 05_EDIT_ENV.bat.");
    return;
  }
  load();
  if (action === "funnel") {
    await checkFunnel();
    return;
  }
  if (action === "diagnostics") {
    await diagnostics();
    return;
  }
  if (action === "tests") {
    await dependencies();
    await result(npm(["run", "check"], { tag: "check" }));
    await result(npm(["test"], { tag: "tests" }));
    await result(npm(["run", "build"], { tag: "build" }));
    return;
  }
  if (!["local", "telegram", "miniapp", "fullbot", "tunnel"].includes(action))
    throw new LauncherError("Неизвестный режим launcher.");
  release = lockFile(path.join(logs, "launcher.lock"));
  if (action === "telegram")
    action = env.BOT_ENABLED === "false" ? "miniapp" : "fullbot";
  const publicAction = action === "miniapp" || action === "fullbot";
  if (action !== "tunnel") {
    await dependencies();
    await currentBuild();
  }
  if (action === "local") {
    if (port() !== 3001)
      throw new LauncherError(
        "Локальный Vite настроен на API 3001. Для 02_LOCAL задайте PORT=3001.",
      );
    if (!(await freePort(port())) || !(await freePort(5173)))
      throw new LauncherError(
        "Порт HTTP или 5173 уже занят. Закройте прежний запуск; чужие процессы не останавливаем.",
      );
    const p = npm(["run", "dev"], {
      tag: "dev",
      vars: {
        NODE_ENV: "development",
        DEV_AUTH: "true",
        BOT_TOKEN: "",
        BOT_ENABLED: "false",
        APP_URL: "",
        DEPLOYMENT_ID: "",
        DIAGNOSTICS_TOKEN: "",
        TELEGRAM_PROXY_URL: "",
        HOST: "127.0.0.1",
      },
    });
    await waitHealth(local() + "/api/health", p);
    write(
      "Локальный режим: http://127.0.0.1:5173. Не публикуйте его через туннель.",
    );
    await monitor();
    return;
  }
  if (publicAction && env.RUN_TARGET === "remote") {
    await remoteMonitor();
    return;
  }
  assertPublicEnv(env);
  if (!fs.existsSync("dist/backend/src/index.js"))
    throw new LauncherError(
      "Нет сборки. Выполните 01_INSTALL.bat или 06_TESTS.bat.",
    );
  if (action === "fullbot") {
    const proxy = await proxyCheck(env.TELEGRAM_PROXY_URL);
    if (proxy.configured && !proxy.tcp)
      write(
        "Прокси недоступен. HTTP продолжит работать; bot будет восстанавливаться отдельно.",
      );
  }
  if (publicAction && (env.PUBLIC_ENDPOINT_MODE || "external") === "external") {
    await startExternal(action === "fullbot");
    return;
  }
  if (publicAction && env.PUBLIC_ENDPOINT_MODE !== "quick-test")
    throw new LauncherError(
      "Выберите PUBLIC_ENDPOINT_MODE=external (постоянный адрес) либо quick-test только для тестов.",
    );
  if (publicAction)
    write(
      "ВНИМАНИЕ: quick-test — временный Cloudflare, не режим постоянной эксплуатации.",
    );
  if (publicAction) {
    cloudflareCommand();
    await conflicts();
    if (!(await freePort(port())))
      throw new LauncherError(
        "HTTP-порт занят. Закройте прежний запуск SlopeMate; существующий сервер не захватываем.",
      );
    httpChild = startHttp(false);
    await waitHealth(local() + "/api/health", httpChild);
    await startTunnel();
    saveAppUrl(envPath, tunnelState.url);
    load();
    write("APP_URL обновлён; остальные настройки .env сохранены.");
    // Restart only our HTTP process, with the verified URL. No overlapping pollers.
    await stopChild(httpChild);
    httpChild = startHttp(action === "fullbot");
    await waitHealth(local() + "/api/health", httpChild);
    await waitHealth(tunnelState.url + "/api/health", httpChild, 30000);
    await componentStatus();
  } else {
    // Manual tunnel is allowed only for a server declaring private production authentication.
    const r = await fetch(local() + "/api/status", {
      signal: AbortSignal.timeout(3000),
    });
    const s = await r.json();
    if (s.mode !== "production-private")
      throw new LauncherError(
        "03_TUNNEL требует приватный production HTTP. Используйте 04_TELEGRAM для безопасного полного запуска.",
      );
    await startTunnel();
    write(
      "Ручной туннель: APP_URL и бот автоматически не обновляются. Для полного запуска используйте 04_TELEGRAM.bat.",
    );
  }
  await monitor();
}
async function menu() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  write(
    "\nSlopeMate — Monochrome Alpine\n1. Установить / обновить (ZIP, без Git)\n2. Локальный режим разработки\n3. Mini App Only — Tailscale Funnel\n4. Mini App + Full Telegram Bot\n5. Проверить Tailscale и HTTPS\n6. Открыть .env\n7. Диагностика\n8. Тестирование\n0. Выход",
  );
  const answer = await rl.question("Выберите пункт: ");
  rl.close();
  const action = {
    1: "install",
    2: "local",
    3: "miniapp",
    4: "fullbot",
    5: "funnel",
    7: "diagnostics",
    8: "tests",
  }[answer.trim()];
  if (answer.trim() === "6") {
    if (!fs.existsSync(envPath))
      fs.copyFileSync(".env.example", envPath, fs.constants.COPYFILE_EXCL);
    await new Promise((resolve) => {
      const p = spawn("notepad.exe", [envPath], {
        stdio: "ignore",
        windowsHide: false,
      });
      p.once("error", resolve);
      p.once("exit", resolve);
    });
    return;
  }
  if (answer.trim() === "0") return;
  if (!action) throw new LauncherError("Выберите пункт 0–8.");
  await main(action);
}
try {
  if (mode === "menu") await menu();
  else await main(mode);
} catch (e) {
  write(
    e instanceof LauncherError
      ? e.message
      : `Ошибка запуска: ${errorCode(e)}. Проверьте .env и диагностический режим.`,
  );
  process.exitCode = 1;
} finally {
  await shutdown();
}
