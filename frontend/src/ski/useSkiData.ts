import { useEffect, useState, useCallback } from "react";
import { api } from "../api";
import type { SkiCatalog, SkiBundle } from "../../../shared/ski";
export function useSkiData() {
  const [catalog, setCatalog] = useState<SkiCatalog | null>(null),
    [bundle, setBundle] = useState<SkiBundle | null>(null),
    [error, setError] = useState(""),
    [id, setId] = useState(() => {
      try {
        return localStorage.getItem("slopemate:resort") || "";
      } catch {
        return "";
      }
    });
  useEffect(() => {
    let live = true;
    api<SkiCatalog>("/ski/catalog")
      .then((c) => {
        if (live) setCatalog(c);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setBundle(null);
    if (!id) return;
    setError("");
    api<SkiBundle>("/ski/resorts/" + encodeURIComponent(id))
      .then((b) => {
        if (live) setBundle(b);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id]);
  const select = useCallback((value: string) => {
    setId(value);
    try {
      localStorage.setItem("slopemate:resort", value);
    } catch {}
  }, []);
  return { catalog, bundle, error, select, id };
}
export type SkiData = ReturnType<typeof useSkiData>;
