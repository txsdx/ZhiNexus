/** End-to-end contracts: persistence, rendering, AI review, incremental replication and backup recovery. */
import {
  test,
  expect,
  devices,
  type Page,
  type BrowserContext,
} from "@playwright/test";
/** Import the running development repository without exposing testing hooks in production. */
async function repository<T>(page: Page, fn: string): Promise<T> {
  await expect(page.locator(".app-shell")).toBeVisible();
  return page.evaluate(async (source) => {
    const { store } = await import("/src/core/store.ts" as string);
    return await new Function("store", "return (async()=>{" + source + "})()")(
      store,
    );
  }, fn);
}
/** Provide a shared HTTPS WebDAV endpoint while preserving real client serialization and hash verification. */
async function mockDav(context: BrowserContext, files: Map<string, string>) {
  await context.route("https://dav.example/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname.slice("/knowledge/".length);
    const method = req.method();
    if (method === "MKCOL") {
      await route.fulfill({ status: 201 });
      return;
    }
    if (method === "PROPFIND") {
      const folder = path.replace(/\/$/, "") + "/";
      const names = [...files.keys()].filter(
        (k) => k.startsWith(folder) && !k.slice(folder.length).includes("/"),
      );
      await route.fulfill({
        status: 207,
        contentType: "application/xml",
        body:
          '<d:multistatus xmlns:d="DAV:">' +
          names
            .map(
              (n) =>
                "<d:response><d:href>/knowledge/" +
                n +
                "</d:href></d:response>",
            )
            .join("") +
          "</d:multistatus>",
      });
      return;
    }
    if (method === "PUT") {
      files.set(path, req.postData()!);
      await route.fulfill({ status: 201 });
      return;
    }
    await route.fulfill({
      status: files.has(path) ? 200 : 404,
      contentType: "application/json",
      body: files.get(path) || "{}",
    });
  });
}
test("capture, edit, fuzzy search, formula/diagram render, reload and mobile settings", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "载入示例" }).click();
  await expect(page.locator(".entry-row")).toHaveCount(3);
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });
  await page.locator(".entry-row").filter({ hasText: "间隔重复" }).click();
  await expect(page.locator(".katex").first()).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator('[data-editor-mode="source"]').click();
  await page
    .getByRole("textbox", { name: "Markdown", exact: true })
    .fill("# 持久化测试\n\n已保存的理解。");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  // A click starts asynchronous durable storage; reload only after the editor acknowledges the saved content.
  await expect(page.locator(".entry-heading .title-input")).toHaveCount(0);
  await expect(page.locator(".markdown")).toContainText("已保存的理解");
  await page.reload();
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await page.locator(".entry-row").filter({ hasText: "间隔重复" }).click();
  await expect(page.locator(".markdown")).toContainText("已保存的理解");
  await page.getByRole("button", { name: "返回知识库" }).click();
  await page.getByRole("textbox", { name: "搜索知识" }).fill("费曼学");
  await expect(page.locator(".entry-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.locator(".entry-row").filter({ hasText: "Local-first" }).click();
  await expect(page.locator(".diagram svg")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "一个舒适的思考空间" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/settings-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("AI review persists answer and grade then schedules and enriches the entry", async ({
  page,
}) => {
  await page.route("https://ai.example/**", async (route) => {
    const body = route.request().postDataJSON();
    const prompt = body.messages[0].content;
    const answer = prompt.includes("用户答案：")
      ? {
          score: 55,
          feedback: "缺少迁移解释",
          missing: "需要主动提取，不只是重读。",
          lesson: "先合上书，再解释。",
        }
      : {
          question: "为什么主动回忆有用？",
          type: "short",
          choices: [],
          answer: "主动提取强化记忆",
          rubric: "解释提取作用",
        };
    await route.fulfill({
      json: { choices: [{ message: { content: JSON.stringify(answer) } }] },
    });
  });
  await page.goto("/");
  await repository(
    page,
    `const ai=store.getSnapshot().ai;ai.baseUrl='https://ai.example/v1';ai.models=[{id:'test',name:'Test',efforts:['medium','high'],thinking:true,tools:true,vision:false,image:false}];for(const k of Object.keys(ai.tasks))ai.tasks[k].model='test';await store.saveAI(ai);await store.saveDevice({...store.getSnapshot().device,apiKey:'test-only'});await store.createEntry('主动回忆','主动从记忆提取知识');`,
  );
  await page.getByRole("button", { name: /^复习队列/ }).click();
  await page.locator(".queue>button").click();
  await page.locator(".review-workspace textarea").fill("不看书独立解释");
  await expect(page.locator(".review-workspace textarea")).toHaveValue(
    "不看书独立解释",
  );
  await page.reload();
  await page.getByRole("button", { name: /^复习队列/ }).click();
  await expect(page.locator(".review-workspace textarea")).toHaveValue(
    "不看书独立解释",
  );
  await page.getByRole("button", { name: "检查我的理解" }).click();
  await expect(page.locator(".score strong")).toHaveText("55");
  await page.getByRole("button", { name: "记录结果并继续" }).click();
  await expect(page.locator(".review-workspace")).toHaveCount(0);
  expect(
    await repository(page, `return store.getSnapshot().reviews[0].phase;`),
  ).toBe("done");
  expect(
    await repository(page, `return store.getSnapshot().entries[0].card.reps;`),
  ).toBe(1);
  expect(
    await repository(page, `return store.getSnapshot().entries[0].content;`),
  ).toContain("需要主动提取");
});
test("two offline replicas converge; repeated sync sends no known logs; corruption is rejected", async ({
  browser,
}) => {
  const files = new Map<string, string>(),
    a = await browser.newContext({ locale: "zh-CN" }),
    b = await browser.newContext({ locale: "zh-CN" });
  await mockDav(a, files);
  await mockDav(b, files);
  const pa = await a.newPage(),
    pb = await b.newPage();
  await pa.goto("/");
  await pb.goto("/");
  await expect(pa.locator("h1")).toBeVisible();
  await expect(pb.locator("h1")).toBeVisible();
  for (const p of [pa, pb])
    await repository(
      p,
      `await store.saveDevice({...store.getSnapshot().device,davUrl:'https://dav.example/knowledge/',davUser:'test',davPassword:'test',syncMinutes:0});`,
    );
  const id = await repository<string>(
    pa,
    `return await store.createEntry('并发概念','initial');`,
  );
  const sync = async (p: Page) =>
    p.evaluate(async () => {
      const { synchronize } = await import("/src/services/sync.ts" as string);
      return synchronize();
    });
  await sync(pa);
  await sync(pb);
  await repository(
    pa,
    `await store.patch('entry','${id}',{content:'电脑编辑'});`,
  );
  await repository(
    pb,
    `await store.patch('entry','${id}',{content:'手机编辑'});`,
  );
  await sync(pa);
  await sync(pb);
  await sync(pa);
  const ea = await repository(pa, "return store.getSnapshot().events;"),
    eb = await repository(pb, "return store.getSnapshot().events;");
  expect((ea as { hash: string }[]).map((e) => e.hash).sort()).toEqual(
    (eb as { hash: string }[]).map((e) => e.hash).sort(),
  );
  expect(
    await repository(
      pa,
      `return store.getSnapshot().docs.find(d=>d.id==='${id}').conflicts.content.length;`,
    ),
  ).toBe(2);
  expect((await sync(pa)).sent).toBe(0);
  const [path, payload] = [...files.entries()].find(([k]) =>
    k.startsWith("events/"),
  )!;
  const old = JSON.parse(payload);
  old.op.patch.content = "TAMPERED";
  files.set(path, JSON.stringify(old));
  const c = await browser.newContext();
  await mockDav(c, files);
  const pc = await c.newPage();
  await pc.goto("/");
  await expect(pc.locator("h1")).toBeVisible();
  await repository(
    pc,
    `await store.saveDevice({...store.getSnapshot().device,davUrl:'https://dav.example/knowledge/',davUser:'test',davPassword:'test'});`,
  );
  expect(
    await sync(pc).then(
      () => "",
      (e) => e.message,
    ),
  ).toContain("日志完整性校验失败");
  expect(
    await repository(pc, "return store.getSnapshot().entries.length;"),
  ).toBe(0);
  await a.close();
  await b.close();
  await c.close();
});

test("UI capture, image attachment, encrypted backup and lossless union restore", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /记录新知识/ }).click();
  await page
    .getByRole("textbox", { name: "概念 / 知识名称", exact: true })
    .fill("贝叶斯定理");
  await page
    .getByRole("textbox", { name: "随手记下的理解或原始材料（可选）" })
    .fill("# 贝叶斯定理\n\n根据证据更新信念。");
  await page.getByRole("button", { name: "保存到知识库" }).click();
  await expect(page.locator(".entry-heading h1")).toHaveText("贝叶斯定理");
  await page.locator(".editor-toolbar input[type=file]").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIn0AAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".entry-heading .title-input")).toHaveCount(0);
  await expect(page.locator(".markdown img")).toBeVisible();
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page
    .getByRole("button", { name: "数据库与云同步", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "一个舒适的思考空间" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "备份到文件", exact: true }).click();
  await page
    .getByRole("dialog")
    .locator("input[type=password]")
    .fill("knowledge-backup-test-pass");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "加密并导出" }).click();
  const download = await downloadPromise,
    path = (await download.path())!;
  const { readFile } = await import("node:fs/promises");
  expect(await readFile(path, "utf8")).not.toContain("根据证据");
  const context = await browser.newContext({ locale: "zh-CN" }),
    other = await context.newPage();
  await other.goto("/");
  await repository(
    other,
    `await store.createEntry('本地不能丢失','local only');`,
  );
  await other.getByRole("button", { name: "设置与偏好" }).click();
  await other
    .getByRole("button", { name: "数据库与云同步", exact: true })
    .click();
  await other
    .locator("label")
    .filter({ hasText: "从文件恢复" })
    .locator("input[type=file]")
    .setInputFiles(path);
  await other
    .getByRole("dialog")
    .locator("input[type=password]")
    .fill("knowledge-backup-test-pass");
  other.on("dialog", (d) => d.dismiss());
  await other.getByRole("button", { name: "解密验证并合并" }).click();
  await expect(other.getByRole("dialog")).toHaveCount(0);
  expect(
    await repository(
      other,
      `return store.getSnapshot().entries.map(e=>e.title).sort();`,
    ),
  ).toEqual(["本地不能丢失", "贝叶斯定理"].sort());
  const audit = await other.evaluate(async () => {
    const { auditLocal } = await import("/src/services/integrity.ts" as string);
    return auditLocal();
  });
  expect(audit.events).toBeGreaterThan(0);
  expect(audit.blobs).toBe(1);
  await context.close();
});

