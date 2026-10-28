/** Native private-release discovery stays behind IPC; no updater credential enters browser requests. */
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), proxy: vi.fn() }));
vi.mock("../core/database", () => ({ native: true }));
vi.mock("./proxy", () => ({ ensureNativeProxy: mocks.proxy }));
vi.mock("./network", () => ({ boundedText: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { checkUpdates, applyUpdate } from "./updates";

const manifest = {
  schema: 2,
  commonVersion: "0.14",
  publishedAt: "2026-10-28T00:00:00.000Z",
  platforms: {
    "windows-x86_64": {
      version: "0.14.0",
      notes: "Private release",
      artifacts: {
        portable: {
          url: "https://github.com/txsdx/ZhiNexus/releases/download/v0.14.0/app_protable.exe",
          sha256: "a".repeat(64),
        },
      },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.proxy.mockResolvedValue(undefined);
});

it("reads the private manifest via native IPC with the configured proxy and platform identity", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  mocks.invoke.mockImplementation(async (command) =>
    command === "update_identity"
      ? { platform: "windows-x86_64", version: "0.13.0", portable: true }
      : manifest,
  );
  try {
    const result = await checkUpdates();
    expect(result).toMatchObject({
      available: true,
      kind: "portable",
      version: "0.14.0",
      current: "0.13.0",
    });
    expect(mocks.proxy).toHaveBeenCalledOnce();
    expect(mocks.invoke.mock.calls.map((c) => c[0])).toEqual([
      "update_identity",
      "read_update_manifest",
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});

it("keeps private API authorization failures visible without an anonymous fallback", async () => {
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "update_identity")
      return { platform: "windows-x86_64", version: "0.13.0", portable: true };
    throw Error("GitHub update HTTP 401");
  });
  await expect(checkUpdates()).rejects.toThrow("401");
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
});

it("sends only verified artifact metadata to the native installer", async () => {
  mocks.invoke.mockImplementation(async (command) =>
    command === "update_identity"
      ? { platform: "windows-x86_64", version: "0.13.0", portable: true }
      : manifest,
  );
  const update = await checkUpdates();
  await applyUpdate(update!);
  expect(mocks.invoke).toHaveBeenLastCalledWith("install_platform_update", {
    update: {
      kind: "portable",
      url: manifest.platforms["windows-x86_64"].artifacts.portable.url,
      sha256: "a".repeat(64),
      signature: null,
      version: "0.14.0",
    },
  });
});
