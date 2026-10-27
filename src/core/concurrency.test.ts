/** Admission and cancellation regressions for the shared provider limit. */
import { expect, it } from "vitest";
import { AIConcurrency } from "./concurrency";
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
it("runs FIFO, changes the live limit, and releases failed requests", async () => {
  const limiter = new AIConcurrency();
  limiter.setLimit(1);
  const order: number[] = [];
  const release: (() => void)[] = [];
  const signal = new AbortController().signal;
  const tasks = [0, 1, 2].map((i) =>
    limiter.run(
      signal,
      () => order.push(i),
      () =>
        new Promise<number>((resolve) => {
          release[i] = () => resolve(i);
        }),
    ),
  );
  await turn();
  expect(order).toEqual([0]);
  expect(limiter.counts).toEqual({ active: 1, waiting: 2, limit: 1 });
  limiter.setLimit(2);
  await turn();
  expect(order).toEqual([0, 1]);
  release[1]();
  await turn();
  expect(order).toEqual([0, 1, 2]);
  release[0]();
  release[2]();
  expect(await Promise.all(tasks)).toEqual([0, 1, 2]);
  expect(limiter.counts.active).toBe(0);
  await expect(
    limiter.run(
      signal,
      () => {},
      async () => {
        throw Error("fixture");
      },
    ),
  ).rejects.toThrow("fixture");
  expect(limiter.counts.active).toBe(0);
});
it("cancels a queued request without issuing it or blocking the next", async () => {
  const limiter = new AIConcurrency();
  limiter.setLimit(1);
  let release = () => {};
  const first = limiter.run(
    new AbortController().signal,
    () => {},
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  await turn();
  const controller = new AbortController();
  let started = false;
  const second = limiter.run(
    controller.signal,
    () => {
      started = true;
    },
    async () => {},
  );
  const rejected = expect(second).rejects.toThrow();
  controller.abort();
  await rejected;
  expect(started).toBe(false);
  expect(limiter.counts.waiting).toBe(0);
  release();
  await first;
  expect(limiter.counts.active).toBe(0);
});
it("does not abort active requests when the limit decreases", async () => {
  const limiter = new AIConcurrency();
  const releases: (() => void)[] = [];
  let started = 0;
  const jobs = [0, 1, 2].map((i) =>
    limiter.run(
      new AbortController().signal,
      () => {
        started++;
      },
      () =>
        new Promise<void>((resolve) => {
          releases[i] = resolve;
        }),
    ),
  );
  await turn();
  limiter.setLimit(1);
  expect(started).toBe(2);
  releases[0]();
  await turn();
  expect(started).toBe(2);
  releases[1]();
  await turn();
  expect(started).toBe(3);
  releases[2]();
  await Promise.all(jobs);
});
