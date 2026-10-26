/** Endpoint-bound credentials must be checked consistently for both chat and image generation during configuration synchronization. */
import { afterEach, expect, it, vi } from "vitest";
import { store } from "../core/store";
import { complete, generateImage } from "./ai";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("retains old credentials without transmitting them when the shared endpoint changes", async () => {
  const snapshot = store.getSnapshot(),
    ai = structuredClone(snapshot.ai);
  ai.baseUrl = "https://new.example/v1";
  ai.tasks.image.model = "image-model";
  ai.tasks.agent.model = "chat-model";
  vi.spyOn(store, "getSnapshot").mockReturnValue({
    ...snapshot,
    ai,
    device: {
      ...snapshot.device,
      apiKey: "fixture-key",
      apiKeyEndpoint: "https://previous.example/v1",
    },
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(generateImage("illustrate a concept")).rejects.toThrow(
    "another endpoint",
  );
  await expect(
    complete("agent", [{ role: "user", content: "explain" }]),
  ).rejects.toThrow("another endpoint");
  expect(fetcher).not.toHaveBeenCalled();
});