test("automatic classification previews the tree before applying changes", async ({
  page,
}) => {
  await page.goto("/");
  const ids = await repository<{ entry: string; category: string }>(
    page,
    `const category='science';await store.patch('category',category,{name:'科学',parent:''});const entry=await store.createEntry('量子','量子态');const ai=store.getSnapshot().ai;ai.baseUrl='https://ai.example/v1';ai.tasks.classify.model='test';await store.saveAI(ai);await store.saveDevice({...store.getSnapshot().device,apiKey:'test'});return {entry,category};`,
  );
  await page.route("https://ai.example/**", (route) =>
    route.fulfill({
      json: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                categories: [
                  { id: "physics", name: "物理", parent: ids.category },
                ],
                assignments: [{ entryId: ids.entry, category: "physics" }],
              }),
            },
          },
        ],
      },
    }),
  );
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page.getByRole("button", { name: "知识分类", exact: true }).click();
  await page.getByRole("button", { name: /一键智能整理/ }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toContainText("变更前");
  await expect(modal).toContainText("变更后");
  expect(
    await repository(page, `return store.getSnapshot().entries[0].category;`),
  ).toBe("");
  await modal.getByRole("button", { name: "确认并应用" }).click();
  await expect(modal).toHaveCount(0);
  expect(
    await repository(page, `return store.getSnapshot().entries[0].category;`),
  ).toBe("physics");
});

