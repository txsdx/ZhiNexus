/** Keyboard, nested-tree, draft-editing and history acceptance for the 0.18 iteration. */
import { test, expect } from "@playwright/test";
import { repository, configure, isTitleRequest } from "./helpers/ai-stream";

/** Open knowledge through its actual list while disabling unrelated network timers. */
async function entry(page: import("@playwright/test").Page) {
  await page.goto("/");
  const id = await repository<string>(
    page,
    `await store.updateDevice({syncMinutes:0});await store.patch('category','root',{name:'父分类',parent:''});await store.patch('category','child',{name:'子分类',parent:'root'});return store.createEntry('上下文测试',${JSON.stringify("## 正文\n\n待修改的片段。保留其他内容。")},'test','child');`,
  );
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await page.locator(".entry-title-cell button").click();
  return id;
}

test("the shared picker collapses descendants, supports arrow navigation and preserves edits when saving a category fails", async ({
  page,
}) => {
  const id = await entry(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".title-input").fill("标题草稿");
  await page.getByRole("button", { name: "选择所属分类" }).click();
  const picker = page.getByRole("dialog", { name: "选择分类", exact: true });
  const root = picker.getByRole("treeitem", { name: "父分类", exact: true });
  await root.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    picker.getByRole("treeitem", { name: "子分类", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(
    picker.getByRole("treeitem", { name: "子分类", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(
    picker.getByRole("treeitem", { name: "子分类", exact: true }),
  ).toBeFocused();
  await repository(
    page,
    "store.db.originalAppend=store.db.append;store.db.append=async()=>{throw Error('category write failed')}",
  );
  await root.click();
  await expect(picker.getByRole("alert")).toContainText(
    "category write failed",
  );
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${id}').category`,
    ),
  ).toBe("child");
  await page.keyboard.press("Escape");
  await expect(page.locator(".title-input")).toHaveValue("标题草稿");
  await repository(page, "store.db.append=store.db.originalAppend");
});

test("confirmation ignores composing, repeated and modified Enter, and explicit subtree deletion removes all content atomically", async ({
  page,
}) => {
  await entry(page);
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page.getByRole("button", { name: "知识分类", exact: true }).click();
  await page
    .getByRole("button", { name: "删除树分类 父分类", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "确认删除", exact: true });
  for (const properties of [
    { isComposing: true },
    { repeat: true },
    { ctrlKey: true },
  ]) {
    await dialog.evaluate(
      (element, properties) =>
        element.querySelector("[data-confirm]")!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
            ...properties,
          }),
        ),
      properties,
    );
    await expect(dialog).toBeVisible();
    expect(
      await repository(page, "return store.getSnapshot().categories.length"),
    ).toBe(2);
  }
  await dialog.getByRole("button", { name: "取消", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(
    await repository(page, "return store.getSnapshot().entries.length"),
  ).toBe(1);
  await page
    .getByRole("button", { name: "删除树分类 父分类", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "删除全部条目和子分类", exact: true })
    .click();
  await expect
    .poll(() =>
      repository(
        page,
        "return [store.getSnapshot().categories.length,store.getSnapshot().entries.length]",
      ),
    )
    .toEqual([0, 0]);
  await page.reload();
  expect(
    await repository(
      page,
      "return [store.getSnapshot().categories.length,store.getSnapshot().entries.length]",
    ),
  ).toEqual([0, 0]);
});

test("entry chat sees the selected passage and unsaved draft, reviews edits into a local draft, and saves only explicitly", async ({
  page,
}) => {
  const id = await entry(page);
  await configure(page, "https://ai.example/v1");
  let prompt = "",
    calls = 0;
  await page.route("https://ai.example/**", async (route) => {
    const body = route.request().postDataJSON();
    if (isTitleRequest(body)) {
      await route.fulfill({
        json: { choices: [{ message: { content: '{"title":"解释讨论"}' } }] },
      });
      return;
    }
    prompt += JSON.stringify(body.messages);
    const message =
      calls++ === 0
        ? {
            content: "准备修改",
            tool_calls: [
              {
                id: "same-provider-call",
                type: "function",
                function: {
                  name: "edit_explanation",
                  arguments: JSON.stringify({
                    id,
                    selected: "待修改的片段",
                    replacement: "AI 修改后的片段",
                  }),
                },
              },
            ],
          }
        : { content: "已经放入草稿，请检查后保存。" };
    await route.fulfill({ json: { choices: [{ message }] } });
  });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".title-input").fill("尚未保存的标题");
  await page.locator(".block-document").evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode()))
      if (node.textContent?.includes("待修改的片段")) {
        const at = node.textContent.indexOf("待修改的片段"),
          range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 7);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        break;
      }
  });
  await page
    .getByRole("toolbar", { name: "划词工具", exact: true })
    .getByRole("button", { name: "AI 对话", exact: true })
    .click();
  const sidebar = page.getByRole("complementary", { name: "词条 AI 侧栏" });
  await expect(sidebar.locator(".chat-selection-context")).toContainText(
    "待修改的片段",
  );
  await sidebar.locator(".chat-input textarea").fill("替换选中的内容");
  await sidebar.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    sidebar.getByRole("button", { name: "确认 Agent 操作", exact: true }),
  ).toBeVisible();
  expect(prompt).toContain("尚未保存的标题");
  expect(prompt).toContain("保留其他内容");
  const approval = page.getByRole("dialog");
  await expect(approval).toContainText("AI 修改后的片段");
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${id}').content`,
    ),
  ).toContain("待修改的片段");
  await approval
    .getByRole("button", { name: "允许本次", exact: true })
    .press("Enter");
  await expect(page.locator(".block-document")).toContainText(
    "AI 修改后的片段",
  );
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${id}').content`,
    ),
  ).not.toContain("AI 修改后的片段");
  await page.getByRole("button", { name: "关闭 AI 侧栏" }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() =>
      repository(
        page,
        `return store.getSnapshot().entries.find(e=>e.id==='${id}').content`,
      ),
    )
    .toContain("AI 修改后的片段");
  await page.reload();
  await expect(page.locator(".block-document")).toContainText("保留其他内容");
});

