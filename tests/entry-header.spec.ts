/** Compact entry metadata and direct, isolated entry conversations without losing local edits. */
import { test, expect } from "@playwright/test";
import { repository, configure } from "./helpers/ai-stream";

/** Seed two independent entries and existing scoped conversations. */
async function seed(page: import("@playwright/test").Page) {
  return repository<{ a: string; b: string }>(
    page,
    `
    await store.patch('category','controls',{name:'机器人安全与控制',parent:''});
    const a=await store.createEntry('安全过滤器','安全约束正文 A'), b=await store.createEntry('概率模型','概率正文 B');
    await store.patch('entry',a,{category:'controls',tags:['控制','安全']});
    for (const [id,entryId,title,text] of [['topic-a',a,'过滤器讨论','A 专属记录'],['topic-b',b,'概率讨论','B 专属记录'],['topic-global','','全局讨论','全局记录']])
      await store.patch('topic',id,{entryId,title,titleMode:'manual',titleGenerated:true,messages:[{role:'user',content:text},{role:'assistant',content:text+'的回答'}],updatedAt:new Date().toISOString()});
    return {a,b};
  `,
  );
}

/** Open the saved entry using the same knowledge list as the user. */
async function openEntry(page: import("@playwright/test").Page, title: string) {
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await page.locator(".entry-row").filter({ hasText: title }).click();
  await expect(page.locator(".entry-heading")).toBeVisible();
}

test("entry metadata shares the title row and actions stay together without overflowing smaller screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/");
  await seed(page);
  await openEntry(page, "安全过滤器");
  for (const width of [1920, 1440]) {
    await page.setViewportSize({ width, height: 1080 });
    const title = await page.locator(".entry-heading h1").boundingBox(),
      meta = await page.locator(".entry-meta").boundingBox();
    expect(meta!.x).toBeGreaterThan(title!.x + title!.width);
    expect(meta!.y).toBeLessThan(title!.y + title!.height);
    expect(meta!.y + meta!.height).toBeGreaterThan(title!.y);
  }
  const edit = await page
      .getByRole("button", { name: "编辑", exact: true })
      .boundingBox(),
    chat = await page
      .getByRole("button", { name: "AI 对话", exact: true })
      .boundingBox();
  expect(Math.abs(edit!.y - chat!.y)).toBeLessThan(1);
  await expect(
    page
      .getByRole("region", { name: "词条信息", exact: true })
      .getByLabel("所属分类"),
  ).toHaveValue("controls");
  await expect(
    page.locator(".entry-meta").getByLabel("标签（逗号分隔）"),
  ).toHaveValue("控制, 安全");
  await page.screenshot({ path: "test-results/entry-header-desktop.png" });
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.body.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const area = await page.locator(".entry-meta").boundingBox();
    expect(area!.x).toBeGreaterThanOrEqual(0);
    expect(area!.x + area!.width).toBeLessThanOrEqual(width);
    await expect(
      page.getByRole("button", { name: "AI 对话", exact: true }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/entry-header-mobile.png" });
});

test("entry AI button opens its own history and provider context, while returning retains unsaved edits", async ({
  page,
}) => {
  await page.goto("/");
  const { a, b } = await seed(page);
  await configure(page, "https://ai.example/v1");
  let prompt = "";
  await page.route("https://ai.example/**", async (route) => {
    prompt = JSON.stringify(route.request().postDataJSON().messages);
    await route.fulfill({
      json: {
        choices: [{ message: { content: "已结合当前词条", tool_calls: null } }],
      },
    });
  });
  await openEntry(page, "安全过滤器");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .locator(".entry-heading .title-input")
    .fill("安全过滤器（本机草稿）");
  await page.getByRole("button", { name: "AI 对话", exact: true }).click();
  await expect(page.locator(".topic-title")).toHaveText("过滤器讨论");
  await expect(page.locator(".messages")).toContainText("A 专属记录");
  await expect(page.locator(".messages")).not.toContainText("B 专属记录");
  await expect(page.locator(".messages")).not.toContainText("全局记录");
  await page.locator(".chat-input textarea").fill("解释安全约束");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".messages")).toContainText("已结合当前词条");
  expect(prompt).toContain("安全约束正文 A");
  expect(prompt).not.toContain("概率正文 B");
  await expect
    .poll(() =>
      repository(
        page,
        `return store.getSnapshot().topics.find(t=>t.id==='topic-a').messages.at(-1).content`,
      ),
    )
    .toBe("已结合当前词条");
  await page
    .getByRole("button", { name: "返回词条：安全过滤器", exact: true })
    .click();
  await expect(page.locator(".entry-heading .title-input")).toHaveValue(
    "安全过滤器（本机草稿）",
  );
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${a}').title`,
    ),
  ).toBe("安全过滤器");
  await openEntry(page, "概率模型");
  await page.getByRole("button", { name: "AI 对话", exact: true }).click();
  await expect(page.locator(".topic-title")).toHaveText("概率讨论");
  await expect(page.locator(".messages")).toContainText("B 专属记录");
  await expect(page.locator(".messages")).not.toContainText("A 专属记录");
  await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
  await expect(page.locator(".topic-title")).toHaveText("全局讨论");
  await expect(page.locator(".messages")).toContainText("全局记录");
  expect(
    await repository(
      page,
      `return store.getSnapshot().topics.find(t=>t.id==='topic-b').entryId`,
    ),
  ).toBe(b);
});
