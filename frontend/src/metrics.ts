import type { Session } from "./api";
export function localDay(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function aggregate(s: Session[]) {
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
export function longestDay(s: Session[]) {
  const days = new Map<string, number>();
  for (const v of s) {
    const k = localDay(v.started_at);
    days.set(k, (days.get(k) ?? 0) + v.analysis.movingSeconds);
  }
  return Math.max(0, ...days.values());
}
