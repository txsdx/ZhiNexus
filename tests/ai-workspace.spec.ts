/** Genuine streamed AI, reviewable durable jobs and selection-driven document layout regressions. */
import { test, expect, type Page } from "@playwright/test";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
/** Inspect application repositories without adding production test hooks. */
async function repository<T>(page: Page, code: string): Promise<T> {
  await expect(page.locator(".app-shell")).toBeVisible();
  return page.evaluate(async (source) => {
    const { store } = await import("/src/core/store.ts" as string);
    return new Function("store", `return (async()=>{${source}})()`)(store);
  }, code);
}
/** An actual chunked HTTP service prevents a buffered route fixture from falsely proving streaming. */
async function streamingServer(
  handle: (
    body: { messages: { role: string; content: string }[]; stream?: boolean },
    res: ServerResponse,
  ) => void,
) {
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      res.flushHeaders();
      handle(JSON.parse(raw), res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
/** Emit one real Chat Completions delta. */
function delta(res: ServerResponse, text: string) {
  res.write(
    "data: " +
      JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] }) +
      "\n\n",
  );
}
/** Finish a stream explicitly so truncated responses remain inapplicable. */
function done(res: ServerResponse) {
  res.end(
    "data: " +
      JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }) +
      "\n\ndata: [DONE]\n\n",
  );
}
/** Configure raw IDs and an ordinary local fixture key. */
async function configure(page: Page, url: string, concurrency = 2) {
  await repository(
    page,
    `const ai=structuredClone(store.getSnapshot().ai);ai.baseUrl=${JSON.stringify(url)};ai.defaultModel='raw-stream-model';await store.saveAI(ai);await store.updateDevice({apiKey:'stream-key-sentinel',apiKeyEndpoint:ai.baseUrl,aiConcurrency:${concurrency},syncMinutes:0});`,
  );
}

test("chat displays real partial output, survives navigation, and clears only after explicit review", async ({
  page,
}) => {
  let finish = () => {},
    calls = 0;
  const server = await streamingServer((body, res) => {
    calls++;
    expect(body.stream).toBe(true);
    delta(res, "先输出");
    finish = () => {
      delta(res, "，再完成。");
      done(res);
    };
  });
  try {
    await page.goto("/");
    await configure(page, server.url);
    await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
    await page.locator(".chat-input textarea").fill("请测试流式回答");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".ai-live-message")).toContainText("先输出");
    expect(
      await repository(
        page,
        "return store.getSnapshot().topics[0].messages.filter(m=>m.role==='assistant').length",
      ),
    ).toBe(0);
    await page
      .getByRole("button", { name: "打开 AI 任务队列", exact: true })
      .click();
    await expect(page.locator(".ai-job-card")).toHaveCount(1);
    await expect(page.locator(".ai-job-card")).toContainText("先输出");
    finish();
    await expect(page.locator(".ai-job-card")).toHaveAttribute(
      "data-job-state",
      "review",
    );
    await page.reload();
    await page
      .getByRole("button", { name: "打开 AI 任务队列", exact: true })
      .click();
    await expect(page.locator(".ai-job-card")).toContainText(
      "先输出，再完成。",
    );
    expect(calls).toBe(1);
    await page
      .getByRole("button", { name: "打开相关页面并审阅", exact: true })
      .click();
    await expect(page.locator(".chat-page")).toBeVisible();
    await page
      .getByRole("button", { name: "已阅并清除任务", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { aiJobs } = await import("/src/services/ai-jobs.ts" as string);
          return aiJobs.getSnapshot().jobs.length;
        }),
      )
      .toBe(0);
    await expect(page.locator(".messages")).toContainText("先输出，再完成。");
  } finally {
    await server.close();
  }
});