test("assistant tool writes require confirmation and topic context survives reload", async ({
  page,
}) => {
  await page.goto("/");
  const id = await repository<string>(
    page,
    `const entry=await store.createEntry('测试概念','original');const ai=store.getSnapshot().ai;ai.baseUrl='https://ai.example/v1';ai.models=[{id:'test',name:'Test',efforts:['medium'],thinking:true,tools:true,vision:false,image:false}];ai.tasks.agent.model='test';await store.saveAI(ai);await store.saveDevice({...store.getSnapshot().device,apiKey:'test'});return entry;`,
  );
  await page.route("https://ai.example/**", async (route) => {
    const body = route.request().postDataJSON();
    const done = body.messages.some((m: { role: string }) => m.role === "tool");
    await route.fulfill({
      json: {
        choices: [
          {
            message: done
              ? { content: "已按你的确认更新知识。" }
              : {
                  content: "建议补充一个例子。",
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "update_entry",
                        arguments: JSON.stringify({
                          id,
                          content: "approved content",
                        }),
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
  await page.locator(".chat-input textarea").fill("为测试概念补充内容");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Agent 替换词条内容");
  expect(
    await repository(page, `return store.getSnapshot().entries[0].content;`),
  ).toBe("original");
  await page.getByRole("button", { name: "允许本次" }).click();
  await expect(page.locator(".messages")).toContainText("已按你的确认更新知识");
  expect(
    await repository(page, `return store.getSnapshot().entries[0].content;`),
  ).toBe("approved content");
  await page.reload();
  await page.getByRole("button", { name: "学习伙伴", exact: true }).click();
  await expect(page.locator(".messages")).toContainText("已按你的确认更新知识");
});

test("configured capture enriches the entry while preserving raw source material", async ({
  page,
}) => {
  await page.goto("/");
  await repository(
    page,
    `const ai=store.getSnapshot().ai;ai.baseUrl='https://ai.example/v1';ai.tasks.explain.model='test';await store.saveAI(ai);await store.saveDevice({...store.getSnapshot().device,apiKey:'test'});`,
  );
  await page.route("https://ai.example/**", (route) =>
    route.fulfill({
      json: {
        choices: [
          {
            message: {
              content:
                "# 认知负荷\n\n## 一句话理解\n工作记忆处理信息所承受的负担。",
            },
          },
        ],
      },
    }),
  );
  await page.getByRole("button", { name: /记录新知识/ }).click();
  await page
    .getByRole("textbox", { name: "概念 / 知识名称", exact: true })
    .fill("认知负荷");
  await page
    .getByRole("textbox", { name: "随手记下的理解或原始材料（可选）" })
    .fill("课堂里同时处理太多信息会很累。");
  await page.getByRole("button", { name: "保存到知识库" }).click();
  await expect(page.locator(".paper .markdown")).toContainText(
    "工作记忆处理信息所承受的负担",
  );
  await expect(page.locator(".paper .markdown")).toContainText(
    "课堂里同时处理太多信息会很累",
  );
});

test("same-profile tabs preserve simultaneous commits and refreshes", async ({
  page,
  context,
}) => {
  const other = await context.newPage();
  await page.goto("/");
  await other.goto("/");
  await Promise.all([
    repository(
      page,
      `for(let i=0;i<8;i++)await store.createEntry('电脑窗口 '+i,'A');`,
    ),
    repository(
      other,
      `for(let i=0;i<8;i++)await store.createEntry('并行窗口 '+i,'B');`,
    ),
  ]);
  await page.reload();
  await other.reload();
  expect(
    await repository(page, "return store.getSnapshot().entries.length;"),
  ).toBe(16);
  expect(
    await repository(other, "return store.getSnapshot().entries.length;"),
  ).toBe(16);
});

test("encrypted credential vault replicates secrets without exposing them or replacing notification preferences", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await repository(
    page,
    `await store.saveDevice({...store.getSnapshot().device,apiKey:'secret-api-sentinel',davUrl:'https://dav.example/knowledge/',davUser:'private-user',davPassword:'secret-dav-sentinel',mcp:[{id:'mcp1',name:'Private MCP',url:'https://mcp.example/rpc',token:'secret-mcp-sentinel',enabled:false}]});`,
  );
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page
    .getByRole("button", { name: "数据库与云同步", exact: true })
    .click();
  await page
    .getByLabel("保险箱密码（不保存）")
    .fill("a unique vault test passphrase");
  await page.getByRole("button", { name: "封存本机已保存凭证供同步" }).click();
  await expect(page.locator(".toast")).toContainText("已加密保存");
  const events = await repository<unknown[]>(
    page,
    "return store.getSnapshot().events;",
  );
  const serialized = JSON.stringify(events);
  for (const sentinel of [
    "secret-api-sentinel",
    "secret-dav-sentinel",
    "secret-mcp-sentinel",
  ])
    expect(serialized).not.toContain(sentinel);
  const context = await browser.newContext({ locale: "zh-CN" }),
    other = await context.newPage();
  await other.goto("/");
  await repository(
    other,
    `await store.ingest(${serialized});await store.saveDevice({...store.getSnapshot().device,notifications:true,syncMinutes:0});`,
  );
  await other.getByRole("button", { name: "设置与偏好" }).click();
  await other
    .getByRole("button", { name: "数据库与云同步", exact: true })
    .click();
  await other
    .getByLabel("保险箱密码（不保存）")
    .fill("a unique vault test passphrase");
  await other.getByRole("button", { name: "解锁并应用共享凭证" }).click();
  await expect(other.locator(".toast")).toContainText("已应用保险箱");
  expect(
    await repository(other, "return store.getSnapshot().device.apiKey;"),
  ).toBe("secret-api-sentinel");
  expect(
    await repository(other, "return store.getSnapshot().device.mcp[0].token;"),
  ).toBe("secret-mcp-sentinel");
  expect(
    await repository(other, "return store.getSnapshot().device.notifications;"),
  ).toBe(true);
  await context.close();
});

test("verified local checkpoint recovers a damaged SQLite image without clearing knowledge", async ({
  page,
}) => {
  await page.goto("/");
  await repository(
    page,
    `await store.createEntry('恢复测试','不能丢失的笔记');`,
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("keyval", "readwrite");
          tx.objectStore("keyval").put(
            new Uint8Array([0, 1, 2, 3, 4]),
            "zhinexus.sqlite.v1",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
  expect(
    await repository(page, "return store.getSnapshot().entries[0].content;"),
  ).toBe("不能丢失的笔记");
  await expect(page.locator(".toast")).toContainText("数据库已从验证副本恢复");
});

test("category rename, move and removal preserve entries and reject cycles", async ({
  page,
}) => {
  await page.goto("/");
  await repository(
    page,
    `await store.patch('category','a',{name:'大类',parent:''});await store.patch('category','b',{name:'子类',parent:'a'});await store.createEntry('类别中的知识','content','test','b');`,
  );
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page.getByRole("button", { name: "知识分类", exact: true }).click();
  await page.getByRole("button", { name: "编辑分类 子类" }).click();
  await page.getByRole("textbox", { name: "修改分类名称" }).fill("新子类");
  await page.getByRole("button", { name: "保存分类" }).click();
  await expect(
    page.getByRole("button", { name: "编辑分类 新子类" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除分类 新子类" }).click();
  await expect(
    page.getByRole("button", { name: "编辑分类 新子类" }),
  ).toHaveCount(0);
  expect(
    await repository(page, "return store.getSnapshot().entries[0].category;"),
  ).toBe("a");
});

test("cloud audit repairs corrupt bytes with quarantine and restores snapshots by union", async ({
  page,
  context,
  browser,
}) => {
  const files = new Map<string, string>();
  await mockDav(context, files);
  await page.goto("/");
  await repository(
    page,
    `await store.saveDevice({...store.getSnapshot().device,davUrl:'https://dav.example/knowledge/',davUser:'test',davPassword:'test',syncMinutes:0});await store.createEntry('云恢复','verified');`,
  );
  await page.evaluate(async () => {
    const s = await import("/src/services/sync.ts" as string);
    await s.synchronize();
    await s.uploadSnapshot();
  });
  const [path, body] = [...files.entries()].find(([key]) =>
    key.startsWith("events/"),
  )!;
  const corrupt = JSON.parse(body);
  corrupt.op.patch.content = "BROKEN";
  files.set(path, JSON.stringify(corrupt));
  const result = await page.evaluate(async () => {
    const { auditAndRepair } = await import(
      "/src/services/integrity.ts" as string
    );
    return auditAndRepair();
  });
  expect(result.repaired).toBeGreaterThan(0);
  expect([...files.keys()].some((k) => k.startsWith("quarantine/"))).toBe(true);
  expect(files.get(path)).toBe(body);
  const otherContext = await browser.newContext({ locale: "zh-CN" });
  await mockDav(otherContext, files);
  const other = await otherContext.newPage();
  await other.goto("/");
  await repository(
    other,
    `await store.createEntry('本地保留','local');await store.saveDevice({...store.getSnapshot().device,davUrl:'https://dav.example/knowledge/',davUser:'test',davPassword:'test',syncMinutes:0});`,
  );
  await other.evaluate(async () => {
    const { recoverCloudSnapshots } = await import(
      "/src/services/integrity.ts" as string
    );
    await recoverCloudSnapshots();
  });
  expect(
    await repository(
      other,
      "return store.getSnapshot().entries.map(e=>e.title).sort();",
    ),
  ).toEqual(["云恢复", "本地保留"].sort());
  await otherContext.close();
});

test("agent write receipts prevent duplicate operations after delivery retries", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  const result = await page.evaluate(async () => {
    const { executeKnowledgeTool } = await import(
      "/src/services/agent-tools.ts" as string
    );
    let confirmations = 0;
    const allow = async () => {
      confirmations++;
      return true;
    };
    const a = await executeKnowledgeTool(
      "create_entry",
      { title: "幂等测试", content: "once" },
      "tool-test-receipt",
      allow,
    );
    const b = await executeKnowledgeTool(
      "create_entry",
      { title: "幂等测试", content: "once" },
      "tool-test-receipt",
      allow,
    );
    return { a, b, confirmations };
  });
  expect(result.confirmations).toBe(1);
  expect(result.a).toEqual(result.b);
  expect(
    await repository(page, "return store.getSnapshot().entries.length;"),
  ).toBe(1);
});

test("notification settings are independent, persistent and per device", async ({
  page,
  browser,
}) => {
  await page.context().grantPermissions(["notifications"]);
  await page.goto("/");
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await expect(page.locator('[data-settings-tab="mcp"]')).toBeVisible();
  const order = await page
    .locator("[data-settings-tab]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-settings-tab")),
    );
  expect(order.indexOf("mcp")).toBe(order.indexOf("prompts") + 1);
  await page.locator('[data-settings-tab="notifications"]').click();
  await expect(
    page.getByRole("heading", { name: "按你的节奏提醒" }),
  ).toBeVisible();
  await page.getByLabel("主窗口失去焦点后，AI 响应结束时通知").uncheck();
  await page.getByLabel("自动同步失败时通知").check();
  await page.getByRole("button", { name: "保存通知设置", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("通知设置已保存");
  await page.reload();
  expect(
    await repository(
      page,
      "return store.getSnapshot().device.notificationOptions",
    ),
  ).toMatchObject({ aiWhenUnfocused: false, syncFailures: true });
  const other = await browser.newContext();
  try {
    const p = await other.newPage();
    await p.goto("/");
    expect(
      await repository(
        p,
        "return store.getSnapshot().device.notificationOptions ?? null",
      ),
    ).toBeNull();
  } finally {
    await other.close();
  }
});

test("API keys synchronize automatically as ciphertext, with optional custom keys", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    files = new Map<string, string>();
  try {
    await mockDav(a, files);
    await mockDav(b, files);
    const pa = await a.newPage(),
      pb = await b.newPage();
    await pa.goto("/");
    await pb.goto("/");
    const setup =
      'await store.saveDevice({...store.getSnapshot().device,davUrl:"https://dav.example/knowledge",davUser:"fixture",davPassword:"fixture",syncMinutes:0});';
    await repository(pa, setup);
    await repository(pb, setup);
    await repository(
      pa,
      'const {saveAIAndKey}=await import("/src/services/key-sync.ts");await saveAIAndKey({...store.getSnapshot().ai,baseUrl:"http://localhost:8317/v1/chat/completions"},"Bearer synced-fixture-key","");const {synchronize}=await import("/src/services/sync.ts");await synchronize();',
    );
    await repository(
      pb,
      'const {synchronize}=await import("/src/services/sync.ts");await synchronize();',
    );
    await expect
      .poll(() => repository(pb, "return store.getSnapshot().device.apiKey"))
      .toBe("synced-fixture-key");
    expect([...files.values()].join("\n")).not.toContain("synced-fixture-key");
    await pb.reload();
    expect(
      await repository(pb, "return store.getSnapshot().device.apiKey"),
    ).toBe("synced-fixture-key");
    await repository(
      pa,
      'const {saveAIAndKey}=await import("/src/services/key-sync.ts");await saveAIAndKey(store.getSnapshot().ai,"custom-fixture-key","optional-private-key");const {synchronize}=await import("/src/services/sync.ts");await synchronize();',
    );
    await repository(
      pb,
      'const {synchronize}=await import("/src/services/sync.ts");await synchronize();',
    );
    await expect
      .poll(() =>
        repository(
          pb,
          'const {keySyncStatus}=await import("/src/services/key-sync.ts");return keySyncStatus.getSnapshot().status;',
        ),
      )
      .toBe("locked");
    expect(
      await repository(pb, "return store.getSnapshot().device.apiKey"),
    ).toBe("synced-fixture-key");
    await repository(
      pb,
      'await store.saveDevice({...store.getSnapshot().device,apiKeySyncKey:"optional-private-key"});',
    );
    await expect
      .poll(() => repository(pb, "return store.getSnapshot().device.apiKey"))
      .toBe("custom-fixture-key");
    expect([...files.values()].join("\n")).not.toContain("custom-fixture-key");
    expect([...files.values()].join("\n")).not.toContain(
      "optional-private-key",
    );
  } finally {
    await a.close();
    await b.close();
  }
});

test("desktop navigation remains reachable in a short high-DPI workspace", async ({
  page,
}) => {
  await page.setViewportSize({ width: 992, height: 688 });
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.systemScale = "1.5";
  });
  const settings = page.getByRole("button", { name: "设置与偏好" });
  await settings.scrollIntoViewIfNeeded();
  const bounds = await settings.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(688);
  await settings.click();
  await expect(
    page.locator('[data-settings-tab="notifications"]'),
  ).toBeVisible();
});

test("merged database page repairs local corruption from cloud and snapshot union without losing offline edits", async ({
  page,
  context,
}) => {
  const files = new Map<string, string>();
  await mockDav(context, files);
  await page.goto("/");
  await repository(
    page,
    `await store.saveDevice({...store.getSnapshot().device,davUrl:'https://dav.example/knowledge/',syncMinutes:0});
    const bytes=new Uint8Array([1,2,3,4]);const hash=await store.db.putBlob(bytes,'image/png');
    await store.createEntry('云端完整副本','asset:'+hash);`,
  );
  await page.evaluate(async () => {
    const s = await import("/src/services/sync.ts" as string);
    await s.synchronize();
    await s.uploadSnapshot();
  });
  // Remove an operation from the live cloud folder; its independently verified full snapshot still retains it.
  const eventPath = [...files.keys()].find((p) => p.startsWith("events/"))!;
  files.delete(eventPath);
  await repository(
    page,
    `await store.createEntry('尚未同步的新知','must survive');
    const rows=await store.db.rawEvents();await store.db.write(()=>store.db.exec('UPDATE events SET json=? WHERE hash=?',['{broken',rows[0].hash]));
    const [hash]=await store.db.blobHashes();await store.db.write(()=>store.db.exec('UPDATE blobs SET data=? WHERE hash=?',['AAAA',hash]));`,
  );
  await page.getByRole("button", { name: "设置与偏好" }).click();
  await page.locator('[data-settings-tab="database"]').click();
  await expect(page.locator('[data-settings-tab="sync"]')).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "WebDAV 云同步" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "校验、修复并清理" }).click();
  await expect(page.locator(".report")).toContainText("cloudRoot");
  const report = JSON.parse(
    (await page.locator(".report").innerText()).slice("SQLite: ok\n".length),
  );
  expect(report.root).toBe(report.cloudRoot);
  expect(report.state).toBe(report.cloudState);
  expect(report.blobs).toBe(1);
  expect(files.has(eventPath)).toBe(true);
  expect(
    await repository(
      page,
      "return store.getSnapshot().entries.map(e=>e.title).sort()",
    ),
  ).toEqual(["云端完整副本", "尚未同步的新知"].sort());
  expect(
    await repository(
      page,
      `const [hash]=await store.db.blobHashes();return Array.from((await store.db.blob(hash)).bytes)`,
    ),
  ).toEqual([1, 2, 3, 4]);
  await page.reload();
  expect(
    await repository(page, "return store.getSnapshot().entries.length"),
  ).toBe(2);
});

test("deep verification refuses unrepairable cloud corruption and skips cleanup", async ({
  page,
  context,
}) => {
  const files = new Map<string, string>();
  await mockDav(context, files);
  await page.goto("/");
  await repository(
    page,
    `await store.saveDevice({...store.getSnapshot().device,davUrl:'https://dav.example/knowledge/',syncMinutes:0});await store.createEntry('必须保留','local');`,
  );
  const badPath = "events/" + "f".repeat(64) + ".json";
  files.set(badPath, "{broken");
  const result = await page.evaluate(async () => {
    const { auditAndRepair } = await import(
      "/src/services/integrity.ts" as string
    );
    try {
      await auditAndRepair();
      return "unexpected success";
    } catch (e) {
      return String(e);
    }
  });
  expect(result).toContain("No verified repair source");
  expect(files.get(badPath)).toBe("{broken");
  expect(
    await repository(page, "return store.getSnapshot().entries[0].title"),
  ).toBe("必须保留");
  await repository(page, `await store.createEntry('失败后仍可编辑','works');`);
  expect(
    await repository(page, "return store.getSnapshot().entries.length"),
  ).toBe(2);
});

test("deep verification retries concurrent cloud additions before certifying equal digests", async ({
  page,
}) => {
  await page.goto("/");
  await repository(page, `await store.createEntry('离线内容','local');`);
  const result = await page.evaluate(async () => {
    const { auditAndRepair } = await import(
      "/src/services/integrity.ts" as string
    );
    const { sha256, canonical } = await import("/src/core/crypto.ts" as string);
    const files = new Map<string, string>();
    let eventLists = 0;
    const transport = {
      init: async () => {},
      read: async (p: string) => {
        if (!files.has(p)) throw Error("missing");
        return files.get(p)!;
      },
      write: async (p: string, b: string) => {
        files.set(p, b);
      },
      list: async (folder: string) => {
        if (folder === "events" && ++eventLists === 2) {
          const op = {
            schema: 1,
            device: "11111111-1111-4111-8111-111111111111",
            seq: 1,
            vector: { "11111111-1111-4111-8111-111111111111": 1 },
            collection: "category",
            entity: "new-cloud-category",
            patch: { name: "并发云端分类", parent: "" },
            at: new Date().toISOString(),
            source: "test",
          };
          const hash = await sha256(op);
          files.set("events/" + hash + ".json", canonical({ hash, op }));
        }
        return [...files.keys()]
          .filter((p) => p.startsWith(folder + "/"))
          .map((p) => p.slice(folder.length + 1));
      },
    };
    return { report: await auditAndRepair(transport), eventLists };
  });
  expect(result.eventLists).toBeGreaterThanOrEqual(4);
  expect(result.report.root).toBe(result.report.cloudRoot);
  expect(
    await repository(page, "return store.getSnapshot().categories[0].name"),
  ).toBe("并发云端分类");
});

test("knowledge uses a dense category tree with summaries, review dates and FSRS memory coloring", async ({
  page,
}) => {
  await page.goto("/");
  await repository(
    page,
    `await store.patch('category','parent',{name:'父分类',parent:''});await store.patch('category','child',{name:'子分类',parent:'parent'});
 const first=await store.createEntry('熟悉概念','# 熟悉概念\\n\\n## 一句话解释\\n可显示的一句话。','test','parent');
 const old=await store.createEntry('易忘概念','older material','test','child');
 const {schedule}=await import('/src/core/review.ts');
 for(const[id,time]of [[first,new Date()],[old,new Date('2020-01-01T12:00:00Z')]]){const e=store.getSnapshot().entries.find(e=>e.id===id);await store.patch('entry',id,{card:JSON.parse(JSON.stringify(schedule(e.card,95,time)))});}
 await store.createEntry('首次复习的概念','new material');`,
  );
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await expect(page.locator(".entry-row")).toHaveCount(3);
  await expect(
    page.getByRole("columnheader", { name: "一句话解释", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: /上次复习/ }),
  ).toBeVisible();
  await expect(
    page.locator(".entry-row").filter({ hasText: "熟悉概念" }),
  ).toContainText("可显示的一句话。");
  const color = await page.locator(".entry-row").evaluateAll((rows) =>
    rows.map((row) => ({
      title: row.querySelector(".entry-title-cell")?.textContent,
      r: row.querySelector(".memory-cell")?.getAttribute("data-retention"),
    })),
  );
  expect(Number(color.find((x) => x.title === "熟悉概念")!.r)).toBeGreaterThan(
    Number(color.find((x) => x.title === "易忘概念")!.r),
  );
  expect(color.find((x) => x.title === "首次复习的概念")!.r).toBe("unknown");
  await page
    .locator(".category-row")
    .filter({ hasText: "父分类" })
    .getByRole("button")
    .click();
  await expect(page.locator(".entry-row")).toHaveCount(1);
  await page.getByRole("button", { name: "展开全部", exact: true }).click();
  await expect(page.locator(".entry-row")).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .locator(".knowledge-table-scroll")
      .evaluate((e) => e.scrollWidth > e.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/knowledge-tree-mobile.png",
    fullPage: true,
  });
});

test("rich block focus cannot delete hidden sections, tabs keep drafts and reload restores the focused edit", async ({
  page,
}) => {
  await page.goto("/");
  await repository(
    page,
    `await store.createEntry('块式编辑','# Alpha\\n\\n前面的内容必须保留。\\n\\n## Target\\n\\n需要修改的内容。\\n\\n## Next\\n\\n后面的内容必须保留。');await store.createEntry('第二个标签','another entry');`,
  );
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await page.locator(".entry-row").filter({ hasText: "块式编辑" }).click();
  await page.getByRole("button", { name: "聚焦：Target", exact: true }).click();
  await expect(page.locator(".rich-editor")).toContainText("需要修改的内容");
  await expect(page.locator(".rich-editor")).not.toContainText("前面的内容");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "所见即所得编辑器",
    exact: true,
  });
  await editor.fill("聚焦后的新内容");
  await expect(editor).toContainText("聚焦后的新内容");
  // A second full replacement must remain inside the original frozen region after its heading disappeared.
  await editor.fill("第二次聚焦编辑");
  await page.getByRole("button", { name: "返回知识库", exact: true }).click();
  await page.locator(".entry-row").filter({ hasText: "第二个标签" }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab", { name: /块式编辑/ }).click();
  await expect(
    page.getByRole("textbox", { name: "所见即所得编辑器", exact: true }),
  ).toContainText("第二次聚焦编辑");
  await expect(page.locator(".entry-tabs-status")).toContainText(
    "本机草稿已保存",
  );
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "所见即所得编辑器", exact: true }),
  ).toContainText("第二次聚焦编辑");
  await page.getByRole("button", { name: "完整文档", exact: true }).click();
  await expect(page.locator(".rich-editor")).toContainText(
    "前面的内容必须保留",
  );
  await expect(page.locator(".rich-editor")).toContainText(
    "后面的内容必须保留",
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".entry-heading .title-input")).toHaveCount(0);
  const content = await repository<string>(
    page,
    `return store.getSnapshot().entries.find(e=>e.title==='块式编辑').content;`,
  );
  expect(content).toContain("第二次聚焦编辑");
  expect(content).toContain("前面的内容必须保留");
  expect(content).toContain("后面的内容必须保留");
  await page.screenshot({
    path: "test-results/block-editor-tabs.png",
    fullPage: true,
  });
});