test("Alt arrows and mouse side buttons restore pages, selected editor positions and unsaved text without browser navigation", async ({
  page,
}) => {
  await entry(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const title = page.locator(".title-input");
  await title.fill("保留编辑和选中位置");
  await title.evaluate((input: HTMLInputElement) => {
    input.focus();
    input.setSelectionRange(2, 5);
    input.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const input = document.activeElement as HTMLInputElement;
        return [input.selectionStart, input.selectionEnd];
      }),
    )
    .toEqual([2, 5]);
  await page.waitForTimeout(50);
  await page.getByRole("button", { name: "学习概览", exact: true }).click();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(title).toHaveValue("保留编辑和选中位置");
  await expect
    .poll(() =>
      title.evaluate((input: HTMLInputElement) => [
        input.selectionStart,
        input.selectionEnd,
      ]),
    )
    .toEqual([2, 5]);
  await page.keyboard.press("Alt+ArrowRight");
  await expect(
    page.getByRole("heading", { name: "学习概览", exact: true }),
  ).toBeVisible();
  const prevented = await page.evaluate(
    () =>
      !document.dispatchEvent(
        new MouseEvent("mousedown", {
          button: 3,
          bubbles: true,
          cancelable: true,
        }),
      ),
  );
  expect(prevented).toBe(true);
  await expect(title).toHaveValue("保留编辑和选中位置");
  await page.evaluate(() =>
    document.dispatchEvent(
      new MouseEvent("mousedown", {
        button: 4,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await expect(
    page.getByRole("heading", { name: "学习概览", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
});

test("retention changes update the curve threshold and due queue; explicit Again updates the curve and actual review count once", async ({
  page,
}) => {
  const id = await entry(page);
  await repository(
    page,
    `const {rememberedCard}=await import('/src/core/review.ts');await store.patch('entry','${id}',{card:JSON.parse(JSON.stringify({...rememberedCard(new Date(Date.now()-86400000)),stability:3,due:new Date(Date.now()+20*86400000)}))});`,
  );
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page.getByRole("button", { name: "复习与记忆", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "期望保留率（复习阈值）" })
    .fill("95");
  await expect
    .poll(() =>
      repository(
        page,
        `return store.getSnapshot().docs.find(d=>d.collection==='setting'&&d.id==='review-policy')?.fields.retention`,
      ),
    )
    .toBe(0.95);
  await page.getByRole("button", { name: "遗忘曲线", exact: true }).click();
  await expect(page.locator("[data-review-threshold]")).toHaveAttribute(
    "data-review-threshold",
    "0.95",
  );
  await page
    .getByRole("spinbutton", { name: "当前回忆概率上限", exact: true })
    .fill("1");
  await expect(page.locator(".curve-plot svg path")).toHaveCount(0);
  await page
    .getByRole("spinbutton", { name: "当前回忆概率上限", exact: true })
    .fill("100");
  await expect(page.locator(".curve-plot svg path")).toHaveCount(1);
  const card = await repository<any>(
    page,
    `return store.getSnapshot().entries.find(e=>e.id==='${id}').card`,
  );
  await repository(
    page,
    `await store.patch('review','self-rate',{entryId:'${id}',phase:'graded',question:{question:'请回忆',type:'short',choices:[],answer:'答案',rubric:'理解'},answer:'回答',grade:{score:95,feedback:'AI建议良好',missing:'',lesson:''},startedAt:new Date().toISOString()});`,
  );
  await page.getByRole("button", { name: /^复习队列/ }).click();
  await page.getByRole("button", { name: /忘记/ }).click();
  await page.getByRole("button", { name: "记录结果并继续" }).click();
  await expect
    .poll(() =>
      repository(
        page,
        `return store.getSnapshot().entries.find(e=>e.id==='${id}').reviewCount`,
      ),
    )
    .toBe(1);
  const result = await repository<any>(
    page,
    `return {card:store.getSnapshot().entries.find(e=>e.id==='${id}').card,rating:store.getSnapshot().reviews.find(r=>r.id==='self-rate').rating}`,
  );
  expect(result.rating).toBe(1);
  expect(result.card.reps).toBe(card.reps + 1);
  expect(result.card.lapses).toBe(card.lapses + 1);
});

test("custom editor menus preserve selection for clipboard operations, paste literal text safely and support undo", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await entry(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByRole("button", { name: "Markdown 源码", exact: true })
    .click();
  const source = page.getByRole("textbox", { name: "Markdown", exact: true });
  await source.fill("复制这段，其他保留");
  await source.evaluate((input: HTMLTextAreaElement) => {
    input.focus();
    input.setSelectionRange(0, 4);
    input.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 600,
        clientY: 450,
      }),
    );
  });
  await page
    .getByRole("menuitem", { name: "复制所选文本", exact: true })
    .click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "复制这段",
  );
  await source.evaluate((input: HTMLTextAreaElement) =>
    input.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 600,
        clientY: 450,
      }),
    ),
  );
  await page.getByRole("menuitem", { name: "剪切", exact: true }).click();
  await expect(source).toHaveValue("，其他保留");
  await page.evaluate(() => navigator.clipboard.writeText("<b>按字面粘贴</b>"));
  await source.evaluate((input: HTMLTextAreaElement) =>
    input.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 600,
        clientY: 450,
      }),
    ),
  );
  await page.getByRole("menuitem", { name: "粘贴", exact: true }).click();
  await expect(source).toHaveValue("<b>按字面粘贴</b>，其他保留");
  await source.fill("富文本需要保留");
  await page.getByRole("button", { name: "所见即所得", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "所见即所得编辑器",
    exact: true,
  });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.evaluate(() =>
    navigator.clipboard.writeText("<script>这是文本</script>"),
  );
  await editor.evaluate((element) =>
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 600,
        clientY: 450,
      }),
    ),
  );
  await page.getByRole("menuitem", { name: "粘贴", exact: true }).click();
  await expect(editor).toContainText("<script>这是文本</script>");
  await expect(editor.locator("script")).toHaveCount(0);
  await editor.evaluate((element) =>
    element.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 600,
        clientY: 450,
      }),
    ),
  );
  await page.getByRole("menuitem", { name: "撤销", exact: true }).click();
  await expect(editor).not.toContainText("这是文本");
  await expect(editor).toContainText("富文本需要保留");
});