test("entry outline is left, metadata is above, highlighting persists and the sidebar toggle is remembered", async ({
  page,
}) => {
  await page.goto("/");
  const id = await repository<string>(
    page,
    "const id=await store.createEntry('版面与标记','# 标题\\n\\n选择这段文字，保留其余内容。');await store.patch('entry',id,{summary:'原有摘要不能被删除'});return id;",
  );
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await page.locator(".entry-row").click();
  await expect(page.locator(".entry-aside")).toHaveCount(0);
  await expect(page.locator(".entry-summary-editor")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "知识连接", exact: true }),
  ).toHaveCount(0);
  const outline = await page.locator(".entry-outline").boundingBox(),
    paper = await page.locator(".paper").boundingBox(),
    meta = await page.locator(".entry-meta").boundingBox();
  expect(outline!.x).toBeLessThan(paper!.x);
  expect(meta!.y + meta!.height).toBeLessThanOrEqual(paper!.y);
  await page.locator(".block-document").evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.textContent?.includes("选择这段文字")) {
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 7);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        break;
      }
    }
  });
  await expect(
    page.getByRole("toolbar", { name: "划词工具", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "黄色高亮", exact: true }).click();
  await expect(page.locator(".block-document mark")).toHaveText(
    "选择这段文字，",
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".title-input")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".block-document mark")).toHaveText(
    "选择这段文字，",
  );
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${id}').summary`,
    ),
  ).toBe("原有摘要不能被删除");
  await page.getByRole("button", { name: "收起左侧栏", exact: true }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-collapsed/);
  expect((await page.locator(".sidebar").boundingBox())!.width).toBeLessThan(
    100,
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "展开左侧栏", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "展开左侧栏", exact: true }).click();
  await expect(page.locator(".app-shell")).toHaveClass(/sidebar-expanded/);
  expect((await page.locator(".sidebar").boundingBox())!.width).toBeGreaterThan(
    150,
  );
  await page.screenshot({
    path: "test-results/entry-left-outline-expanded.png",
    fullPage: true,
  });
});

test("selected passage reaches the AI prompt and a queue save failure retains the composed question", async ({
  page,
}) => {
  const server = await streamingServer((body, res) => {
    expect(JSON.stringify(body.messages)).toContain("仅选中的短句");
    delta(res, "已解释选中的短句");
    done(res);
  });
  try {
    await page.goto("/");
    await configure(page, server.url);
    await repository(
      page,
      "await store.createEntry('选区提问','仅选中的短句');",
    );
    await page.getByRole("button", { name: "我的知识库", exact: true }).click();
    await page.locator(".entry-row").click();
    await page.locator(".block-document").evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT),
        node = walker.nextNode()!;
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page
      .getByRole("toolbar", { name: "划词工具", exact: true })
      .getByRole("button", { name: "AI 对话", exact: true })
      .click();
    await expect(page.locator(".chat-selection-context")).toContainText(
      "仅选中的短句",
    );
    await page.locator(".chat-input textarea").fill("保留这个问题");
    await repository(
      page,
      "const write=store.db.setLocal.bind(store.db);let fail=true;store.db.setLocal=async(key,value)=>{if(key==='ai-jobs'&&fail){fail=false;throw Error('queue-save-failure')}return write(key,value)};",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".toast")).toContainText("queue-save-failure");
    await expect(page.locator(".chat-input textarea")).toHaveValue(
      "保留这个问题",
    );
    await expect(page.locator(".chat-selection-context")).toContainText(
      "仅选中的短句",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".message.assistant")).toContainText(
      "已解释选中的短句",
    );
    await expect(page.locator(".chat-input textarea")).toHaveValue("");
  } finally {
    await server.close();
  }
});

test("streamed OCR stays editable and creates knowledge only after confirmation", async ({
  page,
}) => {
  const server = await streamingServer((body, res) => {
    expect(JSON.stringify(body.messages)).toContain("data:image/png;base64,");
    delta(res, "截图中的");
    delta(res, "原始文字");
    done(res);
  });
  try {
    await page.goto("/");
    await configure(page, server.url);
    await repository(
      page,
      `const hash=await store.db.putBlob(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg=='), c=>c.charCodeAt(0)), 'image/png');const {submitAIJob}=await import('/src/services/ai-jobs.ts');await submitAIJob('ocr',{page:'tasks'},{imageHash:hash,source:'fixture-screen'});`,
    );
    await expect(page.locator(".ai-result-review textarea")).toHaveValue(
      "截图中的原始文字",
    );
    expect(
      await repository(page, "return store.getSnapshot().entries.length"),
    ).toBe(0);
    await page
      .getByRole("textbox", { name: "词条标题", exact: true })
      .fill("审阅后的截图");
    await page
      .getByRole("textbox", { name: "识别文字（可编辑）", exact: true })
      .fill("人工核对的内容");
    await page
      .getByRole("checkbox", { name: "保留截图", exact: true })
      .uncheck();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await page.locator(".ai-queue-button").click();
    await page.locator(".ai-job-card .actions button").first().click();
    await expect(page.locator(".ai-result-review textarea")).toHaveValue(
      "人工核对的内容",
    );
    expect(
      await repository(page, "return store.getSnapshot().entries.length"),
    ).toBe(0);
    await page.getByRole("button", { name: "确认并应用", exact: true }).click();
    await expect(page.locator(".entry-heading h1")).toHaveText("审阅后的截图");
    const entries = await repository<{ content: string }[]>(
      page,
      "return store.getSnapshot().entries",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("人工核对的内容");
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { aiJobs } = await import("/src/services/ai-jobs.ts" as string);
          return aiJobs.getSnapshot().jobs.length;
        }),
      )
      .toBe(0);
  } finally {
    await server.close();
  }
});

