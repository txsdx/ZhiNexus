/** Full-viewport chat, streaming scroll behavior, semantic titles, query tools and keyboard interactions. */
import { test, expect } from "@playwright/test";
import {
  repository,
  configure,
  streamingServer,
  delta,
  done,
  isTitleRequest,
} from "./helpers/ai-stream";

/** Seed independent histories without invoking a provider. */
async function topics(page: import("@playwright/test").Page, long = false) {
  await repository(
    page,
    `for(const [id,title] of [['a','会话 A'],['b','会话 B']]){await store.patch('topic',id,{entryId:'',title,titleMode:'manual',titleGenerated:true,messages:${long ? "Array.from({length:60},(_,i)=>[{role:'user',content:'用户提问 '+i},{role:'assistant',content:'回答 '+i+'\\n\\n'+('解释内容。'.repeat(40))}]).flat()" : "[]"},updatedAt:new Date().toISOString()})}`,
  );
}

/** Assert that the app reserves its outer viewport for the conversation and footer. */
async function viewportFits(page: import("@playwright/test").Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight,
    ),
  ).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      () => document.body.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const composer = await page.locator(".chat-input").boundingBox();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
}

test("chat fills the viewport, right-aligns questions and places model controls below the prompt", async ({
  page,
}) => {
  await page.goto("/");
  await topics(page, true);
  await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
  await expect(page.locator(".chat-page")).toBeVisible();
  await viewportFits(page);
  expect(
    await page
      .locator(".messages")
      .evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  const input = await page.locator(".chat-input textarea").boundingBox(),
    controls = await page.locator(".chat-model").boundingBox();
  expect(controls!.y).toBeGreaterThanOrEqual(input!.y + input!.height);
  expect(
    await page
      .locator(".message.user .chat-user-text")
      .first()
      .evaluate((node) => getComputedStyle(node).textAlign),
  ).toBe("right");
  const question = await page.locator(".message.user").last().boundingBox(),
    answer = await page.locator(".message.assistant").last().boundingBox();
  expect(question!.x).toBeGreaterThan(answer!.x);
  await expect(
    page.locator(
      ".local-card,.profile,.chat-disclaimer,.chat-page .page-heading",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByText("好问题，比标准答案更接近理解。", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".sync-status")).toContainText("同步过时：");
  await page.screenshot({ path: "test-results/chat-desktop-0.15.png" });
});

test("streaming follows the bottom, respects reading older messages and resumes on demand", async ({
  page,
}) => {
  let append = () => {},
    finish = () => {};
  const server = await streamingServer((_body, res) => {
    delta(res, "# 流式回答\n\n" + "第一部分解释。\n\n".repeat(60));
    append = () => delta(res, "第二部分追加内容。\n\n".repeat(30));
    finish = () => {
      delta(res, "最终完成。");
      done(res);
    };
  });
  try {
    await page.goto("/");
    await configure(page, server.url);
    await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
    await page.locator(".chat-input textarea").fill("生成长回答");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".ai-live-message")).toContainText(
      "第一部分解释",
    );
    await expect
      .poll(() =>
        page
          .locator(".messages")
          .evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight),
      )
      .toBeLessThan(60);
    await page.locator(".messages").evaluate((e) => {
      e.scrollTop = 100;
      e.dispatchEvent(new Event("scroll"));
    });
    await expect(
      page.getByRole("button", { name: "回到最新消息", exact: true }),
    ).toBeVisible();
    append();
    await expect(page.locator(".ai-live-message")).toContainText(
      "第二部分追加内容",
    );
    expect(
      await page.locator(".messages").evaluate((e) => e.scrollTop),
    ).toBeLessThan(105);
    await page
      .getByRole("button", { name: "回到最新消息", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .locator(".messages")
          .evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight),
      )
      .toBeLessThan(60);
    finish();
    await expect(page.locator(".message.assistant")).toContainText(
      "最终完成。",
    );
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { aiJobs } = await import("/src/services/ai-jobs.ts" as string);
          return aiJobs.getSnapshot().jobs.length;
        }),
      )
      .toBe(0);
    await viewportFits(page);
  } finally {
    await server.close();
  }
});

