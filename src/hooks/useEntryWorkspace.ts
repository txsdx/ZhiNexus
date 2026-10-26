/** React bridge for the device-local tab/draft repository, with flush on backgrounding. */
import { useEffect, useSyncExternalStore } from "react";
import { entryWorkspace } from "../core/workspace";
import { useKnowledge } from "../components/common";
/** Restore context once and request immediate durability when the application goes to the background. */
export function useEntryWorkspace() {
  const { ready } = useKnowledge(),
    state = useSyncExternalStore(
      entryWorkspace.subscribe,
      entryWorkspace.getSnapshot,
    );
  useEffect(() => {
    if (ready) void entryWorkspace.init();
  }, [ready]);
  useEffect(() => {
    const save = () => {
      if (
        document.visibilityState === "hidden" &&
        entryWorkspace.getSnapshot().pending
      )
        void entryWorkspace.flush().catch(() => {});
    };
    document.addEventListener("visibilitychange", save);
    return () => document.removeEventListener("visibilitychange", save);
  }, []);
  return { ...state, controller: entryWorkspace };
}
