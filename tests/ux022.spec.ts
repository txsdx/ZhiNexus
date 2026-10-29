/** End-to-end command, draft, Markdown and bulk safety regressions exercise the actual application repositories. */
import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { repository } from "./helpers/ai-stream";

test("command palette is keyboard accessible, jumps to settings and restores focus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.locator(".search-box input").focus();
  await page.keyboard.press("Control+Shift+P");
  const picker = page.getByRole("dialog", { name: "命令面板", exact: true }),
    input = picker.getByRole("combobox");
  await expect(input).toBeFocused();
  await input.fill("复习与记忆");
  await input.press("Enter");
  await expect(page.locator('[data-settings-tab="memory"]')).toHaveClass(
    /active/,
  );
  await page.keyboard.press("Control+Shift+P");
  await expect(picker).toBeVisible();
  await picker.getByRole("combobox").fill("知识星图");
  await picker.getByRole("combobox").dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
});

test("capture formatting is undoable, safe to preview, and persists exact Markdown", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".capture-button").click();
  const form = page.getByRole("dialog", {
      name: "捕捉一个新的概念",
      exact: true,
    }),
    body = form.locator("textarea");
  await body.fill("选择的内容");
  await body.selectText();
  await body.press("Control+b");
  await expect(body).toHaveValue("**选择的内容**");
  await body.press("Control+z");
  await expect(body).toHaveValue("选择的内容");
  await body.fill("# 标题\n\n**粗体** <script>window.badPreview=1</script>");
  await form.getByRole("button", { name: "预览", exact: true }).click();
  await expect(form.locator(".capture-markdown-preview h1")).toHaveText("标题");
  expect(await page.evaluate(() => (window as any).badPreview)).toBeUndefined();
  await form.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(body).toHaveValue(
    "# 标题\n\n**粗体** <script>window.badPreview=1</script>",
  );
});

test("chat drafts survive navigation and reload, export excludes raw tools, reuse preserves unsent text", async ({
  page,
}) => {
  await page.goto("/");
  await repository(
    page,
    `await store.patch('topic','durable',{entryId:'',title:'持久会话',titleMode:'manual',messages:[{role:'user',content:'旧提问'},{role:'assistant',content:'完整回答'},{role:'tool',content:'INTERNAL_TOOL_DATA'}],updatedAt:new Date().toISOString()});`,
  );
  await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
  const input = page.locator(".chat-input textarea");
  await expect(input).toBeEditable();
  await input.fill("尚未发送的文字");
  await page.getByRole("button", { name: "再次提问", exact: true }).click();
  await expect(input).toHaveValue("尚未发送的文字\n\n旧提问");
  await expect(input).toBeFocused();
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
  await expect(input).toHaveValue("尚未发送的文字\n\n旧提问");
  await expect
    .poll(() =>
      repository(
        page,
        "return Object.values(await store.db.local('chat-drafts-v1',{})).some(d=>d.text==='尚未发送的文字\\n\\n旧提问')",
      ),
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
  await expect(input).toHaveValue("尚未发送的文字\n\n旧提问");
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出对话 Markdown", exact: true })
    .click();
  const download = await downloadEvent,
    content = await fs.readFile((await download.path())!, "utf8");
  expect(content).toContain("旧提问");
  expect(content).toContain("完整回答");
  expect(content).not.toContain("INTERNAL_TOOL_DATA");
});

test("bulk deletion waits for consent and rejects changed selections atomically", async ({
  page,
}) => {
  await page.goto("/");
  await repository(
    page,
    `await store.createEntry('选择一','内容');await store.createEntry('选择二','内容');`,
  );
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await page.getByRole("button", { name: "选择词条", exact: true }).click();
  await page.getByLabel("全选当前结果", { exact: false }).check();
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  expect(
    await repository(page, "return store.getSnapshot().entries.length"),
  ).toBe(2);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  expect(
    await repository(page, "return store.getSnapshot().entries.length"),
  ).toBe(2);
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  await repository(
    page,
    `await store.patch('entry',store.getSnapshot().entries[0].id,{title:'并发修改'});`,
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("已改变");
  expect(
    await repository(page, "return store.getSnapshot().entries.length"),
  ).toBe(2);
});

test("graph search selects and centers a node without changing stored layout", async ({
  page,
}) => {
  await page.goto("/");
  await repository(
    page,
    `await store.createEntry('远处目标','目标解释'); await store.patch('setting','graph',{[store.getSnapshot().entries[0].id]:{x:3000,y:2000}});`,
  );
  await page.getByRole("button", { name: "知识星图", exact: true }).click();
  const before = await repository(
    page,
    `return JSON.stringify(store.getSnapshot().docs.find(d=>d.collection==='setting'&&d.id==='graph'));`,
  );
  await expect(page.locator(".react-flow__viewport")).toBeVisible();
  await page.keyboard.press("Control+f");
  const picker = page.getByRole("dialog", {
    name: "查找星图节点",
    exact: true,
  });
  await picker.getByRole("combobox").fill("远处目标");
  await picker.getByRole("combobox").press("Enter");
  await expect(page.locator(".react-flow__node.selected")).toContainText(
    "远处目标",
  );
  expect(
    await repository(
      page,
      `return JSON.stringify(store.getSnapshot().docs.find(d=>d.collection==='setting'&&d.id==='graph'));`,
    ),
  ).toBe(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight - innerHeight,
    ),
  ).toBeLessThanOrEqual(1);
});

test.describe("mobile page scale", () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  test("real touch pinch keeps page scale at one and preserves graph internal zoom", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".app-shell")).toBeVisible();
    const client = await page.context().newCDPSession(page);
    const pinch = async (x: number, y: number, inward = false) => {
      const distance = (n: number) => (inward ? 94 - n * 8 : 30 + n * 8);
      await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          { x: x - distance(0), y, id: 0 },
          { x: x + distance(0), y, id: 1 },
        ],
      });
      for (let n = 1; n <= 8; n++) {
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            { x: x - distance(n), y, id: 0 },
            { x: x + distance(n), y, id: 1 },
          ],
        });
      }
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
    };
    await pinch(195, 380);
    expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await repository(page, `await store.createEntry('手势目标','内容');`);
    await page.getByRole("button", { name: "知识星图", exact: true }).click();
    await expect(page.locator(".react-flow__viewport")).toBeVisible();
    const previous = await page
      .locator(".react-flow__viewport")
      .getAttribute("style");
    await pinch(195, 630, true);
    await expect
      .poll(() => page.locator(".react-flow__viewport").getAttribute("style"))
      .not.toBe(previous);
    expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  });
});