test("query tools run without review and completed chat/title jobs disappear automatically", async ({
  page,
}) => {
  await page.goto("/");
  await configure(page, "https://ai.example/v1");
  const id = await repository<string>(
    page,
    "return store.createEntry('可查询资料','原文保持不变')",
  );
  let queryRequests = 0;
  await page.route("https://ai.example/**", async (route) => {
    const body = route.request().postDataJSON();
    if (isTitleRequest(body))
      return route.fulfill({
        json: {
          choices: [
            { message: { content: JSON.stringify({ title: "查询资料" }) } },
          ],
        },
      });
    queryRequests++;
    const result = body.messages.some(
      (m: { role: string }) => m.role === "tool",
    );
    return route.fulfill({
      json: {
        choices: [
          {
            message: result
              ? { content: "查到你的资料，原文保持不变。", tool_calls: null }
              : {
                  content: "",
                  tool_calls: [
                    {
                      id: "search",
                      type: "function",
                      function: {
                        name: "search_knowledge",
                        arguments: JSON.stringify({ query: "可查询资料" }),
                      },
                    },
                    {
                      id: "entry",
                      type: "function",
                      function: {
                        name: "get_entry",
                        arguments: JSON.stringify({ id }),
                      },
                    },
                  ],
                },
          },
        ],
      },
    });
  });
  await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
  await page.locator(".chat-input textarea").fill("查询我的资料");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.locator(".messages")).toContainText("查到你的资料");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() => repository(page, "return store.getSnapshot().topics[0].title"))
    .toBe("查询资料");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { aiJobs } = await import("/src/services/ai-jobs.ts" as string);
        return aiJobs.getSnapshot().jobs.length;
      }),
    )
    .toBe(0);
  expect(queryRequests).toBe(2);
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${id}').content`,
    ),
  ).toBe("原文保持不变");
  expect(
    await repository(
      page,
      "return store.getSnapshot().docs.filter(d=>d.collection==='setting'&&d.id.startsWith('tool-')).length",
    ),
  ).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
  await expect(page.locator(".chat-thread-header h1")).toHaveText("查询资料");
});

test("double-click edits survive reload and an in-flight automatic title cannot overwrite them", async ({
  page,
}) => {
  await page.goto("/");
  await configure(page, "https://ai.example/v1");
  let finishTitle = () => {},
    titleStarted = false;
  await page.route("https://ai.example/**", async (route) => {
    const body = route.request().postDataJSON();
    if (isTitleRequest(body)) {
      titleStarted = true;
      await new Promise<void>((resolve) => {
        finishTitle = () => {
          finishTitle = () => {};
          void route
            .fulfill({
              json: {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({ title: "迟到的自动标题" }),
                    },
                  },
                ],
              },
            })
            .then(() => resolve());
        };
      });
      return;
    }
    return route.fulfill({
      json: {
        choices: [{ message: { content: "完整回答", tool_calls: null } }],
      },
    });
  });
  try {
    await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
    await page.locator(".chat-input textarea").fill("会话标题生成测试");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".messages")).toContainText("完整回答");
    await expect.poll(() => titleStarted).toBe(true);
    await page.locator(".topic-title").dblclick();
    const editor = page.getByRole("textbox", { name: "会话标题", exact: true });
    await editor.fill("我指定的标题");
    await editor.press("Enter");
    await expect(page.locator(".topic-title")).toHaveText("我指定的标题");
    finishTitle();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { aiJobs } = await import("/src/services/ai-jobs.ts" as string);
          return aiJobs.getSnapshot().jobs.length;
        }),
      )
      .toBe(0);
    await expect(page.locator(".chat-thread-header h1")).toHaveText(
      "我指定的标题",
    );
    await page.locator(".topic-title").dblclick();
    await editor.fill("取消的修改");
    await editor.press("Escape");
    await expect(page.locator(".topic-title")).toHaveText("我指定的标题");
    await page.reload();
    await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
    await expect(page.locator(".topic-title")).toHaveText("我指定的标题");
  } finally {
    finishTitle();
  }
});

