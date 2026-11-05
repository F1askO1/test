export function RiderMark({
  className = "",
  label = "SlopeMate",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <img
      className={`rider-mark ${className}`}
      src="/rider.svg"
      alt={label}
      draggable={false}
    />
  );
}
export function Splash({ exiting = false }: { exiting?: boolean }) {
  return (
    <div
      className={`splash ${exiting ? "is-leaving" : ""}`}
      role={exiting ? undefined : "status"}
      aria-hidden={exiting || undefined}
      aria-label={exiting ? undefined : "SlopeMate загружается"}
    >
      <div className="splash-icon-anchor">
        <RiderMark className="splash-icon" label="Сноубордист SlopeMate" />
      </div>
      <span className="splash-wordmark">SlopeMate</span>
    </div>
  );
}
export function LoadingScreen() {
  return (
    <main className="gate loading-state" aria-busy="true">
      <RiderMark />
      <h1>SlopeMate</h1>
      <p>Подключаем ваш профиль…</p>
      <div className="skeleton" />
      <span className="fine">
        Ваши записи останутся на устройстве при сбое сети.
      </span>
    </main>
  );
}
