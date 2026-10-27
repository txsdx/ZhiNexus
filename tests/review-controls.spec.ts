/** Review controls preserve FSRS and committed material until an explicit result commit. */
import { test, expect, type Page, type Route } from "@playwright/test";
/** Inspect the actual local repository, including immutable review history. */
async function repository<T>(page: Page, code: string): Promise<T> {
  await expect(page.locator(".app-shell")).toBeVisible();
  return page.evaluate(async (source) => {
    const { store } = await import("/src/core/store.ts" as string);
    return new Function("store", `return (async()=>{${source}})()`)(store);
  }, code);
}
const question = (text = "原题：解释提取练习") => ({
  question: text,
  type: "short",
  choices: [],
  answer: "主动提取",
  rubric: "解释机制",
});
const grade = {
  score: 95,
  feedback: "理解准确",
  missing: "尚未提交的补充",
  lesson: "教学反馈",
};
/** Seed one uncounted review with a saved answer, optionally already assessed. */
async function setup(page: Page, phase = "answer") {
  await page.goto("/");
  await repository(
    page,
    `const ai=structuredClone(store.getSnapshot().ai);ai.baseUrl='https://ai.example/v1';ai.defaultModel='fixture';await store.saveAI(ai);await store.updateDevice({apiKey:'fixture-key',syncMinutes:0});const id=await store.createEntry('提取练习','原始词条内容');await store.patch('review','session',{entryId:id,phase:'${phase}',question:${JSON.stringify(question())},answer:'已保存的回答',grade:${phase === "graded" ? JSON.stringify(grade) : "null"},startedAt:new Date().toISOString()});`,
  );
  await page.getByRole("button", { name: /^复习队列/ }).click();
  await expect(page.locator(".review-workspace h2")).toHaveText(
    question().question,
  );
}
/** Reply with an ordinary compatible Chat Completions payload. */
async function response(route: Route, value: unknown) {
  try {
    await route.fulfill({
      json: {
        choices: [
          { message: { content: JSON.stringify(value), tool_calls: null } },
        ],
      },
    });
  } catch {
    /* An intentionally aborted request may have closed its route. */
  }
}
/** Compare only committed review/entry operations; diagnostics are device-local metadata. */
async function saved(page: Page) {
  return repository(
    page,
    "const s=store.getSnapshot();return {reviews:s.reviews,entries:s.entries,events:s.events};",
  );
}