test("Enter submits, Shift+Enter/IME keep typing and topic switches retain distinct drafts", async ({
  page,
}) => {
  await page.goto("/");
  await topics(page);
  await configure(page, "https://ai.example/v1");
  let requests = 0;
  await page.route("https://ai.example/**", (route) => {
    requests++;
    return route.fulfill({
      json: { choices: [{ message: { content: "已回答", tool_calls: null } }] },
    });
  });
  await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
  await page.locator(".topic-title").filter({ hasText: "会话 A" }).click();
  const input = page.locator(".chat-input textarea");
  await input.fill("第一行");
  await input.press("Shift+Enter");
  await input.pressSequentially("第二行");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    isComposing: true,
    bubbles: true,
  });
  expect(requests).toBe(0);
  await page.locator(".topic-title").filter({ hasText: "会话 B" }).click();
  await input.fill("B 独立草稿");
  await page.locator(".topic-title").filter({ hasText: "会话 A" }).click();
  await expect(input).toHaveValue("第一行\n第二行");
  await input.press("Enter");
  await expect(page.locator(".messages")).toContainText("已回答");
  expect(requests).toBe(1);
  await page.locator(".topic-title").filter({ hasText: "会话 B" }).click();
  await expect(input).toHaveValue("B 独立草稿");
  const remove = page
    .locator(".topic")
    .filter({ hasText: "会话 B" })
    .getByRole("button", { name: "Delete topic", exact: true });
  await remove.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(input).toHaveValue("B 独立草稿");
  await remove.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(page.locator(".chat-thread-header h1")).toHaveText("会话 A");
  await expect(input).toHaveValue("");
});

test("mobile chat keeps the composer visible and conversation navigation in an overlay", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await topics(page, true);
  await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
  await expect(page.locator(".chat-page")).toBeVisible();
  await expect(page.locator(".topic-list")).toHaveCount(0);
  await viewportFits(page);
  await expect(page.locator(".chat-input")).toBeInViewport();
  await page.getByRole("button", { name: "展开会话列表", exact: true }).click();
  await expect(page.locator(".topic-list")).toBeVisible();
  await page.locator(".topic-title").filter({ hasText: "会话 A" }).click();
  await expect(page.locator(".topic-list")).toHaveCount(0);
  await viewportFits(page);
  await expect(page.locator(".sync-status")).toContainText("同步过时：");
  await page.screenshot({ path: "test-results/chat-mobile-0.15.png" });
});

test("stopping a streamed reply retains the question and partial answer without accepting a late completion", async ({
  page,
}) => {
  let finish = () => {};
  const server = await streamingServer((_body, res) => {
    delta(res, "等待中的部分回答");
    finish = () => {
      delta(res, "不应被接收的迟到输出");
      done(res);
    };
  });
  try {
    await page.goto("/");
    await configure(page, server.url);
    await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
    await page.locator(".chat-input textarea").fill("需要停止的提问");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator(".ai-live-message")).toContainText(
      "等待中的部分回答",
    );
    await page.getByRole("button", { name: "停止生成", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "重新生成", exact: true }),
    ).toBeVisible();
    finish();
    await expect(page.locator(".messages")).not.toContainText(
      "不应被接收的迟到输出",
    );
    await expect(page.locator(".messages")).toContainText("需要停止的提问");
    expect(
      await repository(
        page,
        "return store.getSnapshot().topics[0].messages.filter(m=>m.role==='assistant').length",
      ),
    ).toBe(0);
  } finally {
    await server.close();
  }
});
