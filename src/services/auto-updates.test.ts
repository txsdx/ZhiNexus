/** Automatic update scheduling stays outside editing, honors opt-out and retries after network recovery. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  device: { autoUpdate: true },
  listeners: new Set<() => void>(),
}));
vi.mock("../core/database", () => ({ native: true }));
vi.mock("../core/store", () => ({
  store: {
    getSnapshot: () => ({ device: fixture.device }),
    subscribe: (listener: () => void) => {
      fixture.listeners.add(listener);
      return () => fixture.listeners.delete(listener);
    },
  },
}));
vi.mock("./diagnostics", () => ({ diagnostics: { error: vi.fn() } }));
import { autoUpdates, startAutomaticUpdates } from "./auto-updates";
let stop = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
  fixture.device = { autoUpdate: true };
  fixture.listeners.clear();
  vi.spyOn(autoUpdates, "check").mockResolvedValue(null);
});
afterEach(() => {
  stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("checks after first paint without creating duplicate startup schedulers", async () => {
  stop = startAutomaticUpdates();
  const duplicate = startAutomaticUpdates();
  await vi.advanceTimersByTimeAsync(2999);
  expect(autoUpdates.check).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(autoUpdates.check).toHaveBeenCalledOnce();
  duplicate();
  await vi.advanceTimersByTimeAsync(6 * 3600000);
  expect(autoUpdates.check).toHaveBeenCalledTimes(2);
});
it("disabled settings prevent startup checks and re-enabling schedules one attempt", async () => {
  fixture.device.autoUpdate = false;
  stop = startAutomaticUpdates();
  await vi.advanceTimersByTimeAsync(10000);
  expect(autoUpdates.check).not.toHaveBeenCalled();
  fixture.device.autoUpdate = true;
  fixture.listeners.forEach((listener) => listener());
  await vi.advanceTimersByTimeAsync(1000);
  expect(autoUpdates.check).toHaveBeenCalledOnce();
  fixture.device.autoUpdate = false;
  fixture.listeners.forEach((listener) => listener());
  await vi.advanceTimersByTimeAsync(7 * 3600000);
  expect(autoUpdates.check).toHaveBeenCalledOnce();
});
it("offline startup waits, online recovery wakes it and failures back off without opening an installer", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  stop = startAutomaticUpdates();
  await vi.advanceTimersByTimeAsync(3000);
  expect(autoUpdates.check).not.toHaveBeenCalled();
  vi.stubGlobal("navigator", { onLine: true });
  vi.mocked(autoUpdates.check).mockRejectedValueOnce(
    Error("network unavailable"),
  );
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(autoUpdates.check).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(59999);
  expect(autoUpdates.check).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(autoUpdates.check).toHaveBeenCalledTimes(2);
});