test("review intervals use FSRS and numeric rating never commits by itself", async ({
  page,
}) => {
  await page.goto("/");
  await repository(
    page,
    `const id=await store.createEntry('复习预览','原始正文'); await store.patch('review','rating',{entryId:id,phase:'graded',question:{question:'问题',type:'short',choices:[],answer:'答案',rubric:'机制'},answer:'作答',grade:{score:85,feedback:'反馈',missing:'',lesson:'补教'},startedAt:new Date().toISOString()});`,
  );
  await page.getByRole("button", { name: /^复习队列/ }).click();
  await expect(page.locator(".recall-rating .rating-interval")).toHaveCount(4);
  const before = await repository(
    page,
    "return JSON.stringify(store.getSnapshot().entries)",
  );
  await page.keyboard.press("2");
  await expect(page.locator(".recall-rating button").nth(1)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await repository(
      page,
      "return JSON.stringify(store.getSnapshot().entries)",
    ),
  ).toBe(before);
});

test("task filters preserve the durable queue while filtering title and status", async ({
  page,
}) => {
  await page.goto("/");
  await repository(
    page,
    `const {aiJobs}=await import('/src/services/ai-jobs.ts'); await aiJobs.init(); await aiJobs.submit({kind:'explain',title:'等待解释的词条',target:{page:'entry',entryId:'missing-a'},input:{},base:{}});await aiJobs.submit({kind:'explain',title:'分类整理',target:{page:'entry',entryId:'missing-b'},input:{},base:{}});`,
  );
  await page
    .getByRole("button", { name: "打开 AI 任务队列", exact: true })
    .click();
  await expect(page.locator(".ai-job-card")).toHaveCount(2);
  await page.getByLabel("搜索任务", { exact: true }).fill("分类");
  await expect(page.locator(".ai-job-card")).toHaveCount(1);
  await page.getByLabel("任务状态", { exact: true }).selectOption("review");
  await expect(page.locator(".ai-job-card")).toHaveCount(0);
  await page.getByLabel("搜索任务", { exact: true }).clear();
  await page.getByLabel("任务状态", { exact: true }).selectOption("all");
  await expect(page.locator(".ai-job-card")).toHaveCount(2);
});

test.describe("mobile ordinary scrolling", () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  test("one-finger swipes still scroll a long knowledge list", async ({
    page,
  }) => {
    await page.goto("/");
    await repository(
      page,
      `for(let n=0;n<24;n++)await store.createEntry('滚动条目'+n,'正文');`,
    );
    await page.getByRole("button", { name: "我的知识库", exact: true }).click();
    await expect(page.locator(".entry-row")).toHaveCount(24);
    const client = await page.context().newCDPSession(page);
    const before = await page.evaluate(
      () => document.scrollingElement!.scrollTop,
    );
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 220, y: 650, id: 0 }],
    });
    for (let n = 1; n <= 10; n++)
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: 220, y: 650 - n * 35, id: 0 }],
      });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() => page.evaluate(() => document.scrollingElement!.scrollTop))
      .toBeGreaterThan(before);
    expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  });
});