test("streamed classification remains unapplied through reload and failed cleanup cannot duplicate writes", async ({
  page,
}) => {
  let finish = () => {},
    started = false;
  const server = await streamingServer((_body, res) => {
    started = true;
    delta(res, '{"categories":[');
    finish = () => {
      delta(
        res,
        '{"id":"child","name":"AI 子类","parent":"root"}],"assignments":[{"entryId":"entry","category":"child"}]}',
      );
      done(res);
    };
  });
  try {
    await page.goto("/");
    await configure(page, server.url);
    await repository(
      page,
      "await store.patch('category','root',{name:'人工大类',parent:''});const {newCard}=await import('/src/core/review.ts');await store.patch('entry','entry',{title:'待分类词条',content:'原始正文',category:'root',tags:[],prerequisites:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),card:JSON.parse(JSON.stringify(newCard()))});",
    );
    await page.getByRole("button", { name: "设置与偏好", exact: true }).click();
    await page.getByRole("button", { name: "知识分类", exact: true }).click();
    await page
      .getByRole("button", { name: "一键智能整理 · 先预览再确认", exact: true })
      .click();
    await expect.poll(() => started).toBe(true);
    await expect(page.getByRole("dialog")).toContainText('{"categories":[');
    expect(
      await repository(page, "return store.getSnapshot().entries[0].category"),
    ).toBe("root");
    finish();
    await expect(
      page.getByRole("button", { name: "确认并应用", exact: true }),
    ).toBeEnabled();
    expect(
      await repository(page, "return store.getSnapshot().categories.length"),
    ).toBe(1);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "打开 AI 任务队列", exact: true })
      .click();
    await expect(page.locator(".ai-job-card")).toHaveAttribute(
      "data-job-state",
      "review",
    );
    await page
      .getByRole("button", { name: "打开相关页面并审阅", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "确认知识分类变更", exact: true }),
    ).toBeVisible();
    await repository(
      page,
      "store.db.savedSetLocal=store.db.setLocal;store.db.setLocal=async(key,value)=>{if(key==='ai-jobs')throw Error('fixture cleanup disk failure');return store.db.savedSetLocal(key,value)};",
    );
    await page.getByRole("button", { name: "确认并应用", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "fixture cleanup disk failure",
    );
    expect(
      await repository(page, "return store.getSnapshot().entries[0].category"),
    ).toBe("child");
    expect(
      await page.evaluate(async () => {
        const { aiJobs } = await import("/src/services/ai-jobs.ts" as string);
        return aiJobs.getSnapshot().jobs.length;
      }),
    ).toBe(1);
    const written = await repository<number>(
      page,
      "return store.getSnapshot().events.filter(e=>e.op.source==='ai-reviewed-classification').length",
    );
    expect(written).toBe(3);
    await repository(
      page,
      "store.db.setLocal=store.db.savedSetLocal;delete store.db.savedSetLocal;",
    );
    await page
      .getByRole("button", { name: "确认清除任务", exact: true })
      .click();
    expect(
      await repository(
        page,
        "return store.getSnapshot().events.filter(e=>e.op.source==='ai-reviewed-classification').length",
      ),
    ).toBe(written);
    await page
      .getByRole("button", { name: "打开 AI 任务队列", exact: true })
      .click();
    await expect(page.locator(".ai-job-card")).toHaveCount(0);
  } finally {
    await server.close();
  }
});

test("the autosaved concurrency limit controls actual requests, and a queued cancellation sends nothing", async ({
  page,
}) => {
  const responses: ServerResponse[] = [];
  const server = await streamingServer((_body, res) => {
    responses.push(res);
    delta(res, "部分内容");
  });
  try {
    await page.goto("/");
    await configure(page, server.url, 1);
    const ids = await repository<string[]>(
      page,
      "const {submitAIJob}=await import('/src/services/ai-jobs.ts');const ids=[];for(let i=0;i<3;i++){const id=await store.createEntry('并发任务 '+i,'original');ids.push(await submitAIJob('explain',{page:'entry',entryId:id},{},false));}return ids;",
    );
    await expect.poll(() => responses.length).toBe(1);
    await page
      .getByRole("button", { name: "打开 AI 任务队列", exact: true })
      .click();
    await expect(page.locator('[data-job-state="queued"]')).toHaveCount(2);
    await page
      .locator(`[data-ai-job="${ids[1]}"]`)
      .getByRole("button", { name: "停止任务", exact: true })
      .click();
    await expect(page.locator(`[data-ai-job="${ids[1]}"]`)).toHaveAttribute(
      "data-job-state",
      "cancelled",
    );
    expect(responses).toHaveLength(1);
    await page.getByRole("button", { name: "设置与偏好", exact: true }).click();
    await page.getByRole("button", { name: "AI 与模型", exact: true }).click();
    await page
      .getByLabel("AI 并发任务上限（本设备）", { exact: true })
      .fill("2");
    await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
    await expect.poll(() => responses.length).toBe(2);
    for (const res of responses) {
      delta(res, "，完成");
      done(res);
    }
    await page
      .getByRole("button", { name: "打开 AI 任务队列", exact: true })
      .click();
    await expect(page.locator('[data-job-state="review"]')).toHaveCount(2);
    expect(responses).toHaveLength(2);
    expect(
      await repository(
        page,
        "return store.getSnapshot().entries.map(e=>e.content)",
      ),
    ).toEqual(["original", "original", "original"]);
  } finally {
    await server.close();
  }
});

