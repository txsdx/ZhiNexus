/** Shared accessible controls and locale-aware application context. */
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { X, LoaderCircle } from "lucide-react";
import { store } from "../core/store";
export const Locale = createContext<"zh" | "en">("zh");
/** Select an interface translation without global mutable language state. */
export function useT() {
  const locale = useContext(Locale);
  return (zh: string, en: string) => (locale === "zh" ? zh : en);
}
/** Subscribe to the same committed SQLite projection across all views. */
export function useKnowledge() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
/** Display a labeled modal with explicit close and keyboard dismissal. */
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide" : "")}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
/** Convey pending operations in both visual and accessible UI. */
export function Busy({ label }: { label: string }) {
  return (
    <span className="busy" role="status">
      <LoaderCircle size={16} />
      {label}
    </span>
  );
}
/** Render an explanatory empty state with an optional primary action. */
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">✦</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
