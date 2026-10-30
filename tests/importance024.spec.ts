/** Importance follows durable knowledge, real streaming, manual overrides, offline review and replica validation. */
import { test, expect, type Page } from "@playwright/test";
import {
  repository,
  streamingServer,
  configure,
  delta,
  done,
} from "./helpers/ai-stream";
import { mockWebDAV } from "./helpers/webdav";
async function seed(page: Page) {
  await page.goto("/");
  return repository<{ high: string; normal: string; low: string }>(
    page,
    `
    const {rememberedCard}=await import('/src/core/review.ts');
    const result={};
    for(const level of ['high','normal','low']){
      const id=await store.createEntry(level==='high'?'核心知识':level==='low'?'随手参考':'普通概念','原始解释与材料');
      const card=rememberedCard(new Date(Date.now()-30*86400000));card.due=new Date(Date.now()-60000);
      await store.patch('entry',id,{card:JSON.parse(JSON.stringify(card)),...(level==='normal'?{}:{importance:{level,mode:'manual'}})});result[level]=id;
    }
    return result;
  `,
  );
}
async function open(page: Page, id: string) {
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await page
    .locator(`tr[data-entry-id="${id}"] .entry-title-cell button`)
    .click();
}
async function setLevel(page: Page, level: string) {
  await page.getByRole("button", { name: "修改重要等级", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "词条重要等级",
    exact: true,
  });
  await dialog.getByRole("radio", { name: new RegExp(`^${level}`) }).check();
  await dialog.getByRole("button", { name: "保存等级", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
test("manual priority waits for save, survives cancellation and failure, and never changes the card", async ({
  page,
}) => {
  const ids = await seed(page);
  await open(page, ids.normal);
  const card = await repository(
    page,
    `return JSON.stringify(store.getSnapshot().entries.find(e=>e.id==='${ids.normal}').card)`,
  );
  await page.getByRole("button", { name: "修改重要等级", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "词条重要等级", exact: true });
  await dialog.getByRole("radio", { name: /^低/ }).check();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${ids.normal}').importance??null`,
    ),
  ).toBeNull();
  await page.getByRole("button", { name: "修改重要等级", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "词条重要等级", exact: true });
  await dialog.getByRole("radio", { name: /^低/ }).check();
  await repository(
    page,
    `const batch=store.batchWhen.bind(store);let fail=true;store.batchWhen=async(...args)=>{if(fail&&args[1]==='entry-bulk-change'){fail=false;throw Error('importance-disk-full')}return batch(...args)}`,
  );
  await dialog.getByRole("button", { name: "保存等级", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("importance-disk-full");
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${ids.normal}').importance??null`,
    ),
  ).toBeNull();
  await dialog
    .getByRole("button", { name: "保存等级", exact: true })
    .press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".entry-review-facts")).toContainText("免复习");
  expect(
    await repository(
      page,
      `return JSON.stringify(store.getSnapshot().entries.find(e=>e.id==='${ids.normal}').card)`,
    ),
  ).toBe(card);
  await page.reload();
  await expect(page.locator(".importance-control")).toContainText("低");
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${ids.normal}').importance`,
    ),
  ).toEqual({ level: "low", mode: "manual" });
});
test("library and quick filters, bulk edits and context menus share priority without adding a column", async ({
  page,
}) => {
  const ids = await seed(page);
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await expect(page.locator(".knowledge-table th")).toHaveCount(4);
  await expect(
    page.locator(`tr[data-entry-id="${ids.low}"] .next-review-cell`),
  ).toHaveText("免复习");
  await page.getByLabel("筛选重要等级", { exact: true }).selectOption("low");
  await expect(page.locator(".entry-row")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "搜索知识", exact: true })
    .fill("is:due");
  await expect(page.locator(".entry-row")).toHaveCount(0);
  await page.getByRole("textbox", { name: "搜索知识", exact: true }).clear();
  await page.getByLabel("筛选重要等级", { exact: true }).selectOption("all");
  await page.getByRole("button", { name: "选择词条", exact: true }).click();
  await page.getByLabel("全选当前结果", { exact: false }).check();
  await page
    .getByLabel("批量设置重要等级", { exact: true })
    .selectOption("low");
  await expect(page.locator(".entry-row .review-excluded")).toHaveCount(3);
  await page
    .locator(`tr[data-entry-id="${ids.high}"]`)
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "重要等级", exact: true }).click();
  await page.getByRole("menuitem", { name: "高", exact: true }).click();
  await expect(
    page.locator(`tr[data-entry-id="${ids.high}"] .importance-badge`),
  ).toHaveAttribute("data-importance", "high");
  await page.getByRole("button", { name: /^复习队列/ }).click();
  await expect(page.locator(".queue > button")).toHaveCount(1);
  await expect(page.locator(".queue > button")).toContainText("核心知识");
  await page.getByLabel("包含未到期条目", { exact: true }).check();
  await expect(page.locator(".queue > button")).toHaveCount(1);
  await page.getByRole("button", { name: "遗忘曲线", exact: true }).click();
  await expect(page.locator('.curve-plot path[role="link"]')).toHaveCount(1);
  await page.getByLabel("包含免复习条目", { exact: true }).check();
  await expect(page.locator('.curve-plot path[role="link"]')).toHaveCount(3);
});
test("review ordering and paused sessions respect importance and restore the untouched context", async ({
  page,
}) => {
  const ids = await seed(page);
  await page.getByRole("button", { name: /^复习队列/ }).click();
  await expect(page.locator(".queue > button")).toHaveCount(2);
  await expect(page.locator(".queue > button").first()).toContainText(
    "核心知识",
  );
  await page.locator(".queue > button").first().click();
  const before = await repository(
    page,
    `return JSON.stringify(store.getSnapshot().entries.find(e=>e.id==='${ids.high}').card)`,
  );
  await repository(
    page,
    `await store.patch('entry','${ids.high}',{importance:{level:'low',mode:'manual'}})`,
  );
  await expect(page.locator(".self-review")).toHaveCount(0);
  await expect(page.locator(".notice")).toContainText("会话已暂停");
  await repository(
    page,
    `await store.patch('entry','${ids.high}',{importance:{level:'high',mode:'manual'}})`,
  );
  await expect(page.locator(".self-review h2")).toContainText("核心知识");
  expect(
    await repository(
      page,
      `return JSON.stringify(store.getSnapshot().entries.find(e=>e.id==='${ids.high}').card)`,
    ),
  ).toBe(before);
});
test("genuine streamed explanation adds a reviewed priority, persists the proposal and leaves assembled logs", async ({
  page,
}) => {
  let finish = () => {};
  const server = await streamingServer((body, res) => {
    if (
      body.messages.some((message) => message.content.includes("建议重要等级"))
    ) {
      delta(res, '{"level":"low","reason":"');
      finish = () => {
        delta(res, '一次性参考材料"}');
        done(res);
      };
    } else {
      delta(res, "# 新的完整解释\n\n内容保留。");
      done(res);
    }
  });
  try {
    const ids = await seed(page);
    await configure(page, server.url);
    await open(page, ids.normal);
    await page
      .getByRole("button", { name: "AI 标准解释", exact: true })
      .click();
    await expect(page.locator(".ai-stream-content").last()).toContainText(
      '{"level":"low"',
    );
    expect(
      await repository(
        page,
        `return store.getSnapshot().entries.find(e=>e.id==='${ids.normal}').importance??null`,
      ),
    ).toBeNull();
    finish();
    await expect(page.getByLabel("建议重要等级", { exact: true })).toHaveValue(
      "low",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page.reload();
    await page
      .getByRole("button", { name: "打开 AI 任务队列", exact: true })
      .click();
    await page.locator(".ai-job-link").click();
    await expect(page.getByLabel("建议重要等级", { exact: true })).toHaveValue(
      "low",
    );
    await page.getByRole("button", { name: "确认并应用", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".entry-review-facts")).toContainText("免复习");
    const entry = await repository<any>(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${ids.normal}')`,
    );
    expect(entry.importance).toEqual({
      level: "low",
      mode: "auto",
      reason: "一次性参考材料",
    });
    expect(entry.content).toContain("新的完整解释");
    expect(entry.reviewCount).toBe(0);
    const logs = await page.evaluate(async () => {
      const { diagnostics } = await import(
        "/src/services/diagnostics.ts" as string
      );
      return diagnostics.getSnapshot();
    });
    const serialized = JSON.stringify(logs);
    expect(serialized).toContain("一次性参考材料");
    expect(serialized).not.toContain("data: [DONE]");
    expect(serialized).not.toContain("stream-key-sentinel");
  } finally {
    await server.close();
  }
});
test("manual changes during generation survive later AI application and another explanation avoids re-assessment", async ({
  page,
}) => {
  let finish = () => {},
    assessments = 0;
  const server = await streamingServer((body, res) => {
    if (
      body.messages.some((message) => message.content.includes("建议重要等级"))
    ) {
      assessments++;
      delta(res, JSON.stringify({ level: "high", reason: "基础概念" }));
      done(res);
    } else {
      delta(res, "# 流式解释");
      finish = () => {
        delta(res, "\n\n解释完成");
        done(res);
      };
    }
  });
  try {
    const ids = await seed(page);
    await configure(page, server.url);
    await open(page, ids.normal);
    await page
      .getByRole("button", { name: "AI 标准解释", exact: true })
      .click();
    await expect(page.locator(".ai-stream-content")).toContainText("流式解释");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await setLevel(page, "低");
    finish();
    await page
      .getByRole("button", { name: "打开 AI 任务队列", exact: true })
      .click();
    await expect(page.locator(".ai-job-card")).toHaveAttribute(
      "data-job-state",
      "review",
    );
    await page.locator(".ai-job-link").click();
    await expect(page.locator(".importance-proposal")).toContainText(
      "已手动锁定为",
    );
    await page.getByRole("button", { name: "确认并应用", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".importance-control")).toContainText("低");
    await page
      .getByRole("button", { name: "AI 标准解释", exact: true })
      .click();
    await expect(page.locator(".ai-stream-content")).toContainText("流式解释");
    finish();
    await expect(
      page.getByRole("button", { name: "确认并应用", exact: true }),
    ).toBeVisible();
    expect(assessments).toBe(1);
    await page.getByRole("button", { name: "确认并应用", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await repository(
        page,
        `return store.getSnapshot().entries.find(e=>e.id==='${ids.normal}').importance`,
      ),
    ).toEqual({ level: "low", mode: "manual" });
  } finally {
    await server.close();
  }
});
test("priority and manual mode replicate together into a fresh validated WebDAV client", async ({
  page,
  browser,
}) => {
  const files = new Map<string, string>();
  const ids = await seed(page);
  await mockWebDAV(page, files);
  await repository(
    page,
    `await store.updateDevice({davUrl:'https://dav.example/knowledge/',davUser:'test',davPassword:'test',syncMinutes:0});await (await import('/src/services/sync.ts')).synchronize();`,
  );
  const context = await browser.newContext();
  try {
    await mockWebDAV(context, files);
    const peer = await context.newPage();
    await peer.goto("/");
    await repository(
      peer,
      `await store.updateDevice({davUrl:'https://dav.example/knowledge/',davUser:'test',davPassword:'test',syncMinutes:0});await (await import('/src/services/sync.ts')).synchronize();`,
    );
    expect(
      await repository(
        peer,
        `return store.getSnapshot().entries.find(e=>e.id==='${ids.low}').importance`,
      ),
    ).toEqual({ level: "low", mode: "manual" });
    await open(peer, ids.low);
    await expect(peer.locator(".entry-review-facts")).toContainText("免复习");
    const audit = await peer.evaluate(async () =>
      (await import("/src/services/integrity.ts" as string)).auditLocal(),
    );
    expect(audit.root).toBeTruthy();
  } finally {
    await context.close();
  }
});
test("workload day details and priority editor fit touch mobile and dark layouts", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "zh-CN",
  });
  try {
    const page = await context.newPage(),
      ids = await seed(page);
    await page.getByRole("button", { name: "学习概览", exact: true }).click();
    await expect(page.locator(".review-forecast-days>button")).toHaveCount(7);
    await page.locator(".review-forecast-days>button").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator(".forecast-entries button")).toHaveCount(2);
    await dialog.getByRole("button", { name: /核心知识/ }).click();
    await expect(page.locator(".entry-heading h1")).toHaveText("核心知识");
    await repository(
      page,
      `await store.patch('setting','appearance',{theme:'dark'});`,
    );
    await page
      .getByRole("button", { name: "修改重要等级", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "词条重要等级", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.body.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await page.screenshot({
      path: "test-results/importance024-mobile-dark.png",
      fullPage: true,
    });
    expect(
      await repository(
        page,
        `return store.getSnapshot().entries.find(e=>e.id==='${ids.high}').importance.level`,
      ),
    ).toBe("high");
  } finally {
    await context.close();
  }
});