test("a second browser window mirrors pending results without overwriting or restarting them", async ({
  page,
  context,
}) => {
  let requests = 0;
  const server = await streamingServer((_body, res) => {
    requests++;
    delta(res, "已生成");
    done(res);
  });
  try {
    await page.goto("/");
    await configure(page, server.url);
    await repository(
      page,
      "const id=await store.createEntry('队列归属','原文');const {submitAIJob}=await import('/src/services/ai-jobs.ts');await submitAIJob('explain',{page:'entry',entryId:id},{},false);",
    );
    await page
      .getByRole("button", { name: "打开 AI 任务队列", exact: true })
      .click();
    await expect(page.locator(".ai-job-card")).toHaveAttribute(
      "data-job-state",
      "review",
    );
    const other = await context.newPage();
    await other.goto("/");
    await other
      .getByRole("button", { name: "打开 AI 任务队列", exact: true })
      .click();
    await expect(other.locator(".ai-job-card")).toContainText("已生成");
    await expect(other.locator(".ai-task-center")).toContainText("另一个窗口");
    const state = await other.evaluate(async () => {
      const { aiJobs } = await import("/src/services/ai-jobs.ts" as string);
      try {
        await aiJobs.remove(aiJobs.getSnapshot().jobs[0].id);
        return "unexpected";
      } catch {
        return "blocked";
      }
    });
    expect(state).toBe("blocked");
    expect(requests).toBe(1);
    await page
      .getByRole("button", { name: "打开相关页面并审阅", exact: true })
      .click();
    await page.getByRole("button", { name: "确认并应用", exact: true }).click();
    await expect(other.locator(".ai-job-card")).toHaveCount(0);
    await other.close();
  } finally {
    await server.close();
  }
});

test("a reload retains partial streamed output and never reissues an interrupted task without retry", async ({
  page,
}) => {
  let requests = 0;
  const server = await streamingServer((_body, res) => {
    requests++;
    delta(res, requests === 1 ? "需要保留的部分输出" : "重试完成的结果");
    if (requests > 1) done(res);
  });
  try {
    await page.goto("/");
    await configure(page, server.url);
    await repository(
      page,
      "const id=await store.createEntry('中断恢复','原始内容');const {submitAIJob}=await import('/src/services/ai-jobs.ts');await submitAIJob('explain',{page:'entry',entryId:id},{},false);",
    );
    await expect
      .poll(() =>
        repository(
          page,
          "const {decryptSecret}=await import('/src/core/secrets.ts');const rows=await decryptSecret(await store.db.local('ai-jobs',''),'local-ai-jobs','',32*1024*1024);return rows[0]?.stages[0]?.content;",
        ),
      )
      .toBe("需要保留的部分输出");
    await page.reload();
    await page
      .getByRole("button", { name: "打开 AI 任务队列", exact: true })
      .click();
    await expect(page.locator(".ai-job-card")).toHaveAttribute(
      "data-job-state",
      "error",
    );
    await expect(page.locator(".ai-job-card")).toContainText(
      "需要保留的部分输出",
    );
    expect(requests).toBe(1);
    await page
      .locator(".ai-job-card")
      .getByRole("button", { name: "重试", exact: true })
      .click();
    await expect(page.locator(".ai-job-card")).toHaveAttribute(
      "data-job-state",
      "review",
    );
    await expect(page.locator(".ai-job-card")).toContainText("重试完成的结果");
    expect(requests).toBe(2);
    expect(
      await repository(page, "return store.getSnapshot().entries[0].content"),
    ).toBe("原始内容");
  } finally {
    await server.close();
  }
});
