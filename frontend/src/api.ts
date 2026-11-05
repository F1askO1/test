import type { Analysis } from "../../shared/track";
export type Profile = {
  nickname: string;
  sport: string;
  level: string;
  discipline: string;
  resort: string;
  equipment: string;
};
export type Me = {
  user: {
    id: number;
    first_name: string;
    username?: string;
    photo_url?: string;
  };
  profile: Profile;
  dev: boolean;
};
export type Session = {
  id: string;
  source: "gps" | "gpx" | "demo";
  resort: string;
  trip: string;
  started_at: number;
  analysis: Analysis;
};
export type TelegramApp = {
  initData: string;
  onEvent?: (event: string, callback: () => void) => void;
  offEvent?: (event: string, callback: () => void) => void;
  isVersionAtLeast?: (version: string) => boolean;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  HapticFeedback?: { impactOccurred: (style: string) => void };
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  LocationManager?: {
    isInited: boolean;
    isLocationAvailable: boolean;
    init: (cb: () => void) => void;
    getLocation: (
      cb: (
        location: {
          latitude: number;
          longitude: number;
          altitude: number | null;
          horizontal_accuracy: number | null;
          vertical_accuracy: number | null;
          speed: number | null;
        } | null,
      ) => void,
    ) => void;
  };
  safeAreaInset?: { top: number; bottom: number };
  contentSafeAreaInset?: { top: number; bottom: number };
};
declare global {
  interface Window {
    Telegram?: { WebApp: TelegramApp };
  }
}
export const tg = window.Telegram?.WebApp;
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set(
    "Authorization",
    tg?.initData ? `tma ${tg.initData}` : "Dev local",
  );
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error(
      "Нет связи с сервером. Данные записи остаются на устройстве.",
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Ошибка сервера (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const km = (m: number) =>
  (m / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
export const speed = (m: number) => (m * 3.6).toFixed(1);
export const duration = (s: number) =>
  `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(Math.floor(s) % 60).padStart(2, "0")}`;
export const date = (t: number) =>
  new Date(t).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
