import { useState } from "react";
import type { LiftMatch } from "../../../shared/ski";
const labels = {
  candidate: "Предположительно подъёмник",
  moving: "Подъём подтверждён",
  stopped: "Подъёмник остановился",
  arriving: "Приближаемся к станции",
  completed: "У станции",
};
export function LiftCard({ match }: { match: LiftMatch | null }) {
  const [hidden, setHidden] = useState("");
  if (!match || hidden === match.id) return null;
  return (
    <aside className="lift-card">
      <button
        className="text-button"
        onClick={() => setHidden(match.id)}
        aria-label="Скрыть карточку подъёмника"
      >
        Скрыть
      </button>
      <span className="eyebrow">↗ {labels[match.state]}</span>
      <h3>{match.name}</h3>
      <div>
        <strong>{Math.round(match.remaining)} м</strong>
        <span>до следующей известной станции</span>
        <strong>
          {match.etaSeconds == null
            ? "Оцениваем время"
            : `~${Math.max(1, Math.round(match.etaSeconds / 60))} мин`}
        </strong>
        <span>экспериментальный прогноз</span>
      </div>
      <progress value={match.progress} max={1} />
      <small>Оценка по GPS и OSM, не навигатор безопасности.</small>
    </aside>
  );
}
