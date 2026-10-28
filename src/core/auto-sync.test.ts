/** Timer tests cover expired startup, suspend/resume, offline recovery, retries and the manual sync gate. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AutoSyncClock, type SyncClockState } from "./auto-sync";
let state: SyncClockState,
  clock: AutoSyncClock,
  run: import("vitest").Mock<() => Promise<number | false>>,
  failed: import("vitest").Mock<(error: unknown) => void>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T00:00:00Z"));
  state = {
    key: "fixture",
    minutes: 1,
    lastSuccess: Date.now() - 120000,
    online: true,
    busy: false,
  };
  run = vi.fn(async () => {
    state.lastSuccess = Date.now();
    return state.lastSuccess;
  });
  failed = vi.fn();
  clock = new AutoSyncClock({ read: () => state, run, failed });
});
afterEach(() => {
  clock.stop();
  vi.useRealTimers();
});
it("an overdue startup sync runs immediately, then only after the actual successful deadline", async () => {
  clock.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(59999);
  expect(run).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2);
  expect(run).toHaveBeenCalledTimes(2);
});
it("manual success moves the deadline instead of retaining a blind interval", async () => {
  state.lastSuccess = Date.now();
  clock.start();
  await vi.advanceTimersByTimeAsync(30000);
  state.lastSuccess = Date.now();
  clock.wake();
  await vi.advanceTimersByTimeAsync(30001);
  expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30001);
  expect(run).toHaveBeenCalledOnce();
});
it("wall-clock wakeups catch up after suspended timers and offline recovery", async () => {
  state.online = false;
  clock.start();
  await vi.advanceTimersByTimeAsync(10000);
  expect(run).not.toHaveBeenCalled();
  vi.setSystemTime(Date.now() + 3600000);
  state.online = true;
  clock.wake(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledOnce();
});
it("a manual exchange blocks overlap and completion wakes a pending automatic exchange", async () => {
  state.busy = true;
  clock.start();
  await vi.advanceTimersByTimeAsync(5000);
  expect(run).not.toHaveBeenCalled();
  state.busy = false;
  clock.wake();
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledOnce();
});
it("failed sync keeps the successful timestamp and retries with backoff", async () => {
  const previous = state.lastSuccess;
  run.mockRejectedValueOnce(Error("offline"));
  clock.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(state.lastSuccess).toBe(previous);
  expect(failed).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(29999);
  expect(run).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2);
  expect(run).toHaveBeenCalledTimes(2);
});
it("disabling or stopping the clock cancels future work", async () => {
  state.minutes = 0;
  clock.start();
  await vi.advanceTimersByTimeAsync(120000);
  expect(run).not.toHaveBeenCalled();
  state.minutes = 1;
  clock.wake();
  clock.stop();
  await vi.advanceTimersByTimeAsync(120000);
  expect(run).not.toHaveBeenCalled();
});
it("concurrent wakeups share the in-flight exchange and do not trigger duplicate work", async () => {
  let done!: (n: number) => void;
  run.mockImplementationOnce(
    () =>
      new Promise<number>((resolve) => {
        done = resolve;
      }),
  );
  clock.start();
  await vi.advanceTimersByTimeAsync(1);
  for (let i = 0; i < 10; i++) clock.wake(true);
  await vi.advanceTimersByTimeAsync(120000);
  expect(run).toHaveBeenCalledOnce();
  state.lastSuccess = Date.now();
  done(state.lastSuccess);
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(1000);
  expect(run).toHaveBeenCalledOnce();
});
it("a clock correction cannot leave the last completed exchange indefinitely in the future", async () => {
  clock.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledOnce();
  vi.setSystemTime(Date.now() - 3600000);
  clock.wake();
  await vi.advanceTimersByTimeAsync(1);
  expect(run).toHaveBeenCalledTimes(2);
});
it("a successful manual retry clears an automatic failure backoff and schedules from that success", async () => {
  run.mockRejectedValueOnce(Error("offline"));
  clock.start();
  await vi.advanceTimersByTimeAsync(1);
  state.lastSuccess = Date.now();
  clock.wake();
  await vi.advanceTimersByTimeAsync(30001);
  expect(run).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30000);
  expect(run).toHaveBeenCalledTimes(2);
});