test("rich editing retains math, Mermaid and local images, and concurrent saved changes require comparison", async ({
  page,
}) => {
  await page.goto("/");
  const id = await repository<string>(
    page,
    `const hash=await store.db.putBlob(new Uint8Array([137,80,78,71]),'image/png');return store.createEntry('富文本保真','# 标题\\n\\n$x^2$\\n\\n$$\\nE=mc^2\\n$$\\n\\n~~~mermaid\\nflowchart LR\\n A --> B\\n~~~\\n\\n![asset](asset:'+hash+')');`,
  );
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await page.locator(".entry-row").click();
  await expect(page.locator(".rich-editor .katex").first()).toBeVisible();
  await expect(page.locator(".rich-editor .diagram svg")).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator('.block-document [data-type="block-math"]').click();
  await expect(
    page.getByRole("dialog", { name: "编辑 LaTeX 公式" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "LaTeX", exact: true }).fill("F=ma");
  await page.getByRole("button", { name: "应用公式", exact: true }).click();
  await expect(
    page.locator('.block-document [data-type="block-math"]'),
  ).toHaveAttribute("data-latex", "F=ma");
  await page
    .getByRole("textbox", { name: "一句话解释", exact: true })
    .fill("用户设置的一句话");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".entry-heading .title-input")).toHaveCount(0);
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${id}').summary`,
    ),
  ).toBe("用户设置的一句话");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator('[data-editor-mode="source"]').click();
  await page
    .getByRole("textbox", { name: "Markdown", exact: true })
    .fill("# 本地草稿\n\nlocal");
  await repository(
    page,
    `await store.patch('entry','${id}',{content:'# 其他设备\\n\\nremote'});`,
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "保存前比较外部修改" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("其他设备");
  await expect(page.getByRole("dialog")).toContainText("本地草稿");
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${id}').content`,
    ),
  ).toContain("remote");
  await page.getByRole("button", { name: "确认保存草稿", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await repository(
      page,
      `return store.getSnapshot().entries.find(e=>e.id==='${id}').content`,
    ),
  ).toContain("local");
});

