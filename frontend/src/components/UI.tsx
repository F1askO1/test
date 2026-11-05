import { localDay } from "../metrics";
import React, { useState, useEffect } from "react";
import {
  Mountain,
  Route,
  Zap,
  Timer,
  Flag,
  Check,
  ChevronRight,
} from "lucide-react";
import {
  km,
  speed,
  duration,
  date,
  type Me,
  type Session,
  type Profile,
} from "../api";
import type { Analysis } from "../../../shared/track";
export function Avatar({ me }: { me: Me }) {
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
export function PageTitle({
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
export function Stat({
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
export function Metrics({ a }: { a: Analysis }) {
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
      {a.engineVersion === 2 && (
        <div className="summary-lines">
          <div>
            Дистанция спусков<strong>{km(a.descentDistance)} км</strong>
          </div>
          <div>
            Подтверждённые подъёмники
            <strong>
              {a.liftDistance
                ? `${km(a.liftDistance)} км · ${duration(a.liftSeconds ?? 0)}`
                : "Не определены"}
            </strong>
          </div>
        </div>
      )}
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
export function Empty({ text, detail }: { text: string; detail: string }) {
  return (
    <div className="empty">
      <Mountain size={32} />
      <h3>{text}</h3>
      <p>{detail}</p>
    </div>
  );
}
export function SessionRow({
  s,
  onClick,
}: {
  s: Session;
  onClick: () => void;
}) {
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
export function MapLegend() {
  return (
    <p className="fine">
      Фиолетовый — ваш трек · пунктир — подъёмник · неизвестная сложность —
      серая
    </p>
  );
}
export function DayChart({ sessions }: { sessions: Session[] }) {
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
export function ProfileForm({
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
