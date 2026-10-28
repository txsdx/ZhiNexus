/** Compact back/forward controls use the same trail as keyboard and mouse-side buttons. */
import { useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { navigationHistory } from "../services/navigation";
import { useT } from "./common";
/** Render available destinations without coupling history to browser URLs. */
export function NavigationButtons() {
  const state = useSyncExternalStore(
      navigationHistory.subscribe,
      navigationHistory.getSnapshot,
    ),
    t = useT();
  return (
    <div className="navigation-buttons">
      <button
        className="icon"
        aria-label={t("后退", "Back")}
        title="Alt+←"
        disabled={!state.canBack}
        onClick={() => void navigationHistory.go(-1)}
      >
        <ArrowLeft size={17} />
      </button>
      <button
        className="icon"
        aria-label={t("前进", "Forward")}
        title="Alt+→"
        disabled={!state.canForward}
        onClick={() => void navigationHistory.go(1)}
      >
        <ArrowRight size={17} />
      </button>
    </div>
  );
}
