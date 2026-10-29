/** Real file conversion, resumable media drafts and a capture-only popup share one authoritative writer. */
import { test, expect, type Page, type Locator } from "@playwright/test";
import fs from "node:fs";
import { repository } from "./helpers/ai-stream";
import { captureDocx } from "./helpers/capture-files";
const image = () => fs.readFileSync("public/app-icon.png");
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "捕捉一个新的概念", exact: true });
async function capture(page: Page) {
  await page.locator(".capture-button").click();
  await expect(dialog(page).getByLabel("概念 / 知识名称")).toBeVisible();
  return dialog(page);
}
async function pasteImage(target: Locator) {
  await target.evaluate(
    (node, bytes) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array(bytes)], "图片.png", { type: "image/png" }),
      );
      node.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [...image()],
  );
}
async function drop(
  target: Locator,
  name: string,
  mime: string,
  bytes: Uint8Array,
) {
  const data = await target.page().evaluateHandle(
    ({ name, mime, bytes }) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], name, { type: mime }));
      return data;
    },
    { name, mime, bytes: [...bytes] },
  );
  try {
    await target.dispatchEvent("drop", { dataTransfer: data });
  } finally {
    await data.dispose();
  }
}
test("pasted images remain local with the full draft across close/reload, then promote only when the entry is saved", async ({
  page,
}) => {
  await page.goto("/");
  await repository(
    page,
    `await store.patch('category','notes',{name:'素材',parent:''});`,
  );
  let form = await capture(page);
  await form.getByLabel("概念 / 知识名称").fill("图片草稿");
  await form.locator("textarea").fill("原始材料");
  await form.getByRole("button", { name: "选择所属分类" }).click();
  await page
    .getByRole("dialog", { name: "选择分类", exact: true })
    .getByRole("treeitem", { name: "素材", exact: true })
    .click();
  await pasteImage(form.locator("textarea"));
  await expect(form.locator(".capture-image img")).toBeVisible();
  expect(
    await repository(page, `return (await store.db.blobHashes()).length;`),
  ).toBe(0);
  await form.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  form = await capture(page);
  await expect(form.getByLabel("概念 / 知识名称")).toHaveValue("图片草稿");
  await expect(form.locator("textarea")).toHaveValue(/原始材料/);
  await expect(form.getByLabel("完整分类路径")).toContainText("素材");
  await expect(form.locator(".capture-image img")).toBeVisible();
  await form.getByRole("button", { name: "保存到知识库", exact: true }).click();
  await expect(page.locator(".entry-heading h1")).toHaveText("图片草稿");
  const result = await repository<{
    entries: number;
    category: string;
    blobs: number;
  }>(
    page,
    `const s=store.getSnapshot();return {entries:s.entries.length,category:s.entries[0].category,blobs:(await store.db.blobHashes()).length};`,
  );
  expect(result).toEqual({ entries: 1, category: "notes", blobs: 1 });
  form = await capture(page);
  await expect(form.getByLabel("概念 / 知识名称")).toHaveValue("");
  await expect(form.locator("textarea")).toHaveValue("");
});
test("dragged Markdown and real DOCX preserve structure/images and cannot overwrite typing while conversion is pending", async ({
  page,
}) => {
  await page.goto("/");
  const form = await capture(page);
  await form.getByLabel("概念 / 知识名称").fill("手动标题");
  await form.locator("textarea").fill("手写材料");
  await drop(
    form.locator("textarea"),
    "笔记.md",
    "text/markdown",
    Buffer.from("## Markdown材料\n\n补充内容"),
  );
  await expect(form.locator("textarea")).toHaveValue(/Markdown材料/);
  await page.evaluate(async () => {
    const { captureRepository } = await import(
      "/src/services/capture-repository.ts" as string
    );
    const original = captureRepository.request.bind(captureRepository);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    (window as any).releaseCaptureImport = release;
    (window as any).captureImageStarted = false;
    captureRepository.request = async function (request: any) {
      if (request.type === "stage-image") {
        (window as any).captureImageStarted = true;
        await gate;
      }
      return original(request) as any;
    };
  });
  await drop(
    form.locator("textarea"),
    "结构文档.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    captureDocx(image()),
  );
  await page.waitForFunction(() => (window as any).captureImageStarted);
  await form.locator("textarea").fill("手写材料\n转换期间新输入");
  await page.evaluate(() => (window as any).releaseCaptureImport());
  await expect(form.locator("textarea")).toHaveValue(/# 文档标题/);
  const value = await form.locator("textarea").inputValue();
  for (const text of [
    "转换期间新输入",
    "**重要内容**",
    "_斜体解释_",
    "第一项",
    "第二项",
    "| 参数 | 说明 |",
    "https://example.com/reference",
    "asset:",
  ])
    expect(value).toContain(text);
  expect(value).not.toContain("javascript:");
  await expect(form.getByLabel("概念 / 知识名称")).toHaveValue("手动标题");
  await expect(form.locator(".capture-image img")).toBeVisible();
  expect(
    await repository(page, `return store.getSnapshot().entries.length;`),
  ).toBe(0);
});
test("corrupt imports and a failed draft write retain every input and prevent premature close", async ({
  page,
}) => {
  await page.goto("/");
  let form = await capture(page);
  await form.getByLabel("概念 / 知识名称").fill("保留草稿");
  await form.locator("textarea").fill("不能丢失");
  await drop(
    form.locator("textarea"),
    "损坏.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    Buffer.from("not a zip"),
  );
  await expect(form.locator(".capture-warnings")).toContainText("损坏.docx");
  await expect(form.locator("textarea")).toHaveValue("不能丢失");
  await page.evaluate(async () => {
    const { store } = await import("/src/core/store.ts" as string);
    const original = store.db.setLocal.bind(store.db);
    (window as any).restoreCapturePersistence = () =>
      (store.db.setLocal = original);
    store.db.setLocal = async (key, value) => {
      if (key === "capture-draft-v1") throw Error("draft disk full");
      return original(key, value);
    };
  });
  await form.locator("textarea").fill("失败期间的最新输入");
  await expect(form.getByRole("alert")).toContainText("draft disk full");
  await form.getByRole("button", { name: "Close", exact: true }).click();
  await expect(form).toBeVisible();
  await expect(form.locator("textarea")).toHaveValue("失败期间的最新输入");
  await page.evaluate(() => (window as any).restoreCapturePersistence());
  await form.getByRole("button", { name: "重试保存草稿", exact: true }).click();
  await expect(
    form.locator('[data-capture-save-status="saved"]'),
  ).toBeVisible();
  await form.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  form = await capture(page);
  await expect(form.locator("textarea")).toHaveValue("失败期间的最新输入");
  expect(
    await repository(page, `return store.getSnapshot().entries.length;`),
  ).toBe(0);
});
test("a lost draft cleanup acknowledgement can retry entry creation without duplicates", async ({
  page,
}) => {
  await page.goto("/");
  const form = await capture(page);
  await form.getByLabel("概念 / 知识名称").fill("幂等保存");
  await form.locator("textarea").fill("只创建一次");
  await page.evaluate(async () => {
    const { store } = await import("/src/core/store.ts" as string);
    const original = store.db.setLocal.bind(store.db);
    let fail = true;
    store.db.setLocal = async (key, value: any) => {
      if (
        fail &&
        key === "capture-draft-v1" &&
        value?.title === "" &&
        store.getSnapshot().entries.length
      ) {
        fail = false;
        throw Error("cleanup failure");
      }
      return original(key, value);
    };
  });
  await form.getByRole("button", { name: "保存到知识库", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("词条已保存");
  expect(
    await repository(page, `return store.getSnapshot().entries.length;`),
  ).toBe(1);
  await form.getByRole("button", { name: "保存到知识库", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(
    await repository(page, `return store.getSnapshot().entries.length;`),
  ).toBe(1);
});
test("choosing a duplicate entry opens it without discarding the unsubmitted material", async ({
  page,
}) => {
  await page.goto("/");
  await repository(page, `await store.createEntry('现有词条','已保存正文');`);
  let form = await capture(page);
  await form.getByLabel("概念 / 知识名称").fill("现有词条");
  await form.locator("textarea").fill("另一份未提交材料");
  await form.getByRole("button", { name: "保存到知识库", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.map(e=>e.content);`,
    ),
  ).toEqual(["已保存正文"]);
  form = await capture(page);
  await expect(form.locator("textarea")).toHaveValue("另一份未提交材料");
});
test("capture-only popup restores the same draft, stays opaque while resized, and saves through its opener without opening its own database", async ({
  page,
  context,
}) => {
  await page.goto("/");
  let form = await capture(page);
  await form.getByLabel("概念 / 知识名称").fill("独立窗口素材");
  await form.locator("textarea").fill("跨窗口草稿");
  await form.getByRole("button", { name: "Close", exact: true }).click();
  async function popup() {
    const opened = context.waitForEvent("page");
    await page.evaluate(() =>
      window.open("/?quick-capture=1", "capture020", "width=560,height=640"),
    );
    const child = await opened;
    await expect(child.locator(".capture-form")).toBeVisible();
    return child;
  }
  let child = await popup();
  await expect(child.getByLabel("概念 / 知识名称")).toHaveValue("独立窗口素材");
  expect(
    await child.evaluate(async () => {
      const { store } = await import("/src/core/store.ts" as string);
      return store.getSnapshot().ready;
    }),
  ).toBe(false);
  await expect(child.locator(".app-shell,.modal-backdrop")).toHaveCount(0);
  for (const size of [
    { width: 560, height: 640 },
    { width: 380, height: 430 },
    { width: 320, height: 360 },
  ]) {
    await child.setViewportSize(size);
    const box = await child
      .getByRole("button", { name: "保存到知识库", exact: true })
      .boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
    expect(
      await child.evaluate(
        () => document.body.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  await child.locator("textarea").fill("关闭前的新内容");
  await child
    .getByRole("button", { name: "关闭快速记录", exact: true })
    .click();
  await expect.poll(() => child.isClosed()).toBe(true);
  child = await popup();
  await expect(child.locator("textarea")).toHaveValue("关闭前的新内容");
  await child
    .getByRole("button", { name: "保存到知识库", exact: true })
    .click();
  await expect(child.locator(".capture-notice")).toContainText(
    "已保存到知识库",
  );
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.filter(e=>e.title==='独立窗口素材').length;`,
    ),
  ).toBe(1);
  await expect(child.getByLabel("概念 / 知识名称")).toHaveValue("");
});