test("standalone assessment is reviewable, edits lock the accepted level, and returning to auto retains the current card", async ({
  page,
}) => {
  let requests = 0;
  const server = await streamingServer((_body, res) => {
    requests++;
    delta(res, JSON.stringify({ level: "high", reason: "基础且可迁移" }));
    done(res);
  });
  try {
    const ids = await seed(page);
    await configure(page, server.url);
    await open(page, ids.low);
    const card = await repository(
      page,
      `return JSON.stringify(store.getSnapshot().entries.find(e=>e.id==='${ids.low}').card)`,
    );
    await page
      .getByRole("button", { name: "修改重要等级", exact: true })
      .click();
    await page
      .getByRole("button", { name: "请 AI 单独评估", exact: true })
      .click();
    await expect(page.getByLabel("建议重要等级", { exact: true })).toHaveValue(
      "high",
    );
    expect(
      await repository(
        page,
        `return store.getSnapshot().entries.find(e=>e.id==='${ids.low}').importance`,
      ),
    ).toEqual({ level: "low", mode: "manual" });
    await page
      .getByLabel("建议重要等级", { exact: true })
      .selectOption("normal");
    await expect(
      page.getByLabel("应用后锁定等级，后续 AI 不覆盖", { exact: true }),
    ).toBeChecked();
    await page.getByRole("button", { name: "确认并应用", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await repository(
        page,
        `return store.getSnapshot().entries.find(e=>e.id==='${ids.low}').importance`,
      ),
    ).toEqual({ level: "normal", mode: "manual" });
    await page
      .getByRole("button", { name: "修改重要等级", exact: true })
      .click();
    await page
      .getByLabel("允许 AI 在下次生成解释时调整等级", { exact: true })
      .check();
    await expect(
      page.getByLabel("允许 AI 在下次生成解释时调整等级", { exact: true }),
    ).toBeChecked();
    await page.getByRole("button", { name: "保存等级", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await repository(
        page,
        `return store.getSnapshot().entries.find(e=>e.id==='${ids.low}').importance`,
      ),
    ).toEqual({ level: "normal", mode: "auto" });
    expect(
      await repository(
        page,
        `return JSON.stringify(store.getSnapshot().entries.find(e=>e.id==='${ids.low}').card)`,
      ),
    ).toBe(card);
    expect(requests).toBe(1);
    await page.getByRole("button", { name: "设置与偏好", exact: true }).click();
    await page
      .getByRole("button", { name: "任务与提示词", exact: true })
      .click();
    await page
      .getByRole("button", { name: "重要等级评估", exact: true })
      .click();
    await expect(page.locator(".settings-content textarea")).toHaveValue(
      /high或normal或low/,
    );
  } finally {
    await server.close();
  }
});
