/** Capture enrichment is queued as one reviewable proposal; raw material remains unchanged. */
import { store } from "../core/store";
import { resolveModel } from "../core/ai-config";
import { flushAISettings } from "./settings";
import { submitAIJob } from "./ai-jobs";
/** Persist the original note first, then generate an unapplied proposal in the global queue. */
export async function enrichEntry(id: string): Promise<void> {
  await flushAISettings();
  const s = store.getSnapshot();
  if (!s.device.apiKey || !s.entries.some((e) => e.id === id)) return;
  if (
    !["explain", "relations", "classify"].some((task) =>
      resolveModel(s.ai, task as "explain" | "relations" | "classify"),
    )
  )
    return;
  await submitAIJob("enrichment", { page: "entry", entryId: id }, {}, false);
}
