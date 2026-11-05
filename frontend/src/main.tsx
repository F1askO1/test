import React, { useEffect, useMemo, useState } from "react";
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
import TrackMap from "./Map";
import { useRecorder } from "./useRecorder";
import { analyze, type Analysis } from "../../shared/track";
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
  useEffect(() => {
    tg?.ready();
    tg?.expand();
    tg?.setHeaderColor?.("#111715");
    tg?.setBackgroundColor?.("#111715");
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
  if (!me)
    return (
      <main className="gate">
        <Mountain size={54} />
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
  return <Workspace me={me} setMe={setMe} />;
}
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
  const rec = useRecorder(me.user.id);
  const current = useMemo(() => analyze(rec.draft?.points ?? []), [rec.draft]);
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
        body: JSON.stringify(rec.draft),
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
  return (
    <div className="shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={() => go("home")}
          aria-label="На главную"
        >
          <Mountain size={26} />
          <span>SlopeMate</span>
        </button>
        <span className="season-tag">
          <i /> СЕЗОН {new Date(seasonStart()).getFullYear()}/
          {String(new Date(seasonStart()).getFullYear() + 1).slice(2)}
        </span>
      </header>
      {me.dev && (
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
              run={run === undefined ? undefined : selected.analysis.runs[run]}
            />
            <MapLegend />
            <Metrics a={selected.analysis} />
            <p className="fine">
              {selected.analysis.rejected} точек отфильтровано ·{" "}
              {selected.analysis.gaps} разрывов. Цвет линии — скорость; серый —
              подъём или остановка.
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
              <>
                <div className="greeting">
                  <div>
                    <span className="eyebrow">ТВОЙ ДЕНЬ. ТВОЯ ЛИНИЯ.</span>
                    <h1>
                      Привет, {me.profile.nickname || me.user.first_name}
                      <span className="accent">.</span>
                    </h1>
                    <p>Горы ближе, чем кажется.</p>
                  </div>
                  <Avatar me={me} />
                </div>
                <section className="hero">
                  <div className="mountain-art" aria-hidden="true">
                    <svg viewBox="0 0 600 280">
                      <path
                        d="M0 280 170 45 225 112 310 12 600 280Z"
                        fill="#263a30"
                      />
                      <path
                        d="m170 45 55 67 85-100 90 119-72-33-32-41-70 96-27-37-31 18-32-19-54 67Z"
                        fill="#b7d1b9"
                      />
                      <path
                        d="m110 280 200-268-33 181 46-67 55 154Z"
                        fill="#152c24"
                      />
                      <path d="m350 280 92-140 158 140Z" fill="#48614b" />
                      <path
                        d="m442 140-20 79 21-20 27 26-6-28 37 16Z"
                        fill="#c0cfb9"
                      />
                      <path d="M0 260q170-45 300 0t300-5v25H0" fill="#405740" />
                    </svg>
                  </div>
                  <span className="eyebrow">СЛЕДУЮЩИЙ СПУСК — ТВОЙ</span>
                  <h2>
                    Оставь свой
                    <br />
                    <em>след на склоне.</em>
                  </h2>
                  <p>Записывай линии. Замечай прогресс.</p>
                  <button className="primary" onClick={() => go("ride")}>
                    <Play size={18} fill="currentColor" />
                    {rec.draft ? "Продолжить катание" : "Начать катание"}
                    <ArrowUpRight size={20} />
                  </button>
                  <span className="hero-foot">
                    <LocateFixed size={12} /> GPS · запись при открытом
                    приложении
                  </span>
                </section>
                <section className="section">
                  <div className="section-title">
                    <h2>Этот сезон</h2>
                    <button
                      className="text-button"
                      onClick={() => go("history")}
                    >
                      Вся статистика <ArrowUpRight size={16} />
                    </button>
                  </div>
                  <div className="stat-grid">
                    <Stat
                      icon={<Route />}
                      value={km(summary.distance)}
                      unit="км"
                      label="Общая дистанция"
                      big
                    />
                    <Stat
                      icon={<Zap />}
                      value={speed(summary.maxSpeed)}
                      unit="км/ч"
                      label="Макс. скорость"
                    />
                    <Stat
                      icon={<Flag />}
                      value={String(summary.runs)}
                      label="Спусков"
                    />
                    <Stat
                      icon={<Mountain />}
                      value={String(summary.days)}
                      label="Дней в горах"
                    />
                  </div>
                  <div className="vertical-row">
                    <span>Перепад на определённых спусках</span>
                    <strong>
                      {summary.drop == null
                        ? "Нет точных высот"
                        : `${Math.round(summary.drop)} м`}
                    </strong>
                  </div>
                </section>
                <section className="section">
                  <div className="section-title">
                    <h2>Последняя линия</h2>
                    <button
                      className="text-button"
                      onClick={() => go("history")}
                    >
                      История <ChevronRight size={16} />
                    </button>
                  </div>
                  {latest ? (
                    <SessionRow s={latest} onClick={() => details(latest.id)} />
                  ) : (
                    <Empty
                      text="История начинается с тебя"
                      detail="Запиши катание, импортируй GPX или открой учебный маршрут."
                    />
                  )}
                </section>
                <button
                  className="demo-banner"
                  disabled={busy}
                  onClick={() => {
                    go("ride");
                    document.getElementById("demo")?.scrollIntoView();
                  }}
                >
                  <span className="row-icon">
                    <Flame />
                  </span>
                  <span>
                    <strong>До гор ещё далеко?</strong>
                    <small>Попробуй демо или импортируй GPX</small>
                  </span>
                  <ArrowUpRight size={21} />
                </button>
              </>
            )}
            {tab === "ride" && (
              <>
                <PageTitle
                  over="ЗАПИШИ СВОЮ ЛИНИЮ"
                  title="Катание"
                  text="Открой небо над собой. Остальное — за GPS."
                />
                <div className="notice">
                  <LocateFixed size={20} />
                  <span>
                    Запись работает при открытом Mini App. При блокировке
                    телефона или сворачивании Telegram координаты могут
                    перестать поступать.
                  </span>
                </div>
                <TrackMap points={current.points} />
                <MapLegend />
                <div className="record-card">
                  <div className="section-title">
                    <span className="eyebrow">
                      {rec.active
                        ? "● ЗАПИСЬ ИДЁТ"
                        : rec.draft
                          ? "ЗАПИСЬ НА УСТРОЙСТВЕ"
                          : "ГОТОВ К СТАРТУ"}
                    </span>
                    <span>{rec.draft?.points.length ?? 0} точек</span>
                  </div>
                  <div className="record-number">
                    {km(current.distance)}
                    <span> км</span>
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
                  <div className="button-stack">
                    {rec.active ? (
                      <button className="secondary" onClick={rec.pause}>
                        <Square size={17} /> Приостановить
                      </button>
                    ) : (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => rec.start(resort, rideTrip)}
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
              <>
                <PageTitle
                  over="КАЖДАЯ ЛИНИЯ ИМЕЕТ ЗНАЧЕНИЕ"
                  title="На карте"
                  text="Твои маршруты. Твой взгляд на горы."
                />
                <TrackMap points={rec.draft ? current.points : []} />
                {rec.draft && (
                  <p className="fine">
                    Незавершённая запись на этом устройстве
                  </p>
                )}
                <MapLegend />
                <section className="section">
                  <h2>Открыть сохранённый маршрут</h2>
                  {sessions.length ? (
                    sessions.map((s) => (
                      <SessionRow
                        key={s.id}
                        s={s}
                        onClick={() => details(s.id)}
                      />
                    ))
                  ) : (
                    <Empty
                      text="Маршрутов пока нет"
                      detail="Начни запись или импортируй GPX в разделе «Катание»."
                    />
                  )}
                </section>
                <p className="fine">
                  Карта: © OpenStreetMap contributors. Подробные трассы и
                  подъёмники отдельно не загружаются. Тайлы требуют интернета;
                  офлайн-карты не поддерживаются.
                </p>
              </>
            )}
            {tab === "history" && (
              <>
                <PageTitle
                  over="ПРОГРЕСС В КАЖДОЙ ЛИНИИ"
                  title="Твоя статистика"
                  text="Сравнивай себя с собой вчерашним."
                />
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
      <footer>
        ВСТРЕТИМСЯ НА СКЛОНЕ <Mountain size={15} />
      </footer>
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
function localDay(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function aggregate(s: Session[]) {
  const movingSeconds = s.reduce((n, x) => n + x.analysis.movingSeconds, 0),
    distance = s.reduce((n, x) => n + x.analysis.distance, 0),
    drops = s.map((x) => x.analysis.drop).filter((v): v is number => v != null);
  return {
    distance,
    movingSeconds,
    avgSpeed: movingSeconds ? distance / movingSeconds : 0,
    maxSpeed: Math.max(0, ...s.map((x) => x.analysis.maxSpeed)),
    duration: s.reduce((n, x) => n + x.analysis.duration, 0),
    days: new Set(s.map((x) => localDay(x.started_at))).size,
    runs: s.reduce((n, x) => n + x.analysis.runs.length, 0),
    descentDistance: s.reduce((n, x) => n + x.analysis.descentDistance, 0),
    drop: drops.length ? drops.reduce((a, b) => a + b, 0) : null,
  };
}
function longestDay(s: Session[]) {
  const days = new Map<string, number>();
  for (const v of s) {
    const k = localDay(v.started_at);
    days.set(k, (days.get(k) ?? 0) + v.analysis.movingSeconds);
  }
  return Math.max(0, ...days.values());
}
function Avatar({ me }: { me: Me }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="avatar">
      {me.user.photo_url && !failed ? (
        <img
          src={me.user.photo_url}
          alt="Аватар Telegram"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        me.user.first_name.slice(0, 1)
      )}
    </div>
  );
}
function PageTitle({
  over,
  title,
  text,
}: {
  over: string;
  title: string;
  text: string;
}) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{over}</span>
      <h1>{title}</h1>
      <p>{text}</p>
    </div>
  );
}
function Stat({
  icon,
  value,
  unit,
  label,
  big,
}: {
  icon: React.ReactNode;
  value: string;
  unit?: string;
  label: string;
  big?: boolean;
}) {
  return (
    <div className={`stat ${big ? "stat-featured" : ""}`}>
      <span className="stat-icon">{icon}</span>
      <div className="stat-value">
        {value}
        <small>{unit}</small>
      </div>
      <span className="stat-label">{label}</span>
    </div>
  );
}
function Metrics({ a }: { a: Analysis }) {
  return (
    <>
      <div className="stat-grid">
        <Stat
          icon={<Route />}
          value={km(a.distance)}
          unit="км"
          label="Общая дистанция"
        />
        <Stat
          icon={<Zap />}
          value={speed(a.maxSpeed)}
          unit="км/ч"
          label="Макс. скорость"
        />
        <Stat
          icon={<Timer />}
          value={duration(a.movingSeconds)}
          label="Время движения"
        />
        <Stat
          icon={<Flag />}
          value={String(a.runs.length)}
          label="Определено спусков"
        />
      </div>
      <div className="summary-lines">
        <div>
          <span>Средняя скорость движения</span>
          <b>{speed(a.avgSpeed)} км/ч</b>
        </div>
        <div>
          <span>Перепад на определённых спусках</span>
          <b>{a.drop == null ? "Не определено" : Math.round(a.drop) + " м"}</b>
        </div>
        <div>
          <span>Дистанция спусков</span>
          <b>{km(a.descentDistance)} км</b>
        </div>
      </div>
    </>
  );
}
function Empty({ text, detail }: { text: string; detail: string }) {
  return (
    <div className="empty">
      <Mountain size={32} />
      <h3>{text}</h3>
      <p>{detail}</p>
    </div>
  );
}
function SessionRow({ s, onClick }: { s: Session; onClick: () => void }) {
  return (
    <button className="session-row" onClick={onClick}>
      <span className="row-icon">
        <Mountain size={22} />
      </span>
      <span className="row-main">
        <strong>
          {s.resort || "Без названия курорта"}
          {s.source === "demo" && <em className="badge">ДЕМО</em>}
        </strong>
        <small>
          {date(s.started_at)} · {duration(s.analysis.movingSeconds)}
        </small>
        <small>
          {speed(s.analysis.maxSpeed)} км/ч макс. · {s.analysis.runs.length}{" "}
          спусков
        </small>
      </span>
      <span className="row-distance">
        {km(s.analysis.distance)}
        <small>км</small>
      </span>
      <ChevronRight size={17} />
    </button>
  );
}
function MapLegend() {
  return (
    <div className="map-legend">
      <span>
        <i style={{ background: "#6bdac4" }} />
        до 29 км/ч
      </span>
      <span>
        <i style={{ background: "#ddf870" }} />
        29–54
      </span>
      <span>
        <i style={{ background: "#ff8864" }} />
        54+
      </span>
      <span>
        <i style={{ background: "#95a1ad" }} />
        подъём
      </span>
    </div>
  );
}
function DayChart({ sessions }: { sessions: Session[] }) {
  const map = new Map<string, number>();
  for (const s of sessions) {
    const key = localDay(s.started_at);
    map.set(key, (map.get(key) ?? 0) + s.analysis.distance);
  }
  const bars = [...map].sort(([a], [b]) => a.localeCompare(b)).slice(-14);
  const max = Math.max(1, ...bars.map((b) => b[1]));
  return bars.length ? (
    <div
      className="chart"
      role="img"
      aria-label="Дистанция за последние 14 дней с записями"
    >
      {bars.map(([d, m]) => (
        <div key={d} className="chart-col">
          <span>{km(m)}</span>
          <div className="chart-bar-area">
            <i style={{ height: `${Math.max(2, (m / max) * 100)}%` }} />
          </div>
          <small>
            {d.slice(8)}.{d.slice(5, 7)}
          </small>
        </div>
      ))}
    </div>
  ) : (
    <Empty
      text="Пока без графика"
      detail="Он появится на основе сохранённых записей."
    />
  );
}
function ProfileForm({
  profile,
  busy,
  onSave,
}: {
  profile: Profile;
  busy: boolean;
  onSave: (p: Profile) => void;
}) {
  const [p, setP] = useState(profile),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    setP(profile);
    setSaved(true);
  }, [profile]);
  const field = (key: keyof Profile, val: string) => {
    setP({ ...p, [key]: val });
    setSaved(false);
  };
  return (
    <form
      className="profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(p);
      }}
    >
      <label>
        Никнейм
        <input
          value={p.nickname}
          maxLength={40}
          onChange={(e) => field("nickname", e.target.value)}
          placeholder="Как тебя зовут на склоне?"
        />
      </label>
      <div className="form-grid">
        <label>
          Спорт
          <select
            value={p.sport}
            onChange={(e) => field("sport", e.target.value)}
          >
            <option value="snowboard">Сноуборд</option>
            <option value="ski">Горные лыжи</option>
          </select>
        </label>
        <label>
          Уровень
          <select
            value={p.level}
            onChange={(e) => field("level", e.target.value)}
          >
            <option value="beginner">Новичок</option>
            <option value="intermediate">Средний</option>
            <option value="confident">Уверенный</option>
            <option value="expert">Эксперт</option>
          </select>
        </label>
      </div>
      <label>
        Дисциплина
        <select
          value={p.discipline}
          onChange={(e) => field("discipline", e.target.value)}
        >
          <option value="all">Универсальное катание</option>
          <option value="piste">Трассы</option>
          <option value="freeride">Фрирайд</option>
          <option value="park">Парк</option>
        </select>
      </label>
      <label>
        Любимый курорт
        <input
          value={p.resort}
          maxLength={100}
          onChange={(e) => field("resort", e.target.value)}
          placeholder="Место, куда хочется вернуться"
        />
      </label>
      <label>
        Экипировка · необязательно
        <textarea
          value={p.equipment}
          maxLength={200}
          onChange={(e) => field("equipment", e.target.value)}
          placeholder="Доска, крепления, ботинки…"
        />
      </label>
      <button className="primary" disabled={busy} type="submit">
        <Check size={18} />
        {saved ? "Профиль сохранён" : "Сохранить профиль"}
      </button>
    </form>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
