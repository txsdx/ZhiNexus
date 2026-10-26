/** Contract tests for the reference CPA catalog behavior and capability-aware model parsing. */
import { describe, it, expect, vi } from "vitest";
import { normalizeModels, discoverModels } from "./models";
import { request } from "./network";
vi.mock("./network", async () => {
  const actual = await vi.importActual<typeof import("./network")>("./network");
  return { ...actual, request: vi.fn() };
});
describe("CPA model discovery", () => {
  it("parses extended effort objects, tool and modality declarations", () => {
    const result = normalizeModels({
      models: [
        {
          slug: "exact/prefixed-id",
          display_name: "Model",
          supported_reasoning_levels: [{ effort: "high" }, { effort: "low" }],
          supported_parameters: ["tools"],
          input_modalities: ["text", "image"],
        },
      ],
    });
    expect(result[0]).toMatchObject({
      id: "exact/prefixed-id",
      efforts: ["high", "low"],
      thinking: true,
      tools: true,
      vision: true,
    });
  });
  it("never infers capabilities from a familiar model name or empty effort arrays", () => {
    expect(
      normalizeModels({
        data: [{ id: "gpt-familiar-thinking", supported_reasoning_levels: [] }],
      })[0],
    ).toMatchObject({ efforts: [], thinking: null, tools: null, vision: null });
  });
  it("supports thinking.levels but does not invent budget-to-effort mappings", () => {
    expect(
      normalizeModels({
        models: [
          { slug: "a", thinking: { levels: ["low", "high"] } },
          { slug: "b", thinking: { min: 100, max: 10000 } },
        ],
      })[1],
    ).toMatchObject({ thinking: true, efforts: [] });
  });
  it("rejects empty catalogs, duplicate IDs and missing identities", () => {
    expect(() => normalizeModels({ data: [] })).toThrow();
    expect(() =>
      normalizeModels({ data: [{ id: "a" }, { id: "a" }] }),
    ).toThrow();
    expect(() => normalizeModels({ data: [{}] })).toThrow();
  });
  it("falls back only on unsupported extension statuses using exactly two requests", async () => {
    vi.mocked(request)
      .mockReset()
      .mockResolvedValueOnce(new Response("", { status: 422 }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "model" }] }));
    expect(
      await discoverModels("https://provider.example/v1", "test"),
    ).toHaveLength(1);
    expect(vi.mocked(request).mock.calls.map((c) => c[0])).toEqual([
      "https://provider.example/v1/models?client_version=cpa",
      "https://provider.example/v1/models",
    ]);
  });
  it("does not retry auth failures or a plain catalog response", async () => {
    vi.mocked(request)
      .mockReset()
      .mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(
      discoverModels("https://provider.example/v1", "test"),
    ).rejects.toThrow("401");
    expect(request).toHaveBeenCalledTimes(1);
    vi.mocked(request)
      .mockReset()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "a" }] }));
    await discoverModels("https://provider.example/v1", "test");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
