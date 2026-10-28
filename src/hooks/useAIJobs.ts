/** Lightweight queue subscription; reviewing/applying UI loads only when needed. */
import { useSyncExternalStore } from "react";
import { aiJobs } from "../services/ai-jobs";
/** Observe the persistent queue without importing editor codecs or MCP workflows. */
export function useAIJobs() {
  return useSyncExternalStore(aiJobs.subscribe, aiJobs.getSnapshot);
}
