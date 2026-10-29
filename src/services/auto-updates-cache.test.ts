/** Installer caches are rejected; the same executable cache works when data stays in the system app folder. */
import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  saved: null as any,
  prepare: vi.fn(async (_info: unknown) => {}),
  remember: vi.fn(async () => {}),
  invoke: vi.fn(async () => ({
    platform: "windows-x86_64",
    version: "0.18.0",
    portable: false,
  })),
  info: {
    platform: "windows-x86_64",
    current: "0.18.0",
    version: "0.19.0",
    kind: "portable" as const,
    notes: "update",
    url: "https://github.com/txsdx/ZhiNexus/releases/download/v0.19.0/app_protable.exe",
    sha256: "a".repeat(64),
    available: true,
  },
}));
vi.mock("../core/database", () => ({ native: true }));
vi.mock("../core/store", () => ({
  store: {
    db: { local: async () => fixture.saved, setLocal: fixture.remember },
  },
}));
vi.mock("./diagnostics", () => ({ diagnostics: { error: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
vi.mock("./updates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./updates")>()),
  checkUpdates: async () => fixture.info,
  prepareUpdate: fixture.prepare,
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.saved = null;
});
it("an old setup cache is never prepared or applied", async () => {
  fixture.saved = {
    ...fixture.info,
    kind: "setup",
    url: fixture.info.url.replace("_protable.exe", "_setup.exe"),
  };
  const { autoUpdates } = await import("./auto-updates");
  await autoUpdates.check();
  expect(fixture.prepare).toHaveBeenCalledOnce();
  expect(fixture.prepare).toHaveBeenCalledWith(fixture.info);
  expect(autoUpdates.getSnapshot().update?.kind).toBe("portable");
});
it("system-data mode reuses the verified single-file cache instead of selecting an installer", async () => {
  fixture.saved = { ...fixture.info, current: "0.17.0" };
  const { autoUpdates } = await import("./auto-updates");
  await autoUpdates.check();
  expect(fixture.invoke).toHaveBeenCalledWith("update_identity");
  expect(fixture.prepare).toHaveBeenCalledOnce();
  expect(fixture.prepare).toHaveBeenCalledWith(fixture.info);
  expect(autoUpdates.getSnapshot().phase).toBe("ready");
});
