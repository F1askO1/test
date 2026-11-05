import type { Point } from "./track.js";
export const demoNames = [
  "Утренний вельвет · учебный трек",
  "Длинная дуга · учебный трек",
  "Лесная линия · учебный трек",
];
export function demoTrack(index = 0): Point[] {
  const points: Point[] = [];
  const start = Date.UTC(2026, 0, 15 + index, 8);
  let lat = 43.66 + index * 0.012,
    lon = 40.25,
    alt = 2250;
  for (let i = 0; i < 181; i++) {
    const phase = Math.floor(i / 60);
    if (phase === 0 || phase === 2) {
      lat -= 0.00036;
      lon += Math.sin(i / 8) * 0.0002;
      alt -= 5;
    } else {
      lat += 0.00036;
      lon -= 0.000015;
      alt += 5;
    }
    points.push({
      lat,
      lon,
      t: start + i * 5000,
      alt,
      accuracy: 4,
      altAccuracy: 3,
    });
  }
  return points;
}
