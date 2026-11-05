import { useSkiData } from "./ski/useSkiData";
import { useAnalysis } from "./useAnalysis";
import { LiftCard } from "./ski/LiftCard";
import { NativeRecorderPanel } from "./ski/NativeRecorderPanel";
import { matchLift, matchPiste, type SkiLine } from "../../shared/ski";
import { localDay, aggregate, longestDay } from "./metrics";
declare const __SLOPEMATE_BUILD__: string;
import React, { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  Mountain,
  House,
  Navigation,
  Map as MapIcon,
  ChartNoAxesCombined,
  UserRound,
  ArrowUpRight,
  ArrowDownRight,
  Play,
  Square,
  Upload,
  ChevronRight,
  Trash2,
  Flame,
  Route,
  Timer,
  Flag,
  Zap,
  LocateFixed,
  ChevronLeft,
  Check,
  RefreshCw,
  AlertTriangle,
  WifiOff,
} from "lucide-react";
import {
  api,
  tg,
  km,
  speed,
  duration,
  date,
  type Me,
  type Session,
  type Profile,
} from "./api";
const LazyMap = lazy(() => import("./Map"));
function TrackMap(props: React.ComponentProps<typeof LazyMap>) {
  return (
    <Suspense
      fallback={
        <div className="map-loading" role="status">
          Загружаем карту…
        </div>
      }
    >
      <LazyMap {...props} />
    </Suspense>
  );
}
import { RiderMark, Splash, LoadingScreen } from "./components/Brand";
import { Home } from "./screens/Home";
import {
  Avatar,
  PageTitle,
  Stat,
  Metrics,
  Empty,
  SessionRow,
  MapLegend,
  DayChart,
  ProfileForm,
} from "./components/UI";
import { useRecorder } from "./useRecorder";
import { analyze, type Analysis, type Point } from "../../shared/track";
import { demoNames } from "../../shared/demo";
import "./style.css";
const tabs = [
  { id: "home", label: "Главная", Icon: House },
  { id: "ride", label: "Катание", Icon: Navigation },
  { id: "map", label: "Карта", Icon: MapIcon },
  { id: "history", label: "Прогресс", Icon: ChartNoAxesCombined },
  { id: "profile", label: "Профиль", Icon: UserRound },
];
function App() {
  const [me, setMe] = useState<Me | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const [showSplash, setShowSplash] = useState(true);
  const [splashDismissed, setSplashDismissed] = useState(false);
  useEffect(() => {
    if (!me) return;
    const timer = setTimeout(() => setSplashDismissed(true), 180);
    return () => clearTimeout(timer);
  }, [me]);
  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 1200);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    tg?.ready();
    tg?.expand();
    tg?.setHeaderColor?.("#000000");
    tg?.setBackgroundColor?.("#000000");
    const safe = () => {
      document.documentElement.style.setProperty(
        "--tg-top",
        `${(tg?.safeAreaInset?.top ?? 0) + (tg?.contentSafeAreaInset?.top ?? 0)}px`,
      );
      document.documentElement.style.setProperty(
        "--tg-bottom",
        `${Math.max(tg?.safeAreaInset?.bottom ?? 0, tg?.contentSafeAreaInset?.bottom ?? 0)}px`,
      );
    };
    safe();
    tg?.onEvent?.("safeAreaChanged", safe);
    tg?.onEvent?.("contentSafeAreaChanged", safe);
    api<Me>("/me")
      .then(setMe)
      .catch((e) => setError(e.message));
    return () => {
      tg?.offEvent?.("safeAreaChanged", safe);
      tg?.offEvent?.("contentSafeAreaChanged", safe);
    };
  }, [attempt]);
  if (!me && !error) return showSplash ? <Splash /> : <LoadingScreen />;
  if (!me)
    return (
      <main className="gate">
        <RiderMark />
        <h1>SlopeMate</h1>
        <p>{error || "Готовим твою следующую линию…"}</p>
        {error && (
          <button
            className="primary"
            onClick={() => {
              setError("");
              setAttempt(attempt + 1);
            }}
          >
            Повторить
          </button>
        )}
      </main>
    );
  return (
    <>
      <Workspace me={me} setMe={setMe} />
      {showSplash && !splashDismissed && <Splash exiting />}
    </>
  );
}
const EMPTY_POINTS: Point[] = [];
const EMPTY_LINES: SkiLine[] = [];
function Workspace({ me, setMe }: { me: Me; setMe: (m: Me) => void }) {
  const [tab, setTab] = useState("home"),
    [sessions, setSessions] = useState<Session[]>([]),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Session | null>(null),
    [run, setRun] = useState<number | undefined>(),
    [demoView, setDemoView] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [filter, setFilter] = useState("season"),
    [day, setDay] = useState(localDay(Date.now())),
    [trip, setTrip] = useState(""),
    [resort, setResort] = useState(me.profile.resort),
    [rideTrip, setRideTrip] = useState(""),
    [importDemo, setImportDemo] = useState(false);
  const [progressView, setProgressView] = useState<"analytics" | "history">(
    "analytics",
  );
  const rec = useRecorder(me.user.id);
  const ski = useSkiData();
  const current = useAnalysis(
    rec.draft?.points ?? EMPTY_POINTS,
    ski.bundle?.lines ?? EMPTY_LINES,
  );
  const liftMatch = useMemo(
    () =>
      matchLift((rec.draft?.points ?? []).slice(-40), ski.bundle?.lines ?? []),
    [rec.draft, ski.bundle],
  );
  const pisteMatch = useMemo(
    () =>
      matchPiste((rec.draft?.points ?? []).slice(-5), ski.bundle?.lines ?? []),
    [rec.draft, ski.bundle],
  );
  const liveEdge = current.edges.at(-1);
  const hasFreshFix =
    rec.active &&
    Boolean(current.points.length) &&
    rec.now - current.points.at(-1)!.t < 20000;
  const liveSpeed =
    hasFreshFix && liveEdge && liveEdge.seconds > 0
      ? speed(liveEdge.speed)
      : null;

  const reload = async () => {
    const data = await api<Session[]>("/sessions");
    setSessions(data);
    setLoaded(true);
  };
  useEffect(() => {
    reload().catch((e) => setError(e.message));
    const change = () => setOnline(navigator.onLine);
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, []);
  useEffect(() => {
    const back = () => {
      setSelected(null);
      setRun(undefined);
    };
    if (selected) {
      tg?.BackButton?.show();
      tg?.BackButton?.onClick(back);
    } else tg?.BackButton?.hide();
    return () => tg?.BackButton?.offClick(back);
  }, [selected]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const go = (id: string) => {
    setTab(id);
    setSelected(null);
    setRun(undefined);
    tg?.HapticFeedback?.impactOccurred("light");
    window.scrollTo({ top: 0 });
  };
  const details = async (id: string) =>
    act(async () => {
      setSelected(await api<Session>(`/sessions/${id}`));
      setRun(undefined);
    });
  const real = sessions.filter((s) => s.source !== "demo");
  const visible = sessions.filter((s) =>
    demoView ? s.source === "demo" : s.source !== "demo",
  );
  const seasonStart = () => {
    const d = new Date();
    return new Date(
      d.getFullYear() - (d.getMonth() < 6 ? 1 : 0),
      6,
      1,
    ).getTime();
  };
  const season = real.filter((s) => s.started_at >= seasonStart());
  const summary = aggregate(season);
  const filtered = visible.filter(
    (s) =>
      filter === "all" ||
      (filter === "season" && s.started_at >= seasonStart()) ||
      (filter === "today" && localDay(s.started_at) === localDay(Date.now())) ||
      (filter === "day" && localDay(s.started_at) === day) ||
      (filter === "trip" && s.trip === trip),
  );
  const stats = aggregate(filtered);
  const latest = real[0];
  const save = () =>
    act(async () => {
      if (!rec.draft) return;
      rec.pause();
      const result = await api<Session>("/sessions", {
        method: "POST",
        body: JSON.stringify({
          ...rec.draft,
          skiResortId: ski.id || undefined,
        }),
      });
      rec.clear();
      await reload();
      setSelected(result);
      setTab("history");
    });
  const importFile = (file: File) =>
    act(async () => {
      if (file.size > 5 * 1024 * 1024) throw new Error("Файл больше 5 МБ");
      const form = new FormData();
      form.set("file", file);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await importKeyBytes(file, me.user.id, importDemo),
      );
      const hex = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      )
        .join("")
        .slice(0, 32);
      const stableId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      form.set("id", stableId);
      form.set("resort", resort);
      form.set("trip", rideTrip);
      form.set("demo", String(importDemo));
      const s = await api<Session>("/import", { method: "POST", body: form });
      await reload();
      setDemoView(importDemo);
      setTab("history");
      setSelected(s);
    });
  const mapScreen = tab === "map" && !selected;
  return (
    <div className={`shell app-enter page-${selected ? "details" : tab}`}>
      {!mapScreen && (
        <header className="topbar">
          <button
            className="brand"
            onClick={() => go("home")}
            aria-label="На главную"
          >
            <RiderMark />
            <span>SlopeMate</span>
          </button>
          <span className="season-tag">
            <i /> СЕЗОН {new Date(seasonStart()).getFullYear()}/
            {String(new Date(seasonStart()).getFullYear() + 1).slice(2)}
          </span>
        </header>
      )}
      {me.dev && !mapScreen && (
        <div className="dev-strip">
          Локальный режим · тестовый профиль · без Telegram
        </div>
      )}
      {!online && (
        <div className="alert">
          <WifiOff size={18} /> Нет интернета. GPS сохраняется локально;
          синхронизация — после восстановления связи.
        </div>
      )}
      {error && (
        <div role="alert" className="alert error">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button onClick={() => setError("")} aria-label="Закрыть ошибку">
            ×
          </button>
        </div>
      )}
      {rec.draft && tab !== "ride" && (
        <button className="draft-strip" onClick={() => go("ride")}>
          <span className="live-dot" />
          {rec.active ? "Идёт запись" : "Есть незавершённая запись"} ·{" "}
          {rec.draft.points.length} точек <ChevronRight size={16} />
        </button>
      )}
      <main>
        {selected ? (
          <>
            <button
              className="text-button"
              onClick={() => {
                setSelected(null);
                setRun(undefined);
              }}
            >
              <ChevronLeft size={17} /> Назад к списку
            </button>
            <div className="page-heading">
              <span className="eyebrow">
                {selected.source === "demo"
                  ? "ДЕМО · СИНТЕТИЧЕСКИЙ ТРЕК"
                  : selected.source === "gpx"
                    ? "ИМПОРТ GPX"
                    : selected.source === "native"
                      ? "IOS-РЕКОРДЕР"
                      : "GPS-ЗАПИСЬ"}
              </span>
              <h1>{selected.resort || "Твоя линия"}</h1>
              <p>
                {date(selected.started_at)}
                {selected.trip && ` · ${selected.trip}`}
              </p>
            </div>
            <TrackMap
              points={selected.analysis.points}
              analysis={selected.analysis}
              ski={ski}
              run={run === undefined ? undefined : selected.analysis.runs[run]}
            />
            <MapLegend />
            <Metrics a={selected.analysis} />
            {selected.analysis.terrain && (
              <section className="section" aria-label="Трассы и фрирайд">
                <h2>Трассы и фрирайд</h2>
                <p>
                  По известным трассам:{" "}
                  {(selected.analysis.terrain.pisteDistance / 1000).toFixed(2)}{" "}
                  км
                </p>
                <p>
                  Вероятный фрирайд:{" "}
                  {(selected.analysis.terrain.offPisteDistance / 1000).toFixed(
                    2,
                  )}{" "}
                  км ·{" "}
                  {Math.round(selected.analysis.terrain.offPisteSeconds / 60)}{" "}
                  мин · {selected.analysis.terrain.offPisteCount} участков
                </p>
                <p>
                  Не определено:{" "}
                  {Math.round(selected.analysis.terrain.unknownShare * 100)}%
                  дистанции.
                </p>
                <p className="fine">
                  {selected.analysis.terrain.mapCoverage === "none"
                    ? "Для этой записи нет сохранённой привязки к карте."
                    : "Карта неполная: вне известных трасс не означает доказанный фрирайд."}{" "}
                  Пурпурные точки — вероятный фрирайд, серый штрих — не
                  определено, фиолетовая линия — личный трек. Это аналитика
                  движения, не рекомендация маршрута и не оценка безопасности.
                </p>
              </section>
            )}
            <p className="fine">
              Анализ: GPS Engine {selected.analysis.engineVersion ?? 1}.{" "}
              {selected.analysis.altitudeQuality === "inferred"
                ? "Направление по высоте предварительное; точный перепад неизвестен."
                : ""}
            </p>
            {!!selected.analysis.pisteMatches?.length && (
              <section>
                <h2>Предположительно распознанные трассы</h2>
                {selected.analysis.pisteMatches.map((p) => (
                  <p key={p.id}>
                    {p.name} · {Math.round(p.distance)} м · вероятная привязка,
                    не полное прохождение
                  </p>
                ))}
              </section>
            )}
            <p className="fine">
              {selected.analysis.rejected} точек отфильтровано ·{" "}
              {selected.analysis.gaps} разрывов. Цвета трасс обозначают
              сложность OSM; личный GPS-трек отображается отдельно.
            </p>
            <section className="section">
              <div className="section-title">
                <h2>Спуски</h2>
                <span>{selected.analysis.runs.length}</span>
              </div>
              {!selected.analysis.runs.length ? (
                <Empty
                  text="Спуски не определены"
                  detail="Для надёжной классификации нужны точные высоты. Маршрут и дистанция доступны независимо от этого."
                />
              ) : (
                <>
                  <button className="chip" onClick={() => setRun(undefined)}>
                    Весь маршрут
                  </button>
                  {selected.analysis.runs.map((r, i) => (
                    <button
                      key={i}
                      className={`session-row ${run === i ? "chosen" : ""}`}
                      onClick={() => setRun(i)}
                    >
                      <span className="row-icon">
                        <ArrowDownRight />
                      </span>
                      <span>
                        <strong>Спуск {i + 1}</strong>
                        <small>
                          {km(r.distance)} км · {duration(r.seconds)}
                        </small>
                      </span>
                      <span>
                        {r.drop == null ? "—" : Math.round(r.drop) + " м"}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </section>
            <button
              className="danger"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "Удалить запись и все её GPS-точки? Это действие нельзя отменить.",
                  )
                )
                  act(async () => {
                    await api(`/sessions/${selected.id}`, { method: "DELETE" });
                    setSelected(null);
                    await reload();
                  });
              }}
            >
              <Trash2 size={17} /> Удалить запись
            </button>
          </>
        ) : (
          <>
            {tab === "home" && (
              <Home
                me={me}
                summary={summary}
                count={season.length}
                latest={latest}
                hasDraft={Boolean(rec.draft)}
                onRide={() => go("ride")}
                onHistory={() => {
                  go("history");
                  setProgressView("history");
                }}
                onProgress={() => {
                  go("history");
                  setProgressView("analytics");
                }}
                onDetails={details}
              />
            )}
            {tab === "ride" && (
              <>
                <PageTitle
                  over="ТВОЯ СЛЕДУЮЩАЯ ЛИНИЯ"
                  title="Катание"
                  text="Маршрут. Движение. Ничего лишнего."
                />
                <div className="notice">
                  <LocateFixed size={20} />
                  <span>
                    GPS записывается, пока Mini App открыт. В фоне и при
                    блокировке телефона запись не гарантируется.
                  </span>
                </div>
                <TrackMap
                  points={rec.draft?.points ?? EMPTY_POINTS}
                  analysis={current}
                  live={rec.active}
                  ski={ski}
                />
                <LiftCard
                  match={rec.active && hasFreshFix ? liftMatch : null}
                />
                {rec.active && hasFreshFix && pisteMatch && (
                  <p className="fine">
                    Предположительно трасса: {pisteMatch.name}
                  </p>
                )}
                <MapLegend />
                <div
                  className="record-card"
                  data-recording={rec.active}
                  data-state={
                    rec.active ? "active" : rec.draft ? "paused" : "idle"
                  }
                >
                  <div className="section-title">
                    <span className="eyebrow">
                      {rec.active
                        ? "● ЗАПИСЬ ИДЁТ"
                        : rec.draft
                          ? "ПАУЗА · НА УСТРОЙСТВЕ"
                          : "ГОТОВ К СТАРТУ"}
                    </span>
                    <span>{rec.draft?.points.length ?? 0} точек</span>
                  </div>
                  <div className="live-speed">
                    <span className="eyebrow">ТЕКУЩАЯ СКОРОСТЬ</span>
                    <div>
                      {liveSpeed ?? "—"}
                      <small>км/ч</small>
                    </div>
                    <span className="gps-quality">
                      {hasFreshFix
                        ? "GPS · свежие координаты"
                        : rec.active
                          ? "GPS · ожидаем сигнал"
                          : rec.draft
                            ? "GPS · приостановлен"
                            : "GPS · готов к запросу"}
                    </span>
                  </div>
                  <div className="ride-metrics">
                    <div>
                      <strong>{km(current.distance)}</strong>
                      <span>км · дистанция</span>
                    </div>
                    <div>
                      <strong>{duration(current.duration)}</strong>
                      <span>время трека</span>
                    </div>
                    <div>
                      <strong>
                        {current.drop == null ? "—" : Math.round(current.drop)}
                      </strong>
                      <span>м · точный перепад</span>
                    </div>
                  </div>
                  <div className="record-details">
                    <span>
                      <Timer size={16} />
                      {duration(current.duration)}
                    </span>
                    <span>
                      <Zap size={16} />
                      {speed(current.maxSpeed)} км/ч макс.
                    </span>
                  </div>
                  {rec.active && rec.draft && (
                    <p className="fine">
                      С начала сессии:{" "}
                      {duration((rec.now - rec.draft.started) / 1000)} · время
                      без GPS не входит в движение
                    </p>
                  )}
                  {rec.notice && (
                    <p role="status" className="warning">
                      {rec.notice}
                    </p>
                  )}
                  <details className="record-options">
                    <summary>Параметры записи</summary>
                    <button
                      className="text-button"
                      onClick={() => go("profile")}
                    >
                      Запись с заблокированным экраном: iOS-рекордер
                    </button>
                    {!rec.draft && (
                      <div className="form-grid">
                        <label>
                          Курорт (необязательно)
                          <input
                            maxLength={100}
                            value={resort}
                            onChange={(e) => setResort(e.target.value)}
                            placeholder="Например, Роза Хутор"
                          />
                        </label>
                        <label>
                          Поездка (для группировки)
                          <input
                            maxLength={100}
                            value={rideTrip}
                            onChange={(e) => setRideTrip(e.target.value)}
                            placeholder="Например, Кавказ · январь"
                          />
                        </label>
                      </div>
                    )}
                    {!rec.active && (
                      <label className="provider-label">
                        Источник координат
                        <select
                          value={rec.provider}
                          onChange={(e) =>
                            rec.setProvider(
                              e.target.value as "browser" | "telegram",
                            )
                          }
                        >
                          <option value="browser">
                            GPS браузера · watchPosition
                          </option>
                          <option value="telegram">
                            Telegram LocationManager · опрос 5 с
                          </option>
                        </select>
                      </label>
                    )}
                  </details>
                  <div className="button-stack">
                    {rec.active ? (
                      <button className="secondary" onClick={rec.pause}>
                        <Square size={17} /> Приостановить
                      </button>
                    ) : (
                      <button
                        className="primary"
                        disabled={busy || !rec.ready}
                        onClick={() => {
                          rec.start(resort, rideTrip);
                          window.scrollTo({ top: 0 });
                        }}
                      >
                        <Play size={17} />
                        {rec.draft ? "Возобновить GPS" : "Начать GPS-запись"}
                      </button>
                    )}
                    {rec.draft && (
                      <>
                        <button
                          className="secondary"
                          disabled={busy || current.points.length < 2}
                          onClick={save}
                        >
                          <Check size={17} /> Завершить и сохранить
                        </button>
                        <button
                          className="text-button muted"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Удалить незавершённый трек с устройства?",
                              )
                            )
                              rec.clear();
                          }}
                        >
                          Сбросить запись
                        </button>
                      </>
                    )}
                  </div>
                  <p className="fine">
                    Нажимая «Начать», вы разрешаете запись своей геолокации.
                    Трек приватный. При сбое сети завершённую запись можно
                    отправить повторно.
                  </p>
                </div>
                <section className="section">
                  <h2>Своя линия из GPX</h2>
                  <p className="muted">
                    До 5 МБ и 40 000 точек. Координаты и время с часовым поясом
                    обязательны. Обычный импорт входит в личную статистику.
                  </p>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={importDemo}
                      onChange={(e) => setImportDemo(e.target.checked)}
                    />{" "}
                    Учебный GPX — сохранить как демо, без личных рекордов
                  </label>
                  <label className={`upload-button ${busy ? "disabled" : ""}`}>
                    <Upload size={19} /> Импортировать GPX
                    <input
                      aria-label="Импортировать GPX"
                      type="file"
                      accept=".gpx,application/gpx+xml,application/xml,text/xml"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) importFile(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </section>
                <section id="demo" className="section">
                  <div className="section-title">
                    <h2>Исследуй без гор</h2>
                    <span className="badge">ДЕМО</span>
                  </div>
                  <p className="muted">
                    Синтетические маршруты для проверки. Не входят в реальные
                    рекорды. Каждый запуск создаёт отдельную демо-запись.
                  </p>
                  {demoNames.map((name, i) => (
                    <button
                      className="session-row"
                      key={name}
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const s = await api<Session>("/demo", {
                            method: "POST",
                            body: JSON.stringify({ index: i }),
                          });
                          await reload();
                          setDemoView(true);
                          setFilter("all");
                          setSelected(s);
                          setTab("history");
                        })
                      }
                    >
                      <span className="demo-number">0{i + 1}</span>
                      <span>
                        <strong>{name.split(" · ")[0]}</strong>
                        <small>Учебный трек · 15 минут</small>
                      </span>
                      <ArrowUpRight size={20} />
                    </button>
                  ))}
                </section>
              </>
            )}
            {tab === "map" && (
              <TrackMap
                points={rec.draft?.points ?? EMPTY_POINTS}
                analysis={current}
                live={rec.active}
                ski={ski}
                large
              />
            )}
            {tab === "history" && (
              <>
                <PageTitle
                  over="ПРОГРЕСС В КАЖДОЙ ЛИНИИ"
                  title={
                    progressView === "history"
                      ? "История катаний"
                      : "Твой прогресс"
                  }
                  text="Сравнивай себя с собой вчерашним."
                />
                <div
                  className="progress-switch"
                  role="group"
                  aria-label="Раздел прогресса"
                >
                  <button
                    className={progressView === "analytics" ? "active" : ""}
                    onClick={() => setProgressView("analytics")}
                  >
                    Обзор
                  </button>
                  <button
                    className={progressView === "history" ? "active" : ""}
                    onClick={() => setProgressView("history")}
                  >
                    История катаний
                  </button>
                </div>
                <div className="segmented">
                  <button
                    className={!demoView ? "active" : ""}
                    onClick={() => setDemoView(false)}
                  >
                    Мои записи
                  </button>
                  <button
                    className={demoView ? "active" : ""}
                    onClick={() => {
                      setDemoView(true);
                      setFilter("all");
                    }}
                  >
                    Демонстрация
                  </button>
                </div>
                {demoView && (
                  <p className="warning">
                    Демо — синтетические треки. Личные рекорды и статистика на
                    главной их не учитывают.
                  </p>
                )}
                <div className="filter-row">
                  {[
                    ["today", "Сегодня"],
                    ["day", "День"],
                    ["trip", "Поездка"],
                    ["season", "Сезон"],
                    ["all", "Всё время"],
                  ].map(([v, l]) => (
                    <button
                      className={`chip ${filter === v ? "active" : ""}`}
                      key={v}
                      onClick={() => setFilter(v)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                {filter === "day" && (
                  <label>
                    Выберите день
                    <input
                      type="date"
                      value={day}
                      onChange={(e) => setDay(e.target.value)}
                    />
                  </label>
                )}
                {filter === "trip" && (
                  <label>
                    Поездка
                    <select
                      value={trip}
                      onChange={(e) => setTrip(e.target.value)}
                    >
                      <option value="">Без названия</option>
                      {[...new Set(visible.map((s) => s.trip))]
                        .filter(Boolean)
                        .map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                    </select>
                  </label>
                )}
                {progressView === "analytics" && (
                  <>
                    <div className="stat-grid">
                      <Stat
                        icon={<Route />}
                        value={km(stats.distance)}
                        unit="км"
                        label="Общая дистанция"
                      />
                      <Stat
                        icon={<Zap />}
                        value={speed(stats.maxSpeed)}
                        unit="км/ч"
                        label="Макс. скорость"
                      />
                      <Stat
                        icon={<Flag />}
                        value={String(stats.runs)}
                        label="Спусков"
                      />
                      <Stat
                        icon={<Mountain />}
                        value={String(stats.days)}
                        label="Дней катания"
                      />
                    </div>
                    <div className="summary-lines">
                      <div>
                        <span>Средняя скорость движения</span>
                        <b>{speed(stats.avgSpeed)} км/ч</b>
                      </div>
                      <div>
                        <span>Время движения</span>
                        <b>{duration(stats.movingSeconds)}</b>
                      </div>
                      <div>
                        <span>Время сессий (включая остановки)</span>
                        <b>{duration(stats.duration)}</b>
                      </div>
                      <div>
                        <span>Дистанция определённых спусков</span>
                        <b>{km(stats.descentDistance)} км</b>
                      </div>
                      <div>
                        <span>Перепад на определённых спусках</span>
                        <b>
                          {stats.drop == null
                            ? "Нет точных высот"
                            : Math.round(stats.drop) + " м"}
                        </b>
                      </div>
                    </div>
                    <section className="section">
                      <div className="section-title">
                        <h2>Дистанция по дням</h2>
                        <span>км</span>
                      </div>
                      <DayChart sessions={filtered} />
                    </section>
                    <section className="section">
                      <h2>
                        {demoView ? "Демо-результаты" : "Личные рекорды"} ·
                        выбранный период
                      </h2>
                      <div className="record-best">
                        <Flame size={22} />
                        <span>
                          Самый длинный трек
                          <strong>
                            {km(
                              Math.max(
                                0,
                                ...filtered.map((s) => s.analysis.distance),
                              ),
                            )}{" "}
                            км
                          </strong>
                        </span>
                        <span>
                          Самый долгий день
                          <strong>{duration(longestDay(filtered))}</strong>
                        </span>
                      </div>
                    </section>
                  </>
                )}
                <section className="section">
                  <div className="section-title">
                    <h2>История</h2>
                    <button
                      className="icon-button"
                      aria-label="Обновить историю"
                      disabled={busy}
                      onClick={() => act(reload)}
                    >
                      <RefreshCw size={18} />
                    </button>
                  </div>
                  {!loaded ? (
                    <p className="muted">Загружаем историю…</p>
                  ) : !filtered.length ? (
                    <Empty
                      text="Здесь пока чистый склон"
                      detail="Измените период или создайте первую запись."
                    />
                  ) : (
                    filtered.map((s) => (
                      <SessionRow
                        key={s.id}
                        s={s}
                        onClick={() => details(s.id)}
                      />
                    ))
                  )}
                </section>
              </>
            )}
            {tab === "profile" && (
              <>
                <PageTitle
                  over="ЗНАКОМСТВО НА СКЛОНЕ"
                  title="Профиль райдера"
                  text="Твой стиль. Твои горы."
                />
                <div className="profile-head">
                  <Avatar me={me} />
                  <div>
                    <h2>{me.user.first_name}</h2>
                    <p className="muted">
                      {me.user.username
                        ? "@" + me.user.username
                        : "Telegram-профиль"}
                    </p>
                  </div>
                  <span className="badge">{me.dev ? "DEV" : "TELEGRAM"}</span>
                </div>
                <ProfileForm
                  profile={me.profile}
                  busy={busy}
                  onSave={(p) =>
                    act(async () => {
                      await api("/profile", {
                        method: "PUT",
                        body: JSON.stringify(p),
                      });
                      setMe({ ...me, profile: p });
                    })
                  }
                />
                <NativeRecorderPanel />
                <section className="privacy">
                  <LocateFixed size={22} />
                  <div>
                    <h3>Твоя линия — только твоя</h3>
                    <p>
                      Координаты приватны. Общего рейтинга и передачи геолокации
                      друзьям в этой версии нет. Записи можно удалить в истории.
                      Локальный черновик удаляется после синхронизации или
                      сброса.
                    </p>
                  </div>
                </section>
                <p className="fine">
                  SlopeMate 0.1 · Создано для движения
                  <br />
                  Друзья, достижения и добровольный обмен местоположением —
                  следующий этап.
                </p>
              </>
            )}
          </>
        )}
      </main>
      {busy && (
        <div className="busy" role="status">
          Сохраняем линию…
        </div>
      )}
      <nav className="bottom-nav" aria-label="Основная навигация">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? "active" : ""}
            onClick={() => go(id)}
          >
            <Icon size={21} />
            <span>{label}</span>
            {id === "ride" && rec.active && <i className="nav-dot" />}
          </button>
        ))}
      </nav>
      {!mapScreen && (
        <footer>
          SLOPEMATE <span>· {__SLOPEMATE_BUILD__.slice(0, 7)}</span>
        </footer>
      )}
    </div>
  );
}
async function importKeyBytes(file: File, userId: number, demo: boolean) {
  const prefix = new TextEncoder().encode(`${userId}:${demo}:`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const combined = new Uint8Array(prefix.length + bytes.length);
  combined.set(prefix);
  combined.set(bytes, prefix.length);
  return combined;
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
