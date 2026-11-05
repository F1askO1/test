import { writeFileSync, mkdirSync } from "node:fs";
import { analyze } from "../shared/track.js";
import { demoTrack } from "../shared/demo.js";
import { matchLift, type SkiLine } from "../shared/ski.js";
const points = demoTrack();
const result = analyze(points);
const labels = ["descent", "ascent"] as const;
const metrics = Object.fromEntries(
  labels.map((label) => {
    let tp = 0,
      fp = 0,
      fn = 0;
    for (const e of result.edges) {
      const expected = e.to < 60 || e.to >= 120 ? "descent" : "ascent";
      if (e.kind === label && expected === label) tp++;
      if (e.kind === label && expected !== label) fp++;
      if (e.kind !== label && expected === label) fn++;
    }
    const precision = tp / (tp + fp || 1),
      recall = tp / (tp + fn || 1);
    return [
      label,
      {
        tp,
        fp,
        fn,
        precision,
        recall,
        F1: (2 * precision * recall) / (precision + recall || 1),
      },
    ];
  }),
);
const lift: SkiLine = {
  id: "synthetic",
  name: "Synthetic only",
  kind: "lift",
  difficulty: null,
  coordinates: [
    [40, 43],
    [40, 43.01],
  ],
  direction: 1,
  source: "synthetic",
  stations: [],
};
const positions = Array.from({ length: 15 }, (_, i) => ({
  lat: 43 + i * 0.0001,
  lon: 40,
  t: 1700000000000 + i * 5000,
  alt: 1000 + i * 3,
  accuracy: 4,
  altAccuracy: 2,
}));
const match = matchLift(positions, [lift]);
const measuredSpeed = (111194.9266 * 0.0001) / 5;
const expectedEta = match ? match.remaining / measuredSpeed : null;
const report = {
  type: "SYNTHETIC ONLY — not field accuracy",
  samples: 1,
  runCount: result.runs.length,
  edgeMetrics: metrics,
  eta: {
    predicted: match?.etaSeconds ?? null,
    groundTruth: expectedEta,
    absoluteError:
      expectedEta != null && match?.etaSeconds != null
        ? Math.abs(match.etaSeconds - expectedEta)
        : null,
  },
  limitations:
    "Ideal polyline/altitude generated mathematically; shared assumptions make ETA error artificially small. No real precision/recall or iPhone energy measurement.",
};
mkdirSync("artifacts/gps-v2", { recursive: true });
writeFileSync(
  "artifacts/gps-v2/synthetic-evaluation.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
