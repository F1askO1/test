export type Point = {
  lat: number;
  lon: number;
  t: number;
  alt?: number | null;
  accuracy?: number | null;
  altAccuracy?: number | null;
  speed?: number | null;
  breakBefore?: boolean;
};
export type Kind = "descent" | "ascent" | "stop" | "unknown";
export type Edge = {
  from: number;
  to: number;
  kind: Kind;
  distance: number;
  seconds: number;
  speed: number;
  drop: number | null;
};
export type Run = {
  start: number;
  end: number;
  distance: number;
  seconds: number;
  drop: number | null;
};
export type Analysis = {
  points: Point[];
  edges: Edge[];
  runs: Run[];
  distance: number;
  descentDistance: number;
  maxSpeed: number;
  avgSpeed: number;
  movingSeconds: number;
  duration: number;
  drop: number | null;
  rejected: number;
  gaps: number;
};
export const trackConfig = {
  maxAccuracy: 65,
  maxSpeed: 45,
  maxGapSeconds: 35,
  minMovingSpeed: 0.8,
  altAccuracy: 20,
  minVerticalRate: 0.12,
  minRunDistance: 50,
  minRunSeconds: 15,
};
export function distance(a: Point, b: Point) {
  const r = Math.PI / 180,
    dlat = (b.lat - a.lat) * r,
    dlon = (b.lon - a.lon) * r;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
const valid = (p: Point) =>
  Number.isFinite(p.lat) &&
  Math.abs(p.lat) <= 90 &&
  Number.isFinite(p.lon) &&
  Math.abs(p.lon) <= 180 &&
  Number.isFinite(p.t) &&
  p.t > 0;
export function analyze(input: Point[]): Analysis {
  const points: Point[] = [],
    edges: Edge[] = [];
  let rejected = 0,
    gaps = 0,
    pendingBreak = false;
  for (const source of input) {
    const p = { ...source };
    if (
      !valid(p) ||
      (p.accuracy != null &&
        (!Number.isFinite(p.accuracy) ||
          p.accuracy < 0 ||
          p.accuracy > trackConfig.maxAccuracy))
    ) {
      rejected++;
      pendingBreak = true;
      continue;
    }
    if (p.alt != null && !Number.isFinite(p.alt)) p.alt = null;
    const prev = points.at(-1);
    if (prev) {
      const dt = (p.t - prev.t) / 1000,
        d = distance(prev, p);
      if (dt <= 0) {
        rejected++;
        continue;
      }
      if (dt <= trackConfig.maxGapSeconds && d / dt > trackConfig.maxSpeed) {
        rejected++;
        pendingBreak = true;
        continue;
      }
    }
    if (pendingBreak) p.breakBefore = true;
    pendingBreak = false;
    points.push(p);
  }
  let total = 0,
    descent = 0,
    max = 0,
    moving = 0,
    drop = 0,
    hasDrop = false;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dt = (b.t - a.t) / 1000,
      d = distance(a, b);
    if (dt > trackConfig.maxGapSeconds || b.breakBefore) {
      gaps++;
      edges.push({
        from: i - 1,
        to: i,
        kind: "unknown",
        distance: 0,
        seconds: 0,
        speed: 0,
        drop: null,
      });
      continue;
    }
    // Conservative deadband: movement smaller than reported error is not counted.
    const noise = Math.max(
      3,
      Math.min(18, ((a.accuracy ?? 0) + (b.accuracy ?? 0)) * 0.35),
    );
    const speed = d / dt;
    const stopped = d < noise || speed < trackConfig.minMovingSpeed;
    // GPS altitude is used only when both vertical accuracies are explicitly reliable.
    const altitudeOK =
      a.alt != null &&
      b.alt != null &&
      a.altAccuracy != null &&
      b.altAccuracy != null &&
      a.altAccuracy <= trackConfig.altAccuracy &&
      b.altAccuracy <= trackConfig.altAccuracy;
    const dh = altitudeOK ? b.alt! - a.alt! : null;
    const verticalThreshold = Math.max(
      3,
      ((a.altAccuracy ?? 0) + (b.altAccuracy ?? 0)) * 0.25,
    );
    let kind: Kind = stopped ? "stop" : "unknown";
    if (
      !stopped &&
      dh != null &&
      Math.abs(dh) >= verticalThreshold &&
      Math.abs(dh) / dt >= trackConfig.minVerticalRate
    )
      kind = dh < 0 ? "descent" : "ascent";
    const meters = stopped ? 0 : d;
    const loss = kind === "descent" ? -dh! : null;
    edges.push({
      from: i - 1,
      to: i,
      kind,
      distance: meters,
      seconds: dt,
      speed: stopped ? 0 : speed,
      drop: loss,
    });
    total += meters;
    if (!stopped) {
      moving += dt;
      max = Math.max(max, speed);
    }
    if (kind === "descent") {
      descent += meters;
      drop += loss!;
      hasDrop = true;
    }
  }
  const runs: Run[] = [];
  let run: Run | undefined;
  const flush = () => {
    if (
      run &&
      run.distance >= trackConfig.minRunDistance &&
      run.seconds >= trackConfig.minRunSeconds
    )
      runs.push(run);
    run = undefined;
  };
  for (const e of edges) {
    if (e.kind === "descent") {
      if (!run)
        run = { start: e.from, end: e.to, distance: 0, seconds: 0, drop: 0 };
      run.end = e.to;
      run.distance += e.distance;
      run.seconds += e.seconds;
      run.drop! += e.drop ?? 0;
    } else flush();
  }
  flush();
  return {
    points,
    edges,
    runs,
    distance: total,
    descentDistance: descent,
    maxSpeed: max,
    avgSpeed: moving ? total / moving : 0,
    movingSeconds: moving,
    duration: points.length > 1 ? (points.at(-1)!.t - points[0].t) / 1000 : 0,
    drop: hasDrop ? drop : null,
    rejected,
    gaps,
  };
}
