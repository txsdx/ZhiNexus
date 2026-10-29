/** Knowledge workflows integrate real SQLite, navigation, editor codecs and offline FSRS without provider mocks. */
import { test, expect, type Page } from "@playwright/test";
import { repository } from "./helpers/ai-stream";
async function seed(page: Page) {
  await page.goto("/");
  return repository<{ a: string; b: string }>(
    page,
    `const a=await store.createEntry('安全过滤器','控制约束与机器人安全');const b=await store.createEntry('控制屏障函数','数学解释');await store.patch('entry',a,{tags:['机器人'],starred:true});await store.patch('entry',b,{tags:['数学']});return {a,b};`,
  );
}
async function offline(page: Page) {
  await page.getByRole("button", { name: /^复习队列/ }).click();
  await page.getByLabel("包含未到期条目", { exact: true }).check();
  await page.locator(".queue>button").first().click();
  await expect(page.locator(".self-review h2")).toBeVisible();
}
test("structured filters, bookmarks and quick entry switching survive reload", async ({
  page,
}) => {
  const ids = await seed(page);
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  const search = page.getByRole("textbox", { name: "搜索知识", exact: true });
  await search.fill("tag:机器人 is:starred -body:数学");
  await expect(page.locator(".entry-row")).toHaveCount(1);
  await expect(page.locator(".entry-title-cell")).toContainText("安全过滤器");
  await search.clear();
  await page.getByRole("button", { name: "收藏", exact: true }).click();
  await expect(page.locator(".entry-row")).toHaveCount(1);
  await repository(
    page,
    `await store.patch('entry','${ids.b}',{content:'\"独有 is:starred'});`,
  );
  await search.fill('"独有');
  await expect(page.locator(".entry-row")).toHaveCount(0);
  await search.clear();
  await page.keyboard.press("Control+p");
  const picker = page.getByRole("dialog", {
    name: "快速切换词条",
    exact: true,
  });
  await picker.getByRole("combobox").fill("tag:数学");
  await picker.getByRole("combobox").press("Enter");
  await expect(page.locator(".entry-heading h1")).toHaveText("控制屏障函数");
  await page.getByRole("button", { name: "收藏词条", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "取消收藏", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(entry=>entry.id==='${ids.b}').starred`,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator(".entry-heading h1")).toHaveText("控制屏障函数");
  await expect(
    page.getByRole("button", { name: "取消收藏", exact: true }),
  ).toBeVisible();
});
test("quick switch cancellation and position history preserve a selected unsaved source draft", async ({
  page,
}) => {
  const ids = await seed(page);
  await page.keyboard.press("Control+p");
  await page.getByRole("combobox").fill("安全过滤器");
  await page.getByRole("combobox").press("Enter");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByRole("button", { name: "Markdown 源码", exact: true })
    .click();
  const body = page.getByRole("textbox", { name: "Markdown", exact: true });
  await body.fill("未保存的选择位置和完整正文");
  await body.evaluate((node) => {
    const input = node as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(3, 7);
  });
  await page.keyboard.press("Control+p");
  await expect(page.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(body).toBeFocused();
  expect(
    await body.evaluate((node) => [
      (node as HTMLTextAreaElement).selectionStart,
      (node as HTMLTextAreaElement).selectionEnd,
    ]),
  ).toEqual([3, 7]);
  await page.keyboard.press("Control+p");
  await page.getByRole("combobox").fill("控制屏障函数");
  await page.getByRole("combobox").press("Enter");
  await expect(page.locator(".entry-heading h1")).toHaveText("控制屏障函数");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(body).toHaveValue("未保存的选择位置和完整正文");
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(entry=>entry.id==='${ids.a}').content`,
    ),
  ).toBe("控制约束与机器人安全");
});
test("stable Markdown references round-trip rich editing and backlinks retain identity after renaming", async ({
  page,
}) => {
  const ids = await seed(page);
  await page.keyboard.press("Control+p");
  await page.getByRole("combobox").fill("安全过滤器");
  await page.getByRole("combobox").press("Enter");
  await page.getByRole("button", { name: "引用词条", exact: true }).click();
  const picker = page.getByRole("dialog", {
    name: "插入词条引用",
    exact: true,
  });
  await picker.getByRole("combobox").fill("控制屏障函数");
  await picker.getByRole("combobox").press("Enter");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(`.paper a[href="entry:${ids.b}"]`)).toBeVisible();
  await page.locator(`.paper a[href="entry:${ids.b}"]`).click();
  await expect(page.locator(".entry-heading h1")).toHaveText("控制屏障函数");
  await page.locator(".entry-references summary").click();
  await expect(page.locator(".entry-references")).toContainText("安全过滤器");
  await repository(
    page,
    `await store.patch('entry','${ids.b}',{title:'改名后的屏障函数'});`,
  );
  await page
    .locator(".entry-references button")
    .filter({ hasText: "安全过滤器" })
    .click();
  await expect(page.locator(".entry-heading h1")).toHaveText("安全过滤器");
  await page.locator(`.paper a[href="entry:${ids.b}"]`).click();
  await expect(page.locator(".entry-heading h1")).toHaveText(
    "改名后的屏障函数",
  );
});
test("offline recall hides the answer, resumes after reload and records one real rating without AI", async ({
  page,
}) => {
  await seed(page);
  let requests = 0;
  await page.route("**/chat/completions", (route) => {
    requests++;
    return route.abort();
  });
  await offline(page);
  await expect(page.locator(".self-review-answer")).toHaveCount(0);
  const before = await repository(
    page,
    "return JSON.stringify(store.getSnapshot().entries)",
  );
  await page.reload();
  await page.getByRole("button", { name: /^复习队列/ }).click();
  await expect(
    page.getByRole("button", { name: "揭示解释", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "揭示解释", exact: true }).click();
  await expect(page.locator(".self-review-answer")).toBeVisible();
  expect(
    await repository(
      page,
      "return JSON.stringify(store.getSnapshot().entries)",
    ),
  ).toBe(before);
  await page.keyboard.press("3");
  await expect(
    page.locator(".self-review .recall-rating button").nth(2),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "记录结果并继续", exact: true })
    .click();
  await expect(page.locator(".self-review")).toHaveCount(0);
  expect(
    await repository(
      page,
      "return store.getSnapshot().reviews.filter(review=>review.phase==='done'&&review.mode==='self'&&review.grade===null).length",
    ),
  ).toBe(1);
  expect(
    await repository(
      page,
      "return store.getSnapshot().entries.reduce((n,e)=>n+(e.reviewCount??0),0)",
    ),
  ).toBe(1);
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "学习概览", exact: true }).click();
  await expect(page.locator(".study-activity-stats")).toContainText(
    "完成复习 1",
  );
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await page.locator(`[data-day="${today}"]`).click();
  await expect(page.locator(".study-day-events li")).toHaveCount(3);
});
test("offline recall rejects changed material; storage failure leaves the revealed session and card untouched", async ({
  page,
}) => {
  await seed(page);
  await offline(page);
  await page.getByRole("button", { name: "揭示解释", exact: true }).click();
  await expect(page.locator(".self-review-answer")).toBeVisible();
  await repository(
    page,
    "const entry=store.getSnapshot().entries.find(e=>e.id===store.getSnapshot().reviews[0].entryId);await store.patch('entry',entry.id,{content:'远端修改后的解释'});",
  );
  await expect(page.locator(".self-review").getByRole("alert")).toContainText(
    "已改变",
  );
  await expect(
    page.getByRole("button", { name: "记录结果并继续", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "取消本次复习", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  expect(
    await repository(
      page,
      "return store.getSnapshot().entries.reduce((n,e)=>n+(e.reviewCount??0),0)",
    ),
  ).toBe(0);
  await page.locator(".queue>button").first().click();
  await page.getByRole("button", { name: "揭示解释", exact: true }).click();
  await page.locator(".self-review .recall-rating button").nth(2).click();
  await repository(
    page,
    "const append=store.db.append.bind(store.db);store.db.restoreAppend=append;store.db.append=async(events)=>{if(events.some(e=>e.op.source==='self-review-complete'))throw Error('self-review disk failure');return append(events)};",
  );
  await page
    .getByRole("button", { name: "记录结果并继续", exact: true })
    .click();
  await expect(page.locator(".self-review").getByRole("alert")).toContainText(
    "disk failure",
  );
  expect(
    await repository(
      page,
      "return store.getSnapshot().entries.reduce((n,e)=>n+(e.reviewCount??0),0)",
    ),
  ).toBe(0);
  await repository(page, "store.db.append=store.db.restoreAppend;");
  await page
    .getByRole("button", { name: "记录结果并继续", exact: true })
    .click();
  await expect(page.locator(".self-review")).toHaveCount(0);
  expect(
    await repository(
      page,
      "return store.getSnapshot().entries.reduce((n,e)=>n+(e.reviewCount??0),0)",
    ),
  ).toBe(1);
});
test("capture templates preserve selected text and use the native undo stack", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".capture-button").click();
  const form = page.getByRole("dialog", {
      name: "捕捉一个新的概念",
      exact: true,
    }),
    body = form.locator("textarea");
  await body.fill("已有原始材料，必须保留。");
  await body.selectText();
  await form
    .getByLabel("插入录入模板", { exact: true })
    .selectOption("concept");
  await expect(body).toContainText("已有原始材料，必须保留。");
  expect(await body.inputValue()).toContain("## 一句话解释");
  await body.press("Control+z");
  await expect(body).toHaveValue("已有原始材料，必须保留。");
});

test("activity calendar has one keyboard stop, live day records and mobile-contained scrolling", async ({
  page,
}) => {
  await seed(page);
  const calendar = page.locator(".study-calendar");
  await expect(calendar).toBeVisible();
  await expect(calendar.locator('button[tabindex="0"]')).toHaveCount(1);
  const current = calendar.locator('button[tabindex="0"]');
  const day = await current.getAttribute("data-day");
  await current.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(calendar.locator('button[tabindex="0"]')).not.toHaveAttribute(
    "data-day",
    day!,
  );
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(calendar.locator('button[tabindex="0"]')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".study-activity-stats")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".study-calendar-scroll")
        .evaluate((node) => node.scrollLeft),
    )
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "新建词条", exact: true }).click();
  const capture = page.getByRole("dialog", {
    name: "捕捉一个新的概念",
    exact: true,
  });
  await capture
    .getByLabel("插入录入模板", { exact: true })
    .selectOption("reading");
  expect(await capture.locator("textarea").inputValue()).toContain("##");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
