/** Last-success elapsed time, immediate exchange, failure preservation and silent automatic completion. */
import { test, expect, type Page, type Route } from "@playwright/test";

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

/** Preserve real envelope/hash processing behind an in-memory WebDAV protocol fixture. */
async function dav(page: Page, beforeWrite?: (path: string) => Promise<void>) {
  const files = new Map<string, string>();
  await page.route("https://dav.example/**", async (route: Route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.slice("/knowledge/".length);
    if (request.method() === "MKCOL") return route.fulfill({ status: 201 });
    if (request.method() === "PROPFIND") {
      const folder = path.replace(/\/$/, "") + "/";
      const names = [...files.keys()].filter(
        (name) =>
          name.startsWith(folder) && !name.slice(folder.length).includes("/"),
      );
      return route.fulfill({
        status: 207,
        contentType: "application/xml",
        body:
          '<d:multistatus xmlns:d="DAV:">' +
          names
            .map(
              (name) =>
                "<d:response><d:href>/knowledge/" +
                name +
                "</d:href></d:response>",
            )
            .join("") +
          "</d:multistatus>",
      });
    }
    if (request.method() === "PUT") {
      await beforeWrite?.(path);
      files.set(path, request.postData()!);
      return route.fulfill({ status: 201 });
    }
    return route.fulfill({
      status: files.has(path) ? 200 : 404,
      contentType: "application/json",
      body: files.get(path) ?? "",
    });
  });
}

test("the status shows minutes and seconds, synchronizes on click, prevents duplicates and survives reload", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-28T06:00:00.000Z"));
  let finish = () => {},
    writes = 0;
  await dav(page, async (path) => {
    if (path.startsWith("devices/")) {
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
    await expect(button).toHaveText("1分5秒");
    await page.clock.setFixedTime(new Date("2026-10-28T06:00:56.000Z"));
    await expect(button).toHaveText("2分1秒");
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveText("同步中…");
    await expect.poll(() => writes).toBe(1);
    finish();
    await expect(button).toBeEnabled();
    await expect(button).toHaveText("0分0秒");
    expect(writes).toBe(1);
    await expect(page.locator(".toast")).toHaveCount(0);
    await page.reload();
    await expect(button).toHaveText("0分0秒");
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
  await expect(button).toHaveText("1分5秒");
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
  await page.clock.install({ time: new Date("2026-10-28T06:00:00.000Z") });
  let writes = 0;
  await dav(page, async (path) => {
    if (path.startsWith("devices/")) writes++;
  });
  await page.goto("/");
  await configure(page, 1);
  await expect(
    page.getByRole("button", { name: "点击立即同步", exact: true }),
  ).toHaveText("1分5秒");
  await page.clock.fastForward(61000);
  await expect.poll(() => writes).toBe(1);
  await expect(
    page.getByRole("button", { name: "点击立即同步", exact: true }),
  ).toHaveText("0分0秒");
  await expect(page.locator(".toast")).toHaveCount(0);
});