test("complex Markdown keeps footnotes and inert HTML in source mode", async ({
  page,
}) => {
  let trackers = 0;
  await page.route("https://tracker.invalid/**", async (r) => {
    trackers++;
    await r.fulfill({ status: 200, body: "" });
  });
  await page.goto("/");
  const source =
    '# 复杂文档\n\n保留脚注[^a]。\n\n[^a]: 原始脚注定义\n\n<img src="https://tracker.invalid/pixel">';
  await repository(
    page,
    `await store.createEntry('原文保留',${JSON.stringify(source)});`,
  );
  await page.getByRole("button", { name: "我的知识库", exact: true }).click();
  await page.locator(".entry-row").click();
  await expect(
    page.locator(".notice").filter({ hasText: "脚注或 HTML" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator('[data-editor-mode="rich"]')).toBeDisabled();
  await expect(
    page.getByRole("textbox", { name: "Markdown", exact: true }),
  ).toHaveValue(source);
  await page
    .getByRole("textbox", { name: "Markdown", exact: true })
    .fill(source.replace("复杂文档", "修改标题"));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".entry-heading .title-input")).toHaveCount(0);
  expect(
    await repository(page, "return store.getSnapshot().entries[0].content"),
  ).toBe(source.replace("复杂文档", "修改标题"));
  expect(trackers).toBe(0);
});