test("cancel waits for confirmation and persists a cancelled session without changing its card or content", async ({
  page,
}) => {
  await setup(page, "graded");
  const before = await saved(page);
  await page.getByRole("button", { name: "取消本次复习", exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  expect(await saved(page)).toEqual(before);
  await page.getByRole("button", { name: "取消本次复习", exact: true }).click();
  await page.keyboard.press("Escape");
  expect(await saved(page)).toEqual(before);
  await page.getByRole("button", { name: "取消本次复习", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.locator(".review-workspace")).toHaveCount(0);
  expect(
    await repository(page, "return store.getSnapshot().reviews[0].phase"),
  ).toBe("cancelled");
  expect(await repository(page, "return store.getSnapshot().entries")).toEqual(
    (before as { entries: unknown }).entries,
  );
  await page.reload();
  await page.getByRole("button", { name: /^复习队列/ }).click();
  await expect(page.locator(".queue>button")).toHaveCount(1);
  expect(
    await repository(page, "return store.getSnapshot().reviews[0].grade.score"),
  ).toBe(95);
});

test("new questions replace answers only after confirmation and success; failure and duplicate questions retain everything", async ({
  page,
}) => {
  let mode = "success",
    calls = 0;
  await page.route("https://ai.example/**", async (route) => {
    calls++;
    if (mode === "error")
      await route.fulfill({ status: 503, body: "fixture unavailable" });
    else await response(route, question("新题：举一个生活中的例子"));
  });
  await setup(page, "graded");
  const before = await saved(page);
  await page.getByRole("button", { name: "重新出题", exact: true }).click();
  expect(await saved(page)).toEqual(before);
  expect(calls).toBe(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  expect(await saved(page)).toEqual(before);
  expect(calls).toBe(0);
  await page.getByRole("button", { name: "重新出题", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.locator(".review-workspace h2")).toHaveText(
    "新题：举一个生活中的例子",
  );
  await expect(page.locator(".review-workspace textarea")).toHaveValue("");
  expect(
    await repository(page, "return store.getSnapshot().reviews[0].grade"),
  ).toBeNull();
  expect(await repository(page, "return store.getSnapshot().entries")).toEqual(
    (before as { entries: unknown }).entries,
  );
  const replaced = await saved(page);
  mode = "error";
  await page.getByRole("button", { name: "重新出题", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("503");
  expect(await saved(page)).toEqual(replaced);
  mode = "same";
  await page.getByRole("button", { name: "重新出题", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("相同题目");
  expect(await saved(page)).toEqual(replaced);
});

test("stopping question generation drops its late response and allows another attempt", async ({
  page,
}) => {
  let release: () => void = () => {},
    started = false,
    delayed = true;
  await page.route("https://ai.example/**", async (route) => {
    started = true;
    if (delayed)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await response(route, question(delayed ? "迟到旧题" : "新的有效题"));
  });
  await setup(page);
  // Return to the due queue without changing the card.
  await repository(
    page,
    "await store.patch('review','session',{phase:'cancelled'})",
  );
  await page.locator(".queue>button").click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "停止本次请求", exact: true }).click();
  delayed = false;
  release();
  await expect(page.locator(".queue>button")).toBeEnabled();
  await page.locator(".queue>button").click();
  await expect(page.locator(".review-workspace h2")).toHaveText("新的有效题");
  expect(
    await repository(
      page,
      "return store.getSnapshot().reviews.filter(r=>r.phase!=='cancelled').length",
    ),
  ).toBe(1);
  expect(
    await repository(page, "return store.getSnapshot().entries[0].card.reps"),
  ).toBe(0);
});

test("cancelling during grading prevents its late response from reviving the review", async ({
  page,
}) => {
  let release: () => void = () => {},
    started = false;
  await page.route("https://ai.example/**", async (route) => {
    started = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await response(route, grade);
  });
  await setup(page);
  const entries = await repository(page, "return store.getSnapshot().entries");
  await page.getByRole("button", { name: "检查我的理解" }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByRole("button", { name: "取消本次复习", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.locator(".review-workspace")).toHaveCount(0);
  release();
  await page.reload();
  expect(
    await repository(page, "return store.getSnapshot().reviews[0]"),
  ).toMatchObject({ phase: "cancelled", grade: null, answer: "已保存的回答" });
  expect(await repository(page, "return store.getSnapshot().entries")).toEqual(
    entries,
  );
});

test("high scores can be retried, while a saved result increments FSRS only once", async ({
  page,
}) => {
  await page.route("https://ai.example/**", (route) => response(route, grade));
  await setup(page, "graded");
  await page.getByRole("button", { name: "重新作答", exact: true }).click();
  await expect(page.locator(".review-workspace textarea")).toHaveValue("");
  expect(
    await repository(page, "return store.getSnapshot().entries[0].card.reps"),
  ).toBe(0);
  await page.locator(".review-workspace textarea").fill("新的回答");
  await page.getByRole("button", { name: "检查我的理解" }).click();
  await expect(page.locator(".score strong")).toHaveText("95");
  await page.getByRole("button", { name: "记录结果并继续" }).dblclick();
  await expect(page.locator(".review-workspace")).toHaveCount(0);
  expect(
    await repository(page, "return store.getSnapshot().entries[0].card.reps"),
  ).toBe(1);
  expect(
    await repository(
      page,
      "return store.getSnapshot().events.filter(e=>e.op.source==='review-assessment').length",
    ),
  ).toBe(2);
});

test("cancel storage failures leave the complete review and entry unchanged", async ({
  page,
}) => {
  await setup(page, "graded");
  const before = await saved(page);
  await repository(
    page,
    "store.db.append=async()=>{throw Error('fixture review storage failure')}",
  );
  await page.getByRole("button", { name: "取消本次复习", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText(
    "fixture review storage failure",
  );
  expect(await saved(page)).toEqual(before);
});

test("a remote cancellation cannot be overwritten by an older assessment response", async ({
  page,
}) => {
  let release: () => void = () => {},
    started = false;
  await page.route("https://ai.example/**", async (route) => {
    started = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await response(route, grade);
  });
  await setup(page);
  await page.getByRole("button", { name: "检查我的理解" }).click();
  await expect.poll(() => started).toBe(true);
  await repository(
    page,
    "await store.patch('review','session',{phase:'cancelled'},'other-device')",
  );
  const before = await saved(page);
  release();
  await expect(page.getByRole("button", { name: "停止本次请求" })).toHaveCount(
    0,
  );
  expect(await saved(page)).toEqual(before);
  expect(
    await repository(page, "return store.getSnapshot().entries[0].card.reps"),
  ).toBe(0);
});
