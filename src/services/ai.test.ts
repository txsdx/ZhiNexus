/** Endpoint-bound credentials must be checked consistently for both chat and image generation during configuration synchronization. */
import { afterEach, expect, it, vi } from "vitest";
import { store } from "../core/store";
import { complete, generateImage } from "./ai";

/** Configure an isolated provider snapshot without initializing persistent storage. */
function configuredAI() {
  const snapshot = store.getSnapshot(),
    ai = structuredClone(snapshot.ai);
  ai.baseUrl = "https://ai.example/v1";
  ai.defaultModel = "gpt-6.1-sol-fast";
  ai.models = [
    {
      id: ai.defaultModel,
      name: "GPT 6.1 Sol",
      efforts: ["high"],
      thinking: true,
      tools: null,
      vision: true,
      image: null,
    },
  ];
  vi.spyOn(store, "getSnapshot").mockImplementation(() => ({
    ...snapshot,
    ai,
    device: {
      ...snapshot.device,
      apiKey: "fixture-key",
      apiKeyEndpoint: ai.baseUrl,
    },
  }));
  const fetcher = vi
    .fn()
    .mockImplementation(async () =>
      Response.json({ choices: [{ message: { content: "ok" } }] }),
    );
  vi.stubGlobal("fetch", fetcher);
  return { ai, fetcher };
}
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

it.each([true, null, false, "absent"] as const)(
  "sends tools unless support is explicitly false (%s)",
  async (support) => {
    const { ai, fetcher } = configuredAI();
    if (support === "absent") ai.models = [];
    else ai.models[0].tools = support;
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "lookup",
          description: "Read knowledge",
          parameters: { type: "object" },
        },
      },
    ];
    await complete("agent", [{ role: "user", content: "lookup" }], tools);
    const body = await (fetcher.mock.calls[0][0] as Request).json();
    expect(body.model).toBe("gpt-6.1-sol-fast");
    expect(body.tools).toEqual(support === false ? undefined : tools);
    // The task preference is medium, which this catalog never declared.
    expect(body).not.toHaveProperty("reasoning_effort");
  },
);

it("resolves defaults at each call, preserves task/local overrides and sends only declared effort", async () => {
  const { ai, fetcher } = configuredAI();
  const messages = [{ role: "user" as const, content: "explain" }];
  await complete("explain", messages);
  ai.defaultModel = "next-raw-id";
  await complete("explain", messages);
  ai.tasks.explain.model = "task-override";
  await complete("explain", messages);
  await complete("explain", messages, undefined, {
    model: "gpt-6.1-sol-fast",
    effort: "high",
  });
  await complete("explain", messages, undefined, { model: "", effort: "high" });
  const bodies = await Promise.all(
    fetcher.mock.calls.map(async ([req]) => (req as Request).json()),
  );
  expect(bodies.map((b) => b.model)).toEqual([
    "gpt-6.1-sol-fast",
    "next-raw-id",
    "task-override",
    "gpt-6.1-sol-fast",
    "next-raw-id",
  ]);
  expect(bodies[3].reasoning_effort).toBe("high");
  expect(bodies[4]).not.toHaveProperty("reasoning_effort");
  expect(ai.tasks.explain.model).toBe("task-override");
});

it("uses the effective OCR model for supported reasoning without guessing unknown abilities", async () => {
  const { ai, fetcher } = configuredAI();
  ai.tasks.ocr.effort = "high";
  await complete(
    "ocr",
    [{ role: "user", content: "transcribe" }],
    undefined,
    undefined,
    "data:image/png;base64,AA==",
  );
  const body = await (fetcher.mock.calls[0][0] as Request).json();
  expect(body.model).toBe(ai.defaultModel);
  expect(body.reasoning_effort).toBe("high");
  expect(body.messages[0].content[1].type).toBe("image_url");
});

it("inherits the global image model and retains an explicit image override", async () => {
  const { ai, fetcher } = configuredAI();
  fetcher.mockImplementation(async () =>
    Response.json({ data: [{ b64_json: "AA==" }] }),
  );
  vi.spyOn(store.db, "putBlob").mockResolvedValue("fixture-hash");
  await generateImage("first");
  ai.defaultModel = "next-image-id";
  await generateImage("second");
  ai.tasks.image.model = "image-override";
  await generateImage("third");
  const bodies = await Promise.all(
    fetcher.mock.calls.map(async ([req]) => (req as Request).json()),
  );
  expect(bodies.map((b) => b.model)).toEqual([
    "gpt-6.1-sol-fast",
    "next-image-id",
    "image-override",
  ]);
});

it("does not silently choose a catalog model when neither default nor override is configured", async () => {
  const { ai, fetcher } = configuredAI();
  ai.defaultModel = "";
  await expect(complete("agent", [])).rejects.toThrow("选择模型");
  await expect(generateImage("image")).rejects.toThrow("配置图片模型");
  expect(fetcher).not.toHaveBeenCalled();
});