test("an image finishing in a background tab appends to the newest draft without replacing later typing", async ({
  page,
}) => {
  let finishImage: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    finishImage = resolve;
  });
  let started = false;
  await page.route(
    "https://ai.example/v1/images/generations",
    async (route) => {
      started = true;
      await released;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              b64_json:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIn0AAAAASUVORK5CYII=",
            },
          ],
        }),
      });
    },
  );
  try {
    await page.goto("/");
    await repository(
      page,
      `const ai=structuredClone(store.getSnapshot().ai);ai.baseUrl='https://ai.example/v1';ai.tasks.image.model='image-fixture';ai.models=[{id:'image-fixture',name:'Image fixture',efforts:[],thinking:null,tools:null,vision:null,image:true}];await store.saveAI(ai);await store.saveDevice({...store.getSnapshot().device,apiKey:'fixture-key',apiKeyEndpoint:ai.baseUrl});await store.createEntry('后台配图','initial');await store.createEntry('其他标签','other');`,
    );
    await page.getByRole("button", { name: "我的知识库", exact: true }).click();
    await page.locator(".entry-row").filter({ hasText: "后台配图" }).click();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page
      .getByRole("textbox", { name: "所见即所得编辑器", exact: true })
      .fill("生成前的草稿");
    await page.getByRole("button", { name: "AI 配图", exact: true }).click();
    await page
      .getByRole("button", { name: "生成并插入草稿", exact: true })
      .click();
    await expect.poll(() => started).toBe(true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("textbox", { name: "所见即所得编辑器", exact: true })
      .fill("生成期间继续写下的新理解");
    await page.getByRole("button", { name: "返回知识库", exact: true }).click();
    await page.locator(".entry-row").filter({ hasText: "其他标签" }).click();
    finishImage();
    await expect(page.getByRole("tab", { name: /后台配图/ })).toContainText(
      "●",
    );
    await page.getByRole("tab", { name: /后台配图/ }).click();
    await expect(page.locator(".rich-editor img")).toBeVisible();
    await expect(page.locator(".rich-editor")).toContainText(
      "生成期间继续写下的新理解",
    );
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".entry-heading .title-input")).toHaveCount(0);
    const body = await repository<string>(
      page,
      `return store.getSnapshot().entries.find(e=>e.title==='后台配图').content`,
    );
    expect(body).toContain("生成期间继续写下的新理解");
    expect(body).toContain("asset:");
  } finally {
    finishImage();
  }
});

