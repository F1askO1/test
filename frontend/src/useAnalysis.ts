import { useEffect, useRef, useState } from "react";
import { analyze, type Point, type Analysis } from "../../shared/track";
import type { SkiLine } from "../../shared/ski";
export function useAnalysis(points: Point[], lines: SkiLine[] = []) {
  const [analysis, setAnalysis] = useState<Analysis>(() => analyze([]));
  const seq = useRef(0),
    worker = useRef<Worker | null>(null),
    busy = useRef(false),
    pending = useRef<{ id: number; points: Point[]; lines: SkiLine[] } | null>(
      null,
    );
  useEffect(() => {
    const w = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (e) => {
      busy.current = false;
      if (e.data.id === seq.current) setAnalysis(e.data.result);
      if (pending.current) {
        busy.current = true;
        w.postMessage(pending.current);
        pending.current = null;
      }
    };
    w.onerror = () => {
      busy.current = false;
    };
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    const id = ++seq.current;
    if (!points.length) {
      setAnalysis(analyze([]));
      pending.current = null;
      return;
    }
    const job = { id, points, lines };
    if (busy.current) pending.current = job;
    else if (worker.current) {
      busy.current = true;
      worker.current.postMessage(job);
    }
  }, [points, lines]);
  return analysis;
}
