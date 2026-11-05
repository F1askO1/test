import { useEffect, useState } from "react";
import { api } from "../api";
type Device = { id: string; created_at: number; revoked: number };
export function NativeRecorderPanel() {
  const [devices, setDevices] = useState<Device[]>([]),
    [link, setLink] = useState(""),
    [message, setMessage] = useState("");
  const reload = () => api<Device[]>("/recorder/devices").then(setDevices);
  useEffect(() => {
    void reload().catch(() => {});
  }, []);
  return (
    <section className="section">
      <h2>Запись с заблокированным iPhone</h2>
      <p className="fine">
        Telegram Mini App не гарантирует GPS в фоне. Для этого подготовлен
        отдельный iOS-рекордер. Он требует установки через Xcode на Mac;
        физические испытания ещё не пройдены.
      </p>
      <button
        className="secondary"
        onClick={async () => {
          try {
            if (location.protocol !== "https:")
              throw Error("Для привязки нужен публичный HTTPS.");
            const p = await api<{ code: string; expires: number }>(
              "/recorder/pair",
              { method: "POST" },
            );
            setLink(
              `slopemate-recorder://pair?server=${encodeURIComponent(location.origin)}&code=${encodeURIComponent(p.code)}`,
            );
            setMessage(
              "Код действует 5 минут, однократно. Откройте ссылку только после установки рекордера.",
            );
          } catch (e) {
            setMessage((e as Error).message);
          }
        }}
      >
        Привязать установленный iOS-рекордер
      </button>
      {link && (
        <a className="primary" href={link}>
          Открыть рекордер для привязки
        </a>
      )}
      {message && <p role="status">{message}</p>}
      {devices
        .filter((d) => !d.revoked)
        .map((d) => (
          <div className="summary-lines" key={d.id}>
            <span>
              Рекордер · {new Date(d.created_at).toLocaleDateString("ru")}
            </span>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await api("/recorder/devices/" + d.id, { method: "DELETE" });
                  await reload();
                } catch {
                  setMessage(
                    "Не удалось отозвать доступ. Повторите при наличии сети.",
                  );
                }
              }}
            >
              Отозвать доступ
            </button>
          </div>
        ))}
    </section>
  );
}
