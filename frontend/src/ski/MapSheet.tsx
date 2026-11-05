import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function MapSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const dialog = ref.current!,
      opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      opener?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="map-sheet"
      aria-labelledby={id}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const b = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < b.left ||
          e.clientX > b.right ||
          e.clientY < b.top ||
          e.clientY > b.bottom
        )
          onClose();
      }}
    >
      <div className="map-sheet-handle" />
      <header>
        <h2 id={id}>{title}</h2>
        <button onClick={onClose} aria-label={`Закрыть: ${title}`}>
          <X size={20} />
        </button>
      </header>
      <div className="map-sheet-body">{children}</div>
    </dialog>
  );
}
