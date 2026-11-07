import { loadDraft, persistDraft } from "./recorder-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { tg } from "./api";
import type { Point } from "../../shared/track";
export type Draft = {
  id: string;
  points: Point[];
  started: number;
  resort: string;
  trip: string;
};
export function useRecorder(userId: number) {
  const key = `slopemate:draft:${userId}`;
  const [draft, setDraft] = useState<Draft | null>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return typeof d.id === "string" && Array.isArray(d.points) ? d : null;
    } catch {
      return null;
    }
  });
  const [active, setActive] = useState(false),
    [notice, setNotice] = useState(""),
    [now, setNow] = useState(Date.now()),
    [provider, setProvider] = useState<"browser" | "telegram">("browser");
  const [ready, setReady] = useState(false);
  const writes = useRef(Promise.resolve());
  const activeRef = useRef(false),
    lastFix = useRef(0),
    gap = useRef(false),
    draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    let cancelled = false;
    void loadDraft(key)
      .then(async (saved) => {
        if (cancelled) return;
        if (saved) {
          draftRef.current = saved;
          setDraft(saved);
        } else if (draftRef.current) {
          await persistDraft(key, draftRef.current);
        }
      })
      .catch(() =>
        setNotice(
          "IndexedDB недоступна. Локальное резервное хранилище ограничено; синхронизируйте запись до закрытия.",
        ),
      )
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  const update = useCallback(
    (d: Draft | null, append?: Point) => {
      draftRef.current = d;
      setDraft(d);
      writes.current = writes.current
        .then(async () => {
          await persistDraft(key, d, append);
          // Only shrink the legacy backup AFTER a durable IndexedDB commit.
          try {
            d
              ? localStorage.setItem(
                  key,
                  JSON.stringify({ ...d, points: d.points.slice(0, 128) }),
                )
              : localStorage.removeItem(key);
          } catch {}
        })
        .catch(() => {
          // Preserve an existing full legacy draft when migration or storage fails.
          try {
            if (!localStorage.getItem(key) && d)
              localStorage.setItem(key, JSON.stringify(d));
          } catch {}
          setNotice(
            "Не удалось сохранить точки в IndexedDB. Не закрывайте приложение; завершите и синхронизируйте запись.",
          );
        });
    },
    [key],
  );
  const add = useCallback(
    (p: Point) => {
      if (!activeRef.current || !draftRef.current) return;
      lastFix.current = Date.now();
      if (p.accuracy != null && p.accuracy > 65) {
        setNotice(
          `Низкая точность GPS: ±${Math.round(p.accuracy)} м. Эти точки не войдут в расчёты.`,
        );
      } else setNotice("");
      const points = draftRef.current.points;
      if (points.length >= 40000) {
        activeRef.current = false;
        setActive(false);
        setNotice(
          "Достигнут лимит 40 000 точек. Сохраните запись и начните новую.",
        );
        return;
      }
      if (p.t <= (points.at(-1)?.t ?? 0)) return;
      p.breakBefore =
        gap.current || Boolean(points.at(-1) && p.t - points.at(-1)!.t > 25000);
      gap.current = false;
      update({ ...draftRef.current, points: [...points, p] }, p);
    },
    [update],
  );
  const pause = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    gap.current = true;
  }, []);
  const start = useCallback(
    (resort: string, trip: string) => {
      if (!ready) return;
      if (!draftRef.current)
        update({
          id: crypto.randomUUID(),
          started: Date.now(),
          points: [],
          resort,
          trip,
        });
      gap.current = true;
      lastFix.current = Date.now();
      activeRef.current = true;
      setActive(true);
      tg?.HapticFeedback?.impactOccurred("medium");
    },
    [update, ready],
  );
  useEffect(() => {
    if (!active) return;
    tg?.enableClosingConfirmation?.();
    let watch: number | undefined,
      timer: ReturnType<typeof setInterval> | undefined,
      cancelled = false,
      inflight = false;
    const error = (msg: string) => {
      setNotice(msg);
      gap.current = true;
    };
    try {
      if (provider === "browser") {
        if (!navigator.geolocation) {
          error(
            "Браузер не поддерживает GPS. Попробуйте Telegram LocationManager.",
          );
          pause();
        } else
          watch = navigator.geolocation.watchPosition(
            (p) =>
              add({
                lat: p.coords.latitude,
                lon: p.coords.longitude,
                t: p.timestamp,
                alt: p.coords.altitude,
                accuracy: p.coords.accuracy,
                altAccuracy: p.coords.altitudeAccuracy,
                speed: p.coords.speed,
                heading: p.coords.heading,
              }),
            (e) => {
              error(
                e.code === 1
                  ? "Доступ к геолокации запрещён. Разрешите его в настройках телефона."
                  : e.code === 2
                    ? "GPS недоступен. Выйдите на открытое место."
                    : "GPS не ответил вовремя. Ожидаем новый сигнал.",
              );
              if (e.code === 1) pause();
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
          );
      } else {
        const lm = tg?.LocationManager;
        if (!lm || (tg?.isVersionAtLeast && !tg.isVersionAtLeast("8.0"))) {
          error(
            "Telegram LocationManager недоступен в этой версии. Выберите GPS браузера.",
          );
          pause();
        } else {
          const poll = () => {
            if (cancelled || inflight) return;
            inflight = true;
            try {
              lm.getLocation((p) => {
                inflight = false;
                if (cancelled) return;
                if (!p) {
                  error(
                    "Telegram не предоставил местоположение. Проверьте разрешения.",
                  );
                  return;
                }
                add({
                  lat: p.latitude,
                  lon: p.longitude,
                  t: Date.now(),
                  alt: p.altitude,
                  accuracy: p.horizontal_accuracy,
                  altAccuracy: p.vertical_accuracy,
                  speed: p.speed,
                });
              });
            } catch {
              inflight = false;
              error(
                "Telegram не смог запросить GPS. Выберите GPS браузера или обновите Telegram.",
              );
              pause();
            }
          };
          lm.init(() => {
            if (cancelled) return;
            if (!lm.isLocationAvailable) {
              error("Геолокация Telegram недоступна на устройстве.");
              pause();
              return;
            }
            poll();
            timer = setInterval(poll, 5000);
          });
        }
      }
    } catch {
      error(
        "Источник GPS недоступен. Проверьте разрешения, HTTPS и версию Telegram.",
      );
      pause();
    }
    const visibility = () => {
      gap.current = true;
      if (document.hidden)
        setNotice(
          "Приложение скрыто. Непрерывная запись не гарантируется; разрыв не будет соединён.",
        );
      else setNotice("Приложение снова открыто. Ожидаем свежую GPS-точку.");
    };
    const before = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", visibility);
    window.addEventListener("beforeunload", before);
    const clock = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - lastFix.current > 25000)
        error(
          "Нет свежих координат более 25 секунд. Проверьте GPS и держите приложение открытым.",
        );
    }, 1000);
    return () => {
      cancelled = true;
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
      if (timer) clearInterval(timer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", visibility);
      window.removeEventListener("beforeunload", before);
      tg?.disableClosingConfirmation?.();
    };
  }, [active, provider, add, pause]);
  useEffect(
    () => () => {
      activeRef.current = false;
    },
    [],
  );
  return {
    draft,
    ready,
    active,
    notice,
    now,
    provider,
    setProvider,
    start,
    pause,
    clear: () => {
      pause();
      update(null);
    },
    setNotice,
  };
}
