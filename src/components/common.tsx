/** Shared accessible controls and locale-aware application context. */
import {
  createContext,
  useContext,
  useRef,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { X, LoaderCircle } from "lucide-react";
import { createPortal } from "react-dom";
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
  onConfirm,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  onConfirm?: () => void;
  className?: string;
}) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!section.current?.contains(document.activeElement))
      section.current
        ?.querySelector<HTMLElement>("[data-confirm],input,textarea,button")
        ?.focus();
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        if (e.key === "Tab") {
          e.stopPropagation();
          const nodes = [
            ...(section.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
            ) ?? []),
          ].filter((node) => node.getClientRects().length);
          const index = nodes.indexOf(document.activeElement as HTMLElement);
          if (e.shiftKey && index <= 0) {
            e.preventDefault();
            nodes.at(-1)?.focus();
          } else if (!e.shiftKey && (index < 0 || index === nodes.length - 1)) {
            e.preventDefault();
            nodes[0]?.focus();
          }
        }
      }}
    >
      <section
        onKeyDownCapture={(e) => {
          if (!onConfirm || e.key !== "Enter") return;
          if (
            e.nativeEvent.isComposing ||
            e.nativeEvent.keyCode === 229 ||
            e.repeat ||
            e.altKey ||
            e.ctrlKey ||
            e.metaKey ||
            e.shiftKey
          ) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          const target = e.target as HTMLElement;
          if (target.closest("input,textarea,select,[contenteditable=true]"))
            return;
          const button = target.closest("button");
          if (button && !button.hasAttribute("data-confirm")) return;
          e.preventDefault();
          e.stopPropagation();
          onConfirm();
        }}
        ref={section}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={"modal " + (wide ? "wide " : "") + className}
      >
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            className="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
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
