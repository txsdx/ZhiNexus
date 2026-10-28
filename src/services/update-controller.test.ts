/** Updater lifecycle regressions: one download, offline staging, restart recovery and no implicit installer. */
import { beforeEach, expect, it, vi } from "vitest";
import { UpdateController } from "./update-controller";
import type { UpdateInfo } from "./updates";
const info: UpdateInfo = {
  platform: "windows-x86_64",
  current: "0.17.0",
  version: "0.18.0",
  notes: "fixture",
  kind: "portable",
  url: "https://github.com/txsdx/ZhiNexus/releases/download/v0.18.0/app_protable.exe",
  sha256: "a".repeat(64),
  available: true,
};
const dependencies = () => ({
  check: vi.fn(async () => info),
  prepare: vi.fn(async () => {}),
  restore: vi.fn(async (): Promise<UpdateInfo | null> => null),
  remember: vi.fn(async (_info: UpdateInfo | null) => {}),
  failed: vi.fn(),
});
beforeEach(() => vi.restoreAllMocks());
it("coalesces startup, online and manual checks; repeated unchanged checks do not download again", async () => {
  const deps = dependencies(),
    controller = new UpdateController(deps);
  await Promise.all([
    controller.check(),
    controller.check(),
    controller.check(),
  ]);
  expect(deps.check).toHaveBeenCalledOnce();
  expect(deps.prepare).toHaveBeenCalledOnce();
  expect(deps.remember).toHaveBeenCalledWith(info);
  expect(controller.getSnapshot().phase).toBe("ready");
  await controller.check();
  expect(deps.prepare).toHaveBeenCalledOnce();
});
it("never marks a failed or corrupt download ready, and a retry revalidates it", async () => {
  const deps = dependencies(),
    controller = new UpdateController(deps);
  deps.prepare.mockRejectedValueOnce(Error("SHA-256 mismatch"));
  await expect(controller.check()).rejects.toThrow("mismatch");
  expect(controller.getSnapshot().phase).toBe("error");
  expect(deps.remember).not.toHaveBeenCalled();
  const install = vi.fn();
  expect(await controller.install(install)).toBe(false);
  expect(install).not.toHaveBeenCalled();
  await controller.check();
  expect(controller.getSnapshot().phase).toBe("ready");
});
it("restores and verifies a staged artifact after restart even if discovery is offline", async () => {
  const deps = dependencies();
  deps.restore.mockResolvedValue(info);
  deps.check.mockRejectedValue(Error("offline"));
  const controller = new UpdateController(deps);
  await expect(controller.check()).rejects.toThrow("offline");
  expect(deps.prepare).toHaveBeenCalledWith(info);
  expect(controller.getSnapshot()).toMatchObject({
    phase: "ready",
    update: info,
  });
  const install = vi.fn(async () => {});
  expect(await controller.install(install)).toBe(true);
  expect(install).toHaveBeenCalledOnce();
});
it("a stale or missing cached artifact does not block discovery of a newer available version", async () => {
  const deps = dependencies();
  deps.restore.mockResolvedValue(info);
  deps.prepare.mockRejectedValueOnce(Error("cache missing"));
  const controller = new UpdateController(deps);
  await controller.check();
  expect(deps.prepare).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot().phase).toBe("ready");
});
it("a second click cannot launch another installer while installation is pending", async () => {
  const deps = dependencies(),
    controller = new UpdateController(deps);
  await controller.check();
  let done!: () => void;
  const install = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  const first = controller.install(install);
  expect(await controller.install(install)).toBe(false);
  await controller.check();
  expect(deps.check).toHaveBeenCalledOnce();
  done();
  await first;
  expect(install).toHaveBeenCalledOnce();
});
it("installation failures preserve the staged update for retry", async () => {
  const controller = new UpdateController(dependencies());
  await controller.check();
  await expect(
    controller.install(async () => {
      throw Error("installer denied");
    }),
  ).rejects.toThrow("denied");
  expect(controller.getSnapshot()).toMatchObject({
    phase: "ready",
    error: "installer denied",
  });
});
