/** User regressions: null provider tool_calls, durable private diagnostics and configuration without Apply buttons. */
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

/** Inspect the real development repository without production-only test hooks. */
async function repository<T>(page: Page, code: string): Promise<T> {
  await expect(page.locator(".app-shell")).toBeVisible();
  return page.evaluate(async (source) => {
    const { store } = await import("/src/core/store.ts" as string);
    return new Function("store", `return (async()=>{${source}})()`)(store);
  }, code);
}

/** Configure a declared catalog and ordinary endpoint-bound fixture credential. */
async function configure(page: Page) {
  await repository(
    page,
    `
    const ai=structuredClone(store.getSnapshot().ai);ai.baseUrl='https://ai.example/v1';ai.defaultModel='raw-fixture';
    ai.models=[{id:'raw-fixture',name:'Display Name',efforts:['low','high'],thinking:true,tools:null,vision:true,image:null}];
    await store.saveAI(ai);await store.updateDevice({apiKey:'log-api-key-sentinel',apiKeyEndpoint:ai.baseUrl,syncMinutes:0});
  `,
  );
}

test("null tool_calls no longer breaks enrichment; logs retain prompts, raw responses and errors after reload without secrets", async ({
  page,
}) => {
  let failure = false;
  await page.route("https://ai.example/**", async (route) => {
    if (failure) {
      await route.fulfill({
        status: 502,
        body: "upstream error log-api-key-sentinel",
      });
      return;
    }
    const body = route.request().postDataJSON();
    const prompt = body.messages[0].content;
    await route.fulfill({
      json: {
        choices: [
          {
            message: {
              content: prompt.includes("前置知识和相关概念")
                ? JSON.stringify({ prerequisites: [], relatedIds: [] })
                : "## 一句话解释\n自动整理已经成功。",
              tool_calls: null,
            },
          },
        ],
      },
    });
  });
  await page.goto("/");
  await configure(page);
  await page.getByRole("button", { name: /记录新知识/ }).click();
  await page
    .getByRole("textbox", { name: "概念 / 知识名称", exact: true })
    .fill("可空工具调用");
  await page
    .getByRole("textbox", { name: "随手记下的理解或原始材料（可选）" })
    .fill("必须保留的原始材料");
  await page.getByRole("button", { name: "保存到知识库", exact: true }).click();
  await expect(page.locator(".entry-heading h1")).toHaveText("可空工具调用");
  expect(
    await repository(page, "return store.getSnapshot().entries[0].content"),
  ).toBe("必须保留的原始材料");
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
  await page.getByRole("button", { name: "确认并应用", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".markdown")).toContainText("自动整理已经成功");
  await expect
    .poll(() =>
      repository(page, "return store.getSnapshot().entries[0].content"),
    )
    .toContain("必须保留的原始材料");
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page.getByRole("button", { name: "日志", exact: true }).click();
  const explanation = page
    .locator(".diagnostic-record")
    .filter({ hasText: "AI explain" });
  await explanation.locator("summary").click();
  await expect(explanation).toContainText("必须保留的原始材料");
  await expect(explanation).toContainText('"tool_calls": null');
  await expect(explanation).toContainText("raw-fixture");
  failure = true;
  await page.evaluate(async () => {
    const { complete } = await import("/src/services/ai.ts" as string);
    try {
      await complete("agent", [
        { role: "user", content: "错误请求 log-api-key-sentinel" },
      ]);
    } catch {
      /* UI inspects the recorded provider error. */
    }
    const { diagnostics } = await import(
      "/src/services/diagnostics.ts" as string
    );
    await diagnostics.flush();
  });
  await page.reload();
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page.getByRole("button", { name: "日志", exact: true }).click();
  await page
    .getByRole("combobox", { name: "筛选日志", exact: true })
    .selectOption("error");
  await expect(page.locator(".diagnostic-record")).toHaveCount(1);
  await page.locator(".diagnostic-record summary").click();
  await expect(page.locator(".diagnostic-record")).toContainText("HTTP 502");
  await expect(page.locator(".diagnostic-record")).toContainText(
    "upstream error [redacted]",
  );
  await expect(page.locator(".diagnostic-record")).not.toContainText(
    "log-api-key-sentinel",
  );
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出日志", exact: true }).click();
  const file = await downloaded;
  const contents = await readFile((await file.path())!, "utf8");
  expect(contents).not.toContain("log-api-key-sentinel");
  expect(
    JSON.parse(contents).some((r: { response?: string }) =>
      r.response?.includes('"tool_calls": null'),
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "清空日志", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认清空日志" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await expect(page.locator(".diagnostic-record")).toHaveCount(1);
  await page.getByRole("button", { name: "清空日志", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认清空日志" })
    .getByRole("button", { name: "清空日志", exact: true })
    .click();
  await expect(page.locator(".diagnostic-record")).toHaveCount(0);
  expect(
    await repository(page, "return store.getSnapshot().entries.length"),
  ).toBe(1);
});

test("AI, tasks, notifications, WebDAV and MCP save automatically and survive navigation and reload", async ({
  page,
}) => {
  await page.context().grantPermissions(["notifications"]);
  await page.goto("/");
  await configure(page);
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page.getByRole("button", { name: "护眼", exact: true }).click();
  await page.getByRole("button", { name: "AI 与模型", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存 AI 配置" })).toHaveCount(
    0,
  );
  await page
    .getByLabel("API Key（加密保存与同步）", { exact: true })
    .fill("auto-key-new-sentinel");
  await page.getByRole("button", { name: "任务与提示词", exact: true }).click();
  await page
    .getByRole("combobox", { name: "思考深度", exact: true })
    .selectOption("high");
  await page
    .getByRole("textbox", { name: "提示词模板", exact: true })
    .fill("自动保存提示词 {{title}}");
  await page.getByRole("button", { name: "通知设置", exact: true }).click();
  await page.getByLabel("主窗口失去焦点后，AI 响应结束时通知").uncheck();
  await page.getByLabel("自动同步失败时通知").check();
  await page
    .getByRole("button", { name: "数据库与云同步", exact: true })
    .click();
  await page
    .getByLabel("WebDAV 根目录", { exact: true })
    .fill("https://dav.example/knowledge/");
  await page.getByLabel("用户名", { exact: true }).fill("auto-user");
  await page
    .getByLabel("密码 / 应用密码", { exact: true })
    .fill("auto-dav-password-sentinel");
  await page.getByRole("button", { name: "MCP", exact: true }).click();
  await page.getByRole("button", { name: "添加 MCP", exact: true }).click();
  await page
    .getByRole("textbox", { name: "MCP name", exact: true })
    .fill("自动保存工具");
  await page
    .getByRole("textbox", { name: "MCP URL", exact: true })
    .fill("https://mcp.example");
  await page
    .getByRole("textbox", { name: "MCP token", exact: true })
    .fill("auto-mcp-token-sentinel");
  // Leave the entire settings page immediately, with no Apply or Save click.
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await expect
    .poll(() =>
      repository(page, "return store.getSnapshot().device.mcp[0]?.token"),
    )
    .toBe("auto-mcp-token-sentinel");
  await expect
    .poll(() =>
      repository(
        page,
        "return store.getSnapshot().device.credentialSyncPending",
      ),
    )
    .toEqual({ api: false, connections: false });
  const state = await repository<{
    ai: { tasks: { explain: { prompt: string; effort: string } } };
    device: {
      apiKey: string;
      davUser: string;
      davPassword: string;
      notificationOptions: { syncFailures: boolean; aiWhenUnfocused: boolean };
    };
  }>(page, "const s=store.getSnapshot();return {ai:s.ai,device:s.device}");
  expect(state.ai.tasks.explain).toMatchObject({
    prompt: "自动保存提示词 {{title}}",
    effort: "high",
  });
  expect(
    await repository(
      page,
      "return store.getSnapshot().docs.find(d=>d.id==='appearance').fields.theme",
    ),
  ).toBe("sepia");
  expect(state.device).toMatchObject({
    apiKey: "auto-key-new-sentinel",
    davUser: "auto-user",
    davPassword: "auto-dav-password-sentinel",
    notificationOptions: { syncFailures: true, aiWhenUnfocused: false },
  });
  await page.reload();
  expect(
    await repository(
      page,
      "const s=store.getSnapshot();return {ai:s.ai,device:s.device}",
    ),
  ).toEqual(state);
  const stored = await repository<string>(
    page,
    "return JSON.stringify(await store.db.query('SELECT key,value FROM meta'));",
  );
  expect(stored).not.toContain("auto-key-new-sentinel");
  const logData = await repository<string>(
    page,
    "return JSON.stringify(await store.db.local('diagnostic-log',[]));",
  );
  for (const secret of [
    "auto-key-new-sentinel",
    "auto-dav-password-sentinel",
    "auto-mcp-token-sentinel",
  ])
    expect(logData).not.toContain(secret);
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page.getByRole("button", { name: "AI 与模型", exact: true }).click();
  await page.getByLabel("API Key（加密保存与同步）", { exact: true }).fill("");
  await expect
    .poll(() => repository(page, "return store.getSnapshot().device.apiKey"))
    .toBe("");
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  await page.reload();
  expect(
    await repository(page, "return store.getSnapshot().device.apiKey"),
  ).toBe("");
});

test("an invalid proxy draft does not block saving a valid prompt or calling AI", async ({
  page,
}) => {
  await page.route("https://ai.example/**", (route) =>
    route.fulfill({
      json: { choices: [{ message: { content: "works", tool_calls: null } }] },
    }),
  );
  await page.goto("/");
  await configure(page);
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page.getByRole("button", { name: "网络与代理", exact: true }).click();
  await page
    .getByRole("combobox", { name: "代理方式", exact: true })
    .selectOption("http");
  await expect(page.locator('[data-save-status="error"]')).toBeVisible();
  await page.getByRole("button", { name: "任务与提示词", exact: true }).click();
  await page
    .getByRole("textbox", { name: "提示词模板", exact: true })
    .fill("independent prompt");
  await expect
    .poll(() =>
      repository(page, "return store.getSnapshot().ai.tasks.explain.prompt"),
    )
    .toBe("independent prompt");
  const result = await page.evaluate(async () => {
    const { complete } = await import("/src/services/ai.ts" as string);
    return complete("explain", [
      { role: "user", content: "continue with valid AI settings" },
    ]);
  });
  expect(result.content).toBe("works");
  expect(
    await repository(
      page,
      "return store.getSnapshot().device.proxy?.mode ?? 'system'",
    ),
  ).toBe("system");
});

test("failed autosave retains input, reports errors in logs and retries without reverting valid settings", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await repository(
    page,
    "store.db.originalSetLocal=store.db.setLocal;store.db.setLocal=async function(key,value){if(key==='device')throw Error('fixture disk full');return this.originalSetLocal(key,value)};",
  );
  await page.getByRole("button", { name: "通知设置", exact: true }).click();
  const toggle = page.getByLabel("主窗口失去焦点后，AI 响应结束时通知");
  await toggle.uncheck();
  await expect(page.locator('[data-save-status="error"]')).toContainText(
    "fixture disk full",
  );
  await expect(toggle).not.toBeChecked();
  expect(
    await repository(
      page,
      "return store.getSnapshot().device.notificationOptions ?? null",
    ),
  ).toBeNull();
  await page.getByRole("button", { name: "日志", exact: true }).click();
  await expect(page.locator(".diagnostic-record").first()).toContainText(
    "配置自动保存失败",
  );
  await repository(
    page,
    "store.db.setLocal=store.db.originalSetLocal;delete store.db.originalSetLocal;",
  );
  await page.getByRole("button", { name: "重试自动保存", exact: true }).click();
  await expect(page.locator('[data-save-status="saved"]')).toBeVisible();
  expect(
    await repository(
      page,
      "return store.getSnapshot().device.notificationOptions.aiWhenUnfocused",
    ),
  ).toBe(false);
});