test("mobile rich headings keep the viewport and bottom navigation reachable after restart", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    ...devices["Pixel 5"],
    baseURL,
    locale: "zh-CN",
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await page.locator(".page-heading .primary").click();
    await page.locator(".modal input").fill("移动块编辑导航");
    await page.locator(".modal textarea").fill("# 初始章节\n\n初始内容。");
    await page.locator(".modal .primary").click();
    await page.locator(".entry-heading h1").waitFor();
    await page.locator(".entry-heading .actions button:nth-child(2)").click();
    await page.locator('[data-editor-mode="rich"]').click();
    const body =
      "SQLite content survives a native restart. Rich blocks were edited on Android.";
    await page.locator('.block-document[contenteditable="true"]').fill(body);
    await page.locator(".entry-heading .primary").click();
    await page.locator(".entry-heading h1").waitFor();
    await expect(page.locator(".entry-tabs-status")).toContainText(
      "本机草稿已保存",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.body.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
    await page.screenshot({ path: "test-results/rich-editor-mobile.png" });
    await page.reload();
    await page.locator('.entry-tabs [role="tab"]').waitFor();
    await expect(page.locator(".paper .markdown")).toContainText(body);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.body.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(1);
    await page.locator(".sidebar nav button:nth-child(2)").tap();
    await expect(page.locator(".entry-row")).toHaveCount(1);
    await page.locator(".mobile-settings").tap();
    await page.locator('[data-settings-tab="notifications"]').tap();
    await expect(
      page.locator(".settings-content input[type=checkbox]").first(),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
