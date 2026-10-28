/** Compact route-independent update readiness indicator. */
import { useSyncExternalStore } from "react";
import { Download } from "lucide-react";
import { autoUpdates } from "../services/auto-updates";
import { useT } from "./common";
/** Keep installation available without automatic modal interruptions. */
export function UpdateStatus({ onOpen }: { onOpen: () => void }) {
  const state = useSyncExternalStore(
      autoUpdates.subscribe,
      autoUpdates.getSnapshot,
    ),
    t = useT();
  if (state.phase !== "ready") return null;
  return (
    <button
      className="ai-queue-button update-ready"
      onClick={onOpen}
      aria-label={t("查看已就绪的更新", "View ready update")}
      title={state.update?.version}
    >
      <Download size={17} />
      <span>{t("更新已就绪", "Update ready")}</span>
    </button>
  );
}
