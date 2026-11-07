import { Play, ArrowUpRight, Timer, Route, Zap, Flag } from "lucide-react";
import { km, speed, duration, type Me, type Session } from "../api";
import { Avatar, Stat, SessionRow, Empty } from "../components/UI";
export type SeasonSummary = {
  distance: number;
  maxSpeed: number;
  runs: number;
  days: number;
  movingSeconds: number;
  drop: number | null;
};
export function Home({
  me,
  summary,
  count,
  latest,
  hasDraft,
  onRide,
  onHistory,
  onProgress,
  onDetails,
}: {
  me: Me;
  summary: SeasonSummary;
  count: number;
  latest?: Session;
  hasDraft: boolean;
  onRide: () => void;
  onHistory: () => void;
  onProgress: () => void;
  onDetails: (id: string) => void;
}) {
  return (
    <>
      <div className="greeting">
        <div>
          <span className="eyebrow">ХОРОШИЙ ДЕНЬ ДЛЯ КАТАНИЯ</span>
          <h1>
            Привет, {me.profile.nickname || me.user.first_name}
            <span className="accent">.</span>
          </h1>
        </div>
        <Avatar me={me} />
      </div>
      <section className="season-overview">
        <div className="section-title">
          <span className="eyebrow">ТВОЙ СЕЗОН</span>
          <span>{count} катаний</span>
        </div>
        <div className="distance-hero">
          {km(summary.distance)}
          <span>км</span>
        </div>
        <p>Каждая линия имеет значение.</p>
        <div className="season-inline">
          <span>
            <Timer size={16} />
            {duration(summary.movingSeconds)} на склоне
          </span>
          <span>{summary.days} дней катания</span>
        </div>
      </section>
      <button className="primary home-cta" onClick={onRide}>
        <Play size={19} fill="currentColor" />
        {hasDraft ? "Продолжить катание" : "Начать катание"}
        <ArrowUpRight size={20} />
      </button>
      <p className="cta-caption">GPS-запись при открытом приложении</p>
      <section className="section">
        <div className="section-title">
          <h2>Рекорды сезона</h2>
          <button className="text-button" onClick={onProgress}>
            Прогресс <ArrowUpRight size={16} />
          </button>
        </div>
        <div className="stat-grid compact-stats">
          <Stat
            icon={<Zap />}
            value={speed(summary.maxSpeed)}
            unit="км/ч"
            label="Максимальная скорость"
          />
          <Stat
            icon={<Flag />}
            value={String(summary.runs)}
            label="Определено спусков"
          />
        </div>
        <div className="vertical-row">
          <span>Перепад на точных участках</span>
          <strong>
            {summary.drop == null
              ? "Нет точных высот"
              : `${Math.round(summary.drop)} м`}
          </strong>
        </div>
      </section>
      <section className="section">
        <div className="section-title">
          <h2>Последнее катание</h2>
          <button className="text-button" onClick={onHistory}>
            История <ArrowUpRight size={16} />
          </button>
        </div>
        {latest ? (
          <SessionRow s={latest} onClick={() => onDetails(latest.id)} />
        ) : (
          <Empty
            text="История начинается с тебя"
            detail="Первая линия появится после записи. А пока можно познакомиться с приложением на демо-треке."
          />
        )}
      </section>
      <button className="demo-banner" onClick={onRide}>
        <span className="row-icon">
          <Route size={21} />
        </span>
        <span>
          <strong>До гор ещё далеко?</strong>
          <small>Демо-маршруты и импорт GPX</small>
        </span>
        <ArrowUpRight size={20} />
      </button>
    </>
  );
}
