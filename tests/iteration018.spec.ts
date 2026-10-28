/** New iteration acceptance: nested category picker, preserve-first deletion, menus, full-window graph and curves. */
import { test, expect } from "@playwright/test";
import { repository, configure } from "./helpers/ai-stream";
async function seed(page: import("@playwright/test").Page) {
  return repository<string>(
    page,
    `await store.updateDevice({syncMinutes:0});await store.patch('category','root',{name:'大类',parent:''});await store.patch('category','child',{name:'子类',parent:'root'});return await store.createEntry('安全过滤器（Safety Filter）',${JSON.stringify("## 解释\n\n这是需要解释的原始句子。")},'test','child');`,
  );
}
test("capture uses a roomy shared tree picker; nested cancellation keeps the draft and new knowledge is not immediately due", async ({
  page,
}) => {
  await page.goto("/");
  await seed(page);
  await page.getByRole("button", { name: "记录新知识" }).click();
  const capture = page.getByRole("dialog", { name: "捕捉一个新的概念" });
  expect((await capture.boundingBox())!.width).toBeGreaterThan(700);
  await capture.getByLabel("概念 / 知识名称").fill("保留的新知识");
  await capture.locator("textarea").fill("先记录我的理解");
  await capture.getByRole("button", { name: "选择所属分类" }).click();
  const picker = page.getByRole("dialog", { name: "选择分类", exact: true });
  await picker.getByRole("searchbox").fill("子类");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(capture).toBeVisible();
  await expect(capture.getByLabel("概念 / 知识名称")).toHaveValue(
    "保留的新知识",
  );
  await capture.getByRole("button", { name: "选择所属分类" }).click();
  await picker.getByRole("treeitem", { name: "子类", exact: true }).click();
  await capture.getByRole("button", { name: "保存到知识库" }).click();
  await expect(capture).toHaveCount(0);
  const record = await repository<{
    category: string;
    reviews: number;
    future: boolean;
  }>(
    page,
    `const e=store.getSnapshot().entries.find(e=>e.title==='保留的新知识');return {category:e.category,reviews:e.reviewCount,future:e.card.due>new Date()};`,
  );
  expect(record).toEqual({ category: "child", reviews: 0, future: true });
  await expect(page.getByRole("region", { name: "词条信息" })).toHaveCount(0);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "选择所属分类" }).click();
  await picker.getByRole("treeitem", { name: "大类", exact: true }).click();
  await expect
    .poll(() =>
      repository(
        page,
        `return store.getSnapshot().entries.find(e=>e.title==='保留的新知识').category;`,
      ),
    )
    .toBe("root");
});
test("tree dragging rejects cycles and Enter deletion promotes content without deleting descendants", async ({
  page,
}) => {
  await page.goto("/");
  const id = await seed(page);
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page.getByRole("button", { name: "知识分类", exact: true }).click();
  const root = page.locator('.category-tree [data-category-id="root"]'),
    child = page.locator('.category-tree [data-category-id="child"]');
  await root.dragTo(child);
  await expect(page.getByRole("alert")).toContainText("不能把分类移动");
  expect(
    await repository(
      page,
      `return store.getSnapshot().categories.find(c=>c.id==='root').parent;`,
    ),
  ).toBe("");
  await child.dragTo(page.locator(".tree-root-drop"));
  await expect
    .poll(() =>
      repository(
        page,
        `return store.getSnapshot().categories.find(c=>c.id==='child').parent;`,
      ),
    )
    .toBe("");
  await child.dragTo(root);
  await expect
    .poll(() =>
      repository(
        page,
        `return store.getSnapshot().categories.find(c=>c.id==='child').parent;`,
      ),
    )
    .toBe("root");
  await page
    .getByRole("button", { name: "删除树分类 大类", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "确认删除", exact: true });
  await expect(dialog).toBeVisible();
  expect(
    await repository(page, `return store.getSnapshot().categories.length;`),
  ).toBe(2);
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      repository(
        page,
        `return store.getSnapshot().categories.find(c=>c.id==='child')?.parent;`,
      ),
    )
    .toBe("");
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.some(e=>e.id==='${id}');`,
    ),
  ).toBe(true);
});
test("context menus persist soft colors; graph is a full viewport without header clutter, with graph commands in its menu", async ({
  page,
}) => {
  await page.goto("/");
  await seed(page);
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  const row = page.locator(".entry-row").first();
  await row.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "背景颜色", exact: true }).click();
  await menu.getByRole("menuitem", { name: "浅蓝", exact: true }).click();
  await expect(row).toHaveAttribute("data-entry-color", "blue");
  await page.reload();
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await expect(page.locator(".entry-row").first()).toHaveAttribute(
    "data-entry-color",
    "blue",
  );
  await expect(page.locator(".knowledge-table th")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /下次复习/ })).toBeVisible();
  await expect(page.locator(".next-review-cell")).toContainText("天");
  const scroller = page.locator(".knowledge-table-scroll");
  await expect(scroller).not.toHaveClass(/horizontal-overflow/);
  await scroller.evaluate((element: HTMLElement) => {
    element.style.maxWidth = "400px";
  });
  await expect(scroller).toHaveClass(/horizontal-overflow/);
  expect(
    await row.locator(".entry-title-cell button").evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return [2, rect.height / 2, rect.height - 2].every((offset) =>
        button.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + offset),
        ),
      );
    }),
  ).toBe(true);
  await scroller.evaluate((element: HTMLElement) => {
    element.style.maxWidth = "";
  });
  await expect(scroller).not.toHaveClass(/horizontal-overflow/);
  await page.getByRole("button", { name: "知识星图", exact: true }).click();
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(
    page.locator(".graph-page h1,.graph-page .page-heading"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight,
    ),
  ).toBeLessThanOrEqual(1);
  await page
    .locator(".react-flow__pane")
    .click({ button: "right", position: { x: 20, y: 20 } });
  await expect(
    menu.getByRole("menuitem", { name: "自动整理布局", exact: true }),
  ).toBeVisible();
  await menu.getByRole("menuitem", { name: "适应窗口", exact: true }).click();
  await page.screenshot({ path: "test-results/graph-0.18.png" });
});
test("entry AI opens beside the explanation and the forgetting page supports time panning and entry links", async ({
  page,
}) => {
  await page.goto("/");
  await seed(page);
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await page.locator(".entry-row").first().click();
  await page.getByRole("button", { name: "AI 对话", exact: true }).click();
  const sidebar = page.getByRole("complementary", { name: "词条 AI 侧栏" });
  await expect(sidebar).toBeVisible();
  await expect(page.locator(".entry-heading h1")).toHaveText(
    "安全过滤器（Safety Filter）",
  );
  await expect(page.locator(".app-shell")).not.toHaveClass(/chat-workspace/);
  await sidebar.getByRole("button", { name: "展开会话列表" }).click();
  await expect(
    sidebar.getByRole("complementary", { name: "会话列表" }),
  ).toBeVisible();
  await sidebar.getByRole("button", { name: "收起会话列表" }).click();
  await page.getByRole("button", { name: "关闭 AI 侧栏" }).click();
  await page.getByRole("button", { name: "遗忘曲线", exact: true }).click();
  await expect(page.locator(".curve-plot svg path")).toHaveCount(1);
  const before = await page
    .locator("[data-axis-time]")
    .first()
    .getAttribute("data-axis-time");
  await page.locator(".curve-plot").hover();
  await page.mouse.wheel(0, 200);
  await expect
    .poll(() =>
      page.locator("[data-axis-time]").first().getAttribute("data-axis-time"),
    )
    .not.toBe(before);
  await expect(page.locator("[data-review-threshold]")).toHaveAttribute(
    "data-review-threshold",
    "0.9",
  );
  await page.locator(".curve-legend button").first().click();
  await expect(page.locator(".entry-heading h1")).toBeVisible();
});
