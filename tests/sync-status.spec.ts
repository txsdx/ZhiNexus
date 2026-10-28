import { mockWebDAV } from "./helpers/webdav";
/** Last-success elapsed time, immediate exchange, failure preservation and silent automatic completion. */
import { test, expect, type Page } from "@playwright/test";

/** Configure the real repository without adding production test hooks. */
async function configure(page: Page, syncMinutes = 0) {
  await page.locator(".app-shell").waitFor();
  await page.evaluate(async (minutes) => {
    const { store } = await import("/src/core/store.ts" as string);
    await store.updateDevice({
      davUrl: "https://dav.example/knowledge/",
      davUser: "fixture",
      davPassword: "fixture",
      syncMinutes: minutes,
      lastSync: "2026-10-28T05:58:55.000Z",
    });
  }, syncMinutes);
}

/** Use the same real gzip and conditional-write fixture as multi-device integration tests. */
async function dav(page: Page, beforeWrite?: (path: string) => Promise<void>) {
  return mockWebDAV(page, new Map(), { beforeWrite });
}

test("the status shows minutes and seconds, synchronizes on click, prevents duplicates and survives reload", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-28T06:00:00.000Z"));
  let finish = () => {},
    writes = 0;
  await dav(page, async (path) => {
    if (path.endsWith("HEAD.json")) {
      writes++;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
  });
  try {
    await page.goto("/");
    await configure(page);
    const button = page.getByRole("button", {
      name: "点击立即同步",
      exact: true,
    });
    await expect(button).toHaveText("同步过时：1分5秒");
    await page.clock.setFixedTime(new Date("2026-10-28T06:00:56.000Z"));
    await expect(button).toHaveText("同步过时：2分1秒");
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveText("同步过时：同步中…");
    await expect.poll(() => writes).toBe(1);
    finish();
    await expect(button).toBeEnabled();
    await expect(button).toHaveText("同步过时：0分0秒");
    expect(writes).toBe(1);
    await expect(page.locator(".toast")).toHaveCount(0);
    await page.reload();
    await expect(button).toHaveText("同步过时：0分0秒");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(button).toBeVisible();
    expect(
      await page.evaluate(
        () => document.body.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  } finally {
    finish();
  }
});

test("a failed manual exchange keeps the last successful timestamp and remains retryable", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-28T06:00:00.000Z"));
  await page.route("https://dav.example/**", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.goto("/");
  await configure(page);
  const button = page.getByRole("button", {
    name: "点击立即同步",
    exact: true,
  });
  await button.click();
  await expect(page.locator(".toast")).toContainText("503");
  await expect(button).toBeEnabled();
  await expect(button).toHaveText("同步过时：1分5秒");
  expect(
    await page.evaluate(async () => {
      const { store } = await import("/src/core/store.ts" as string);
      return store.getSnapshot().device.lastSync;
    }),
  ).toBe("2026-10-28T05:58:55.000Z");
});

test("automatic synchronization updates the timer without a completion toast", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-28T05:00:00.000Z") });
  await page.clock.pauseAt(new Date("2026-10-28T06:00:00.000Z"));
  let writes = 0;
  await dav(page, async (path) => {
    if (path.endsWith("HEAD.json")) writes++;
  });
  await page.goto("/");
  await configure(page, 1);
  await expect(
    page.getByRole("button", { name: "点击立即同步", exact: true }),
  ).toHaveText("同步过时：1分5秒");
  await page.clock.fastForward(61000);
  await expect.poll(() => writes).toBe(1);
  await expect(
    page.getByRole("button", { name: "点击立即同步", exact: true }),
  ).toHaveText("同步过时：0分0秒");
  await expect(page.locator(".toast")).toHaveCount(0);
});
