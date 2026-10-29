/** Real-pointer graph selection and streamed all-library proposals stay reviewable and atomic. */
import { test, expect } from "@playwright/test";
import {
  repository,
  configure,
  streamingServer,
  delta,
  done,
} from "./helpers/ai-stream";
async function seed(page: import("@playwright/test").Page) {
  return repository<string[]>(
    page,
    `await store.updateDevice({syncMinutes:0});const ids=[];for(const title of ['基础概念','进阶概念','综合应用'])ids.push(await store.createEntry(title,'解释材料'));await store.patch('setting','graph',Object.fromEntries(ids.map((id,i)=>[id,{x:i*260,y:i===2?300:0}])));return ids;`,
  );
}
const graph = (page: import("@playwright/test").Page) =>
  page.locator('.sidebar nav [data-nav="graph"]').click();
test("left-drag marquee selects two nodes and group movement persists every position across reload", async ({
  page,
}) => {
  await page.goto("/");
  const ids = await seed(page);
  await graph(page);
  const first = page.locator(`.react-flow__node[data-id="${ids[0]}"]`),
    second = page.locator(`.react-flow__node[data-id="${ids[1]}"]`);
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const a = (await first.boundingBox())!,
    b = (await second.boundingBox())!;
  await page.mouse.move(Math.min(a.x, b.x) - 14, Math.min(a.y, b.y) - 14);
  await page.mouse.down();
  await page.mouse.move(
    Math.max(a.x + a.width, b.x + b.width) + 14,
    Math.max(a.y + a.height, b.y + b.height) + 14,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(page.locator(".react-flow__node.selected")).toHaveCount(2);
  const before = await repository<Record<string, { x: number; y: number }>>(
    page,
    `return store.getSnapshot().docs.find(d=>d.collection==='setting'&&d.id==='graph').fields;`,
  );
  const selected = (await first.boundingBox())!;
  await page.mouse.move(
    selected.x + selected.width / 2,
    selected.y + selected.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    selected.x + selected.width / 2 + 60,
    selected.y + selected.height / 2 + 45,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect
    .poll(() =>
      repository<number>(
        page,
        `return store.getSnapshot().docs.find(d=>d.collection==='setting'&&d.id==='graph').fields[${JSON.stringify(ids[0])}].x;`,
      ),
    )
    .not.toBe(before[ids[0]].x);
  const after = await repository<Record<string, { x: number; y: number }>>(
    page,
    `return store.getSnapshot().docs.find(d=>d.collection==='setting'&&d.id==='graph').fields;`,
  );
  expect(after[ids[0]].x - before[ids[0]].x).toBeCloseTo(
    after[ids[1]].x - before[ids[1]].x,
    2,
  );
  expect(after[ids[0]].y - before[ids[0]].y).toBeCloseTo(
    after[ids[1]].y - before[ids[1]].y,
    2,
  );
  expect(after[ids[2]]).toEqual(before[ids[2]]);
  await page.reload();
  await expect
    .poll(() =>
      repository(
        page,
        `return store.getSnapshot().docs.find(d=>d.collection==='setting'&&d.id==='graph').fields;`,
      ),
    )
    .toEqual(after);
});
test("all-entry graph analysis streams, stays unapplied when closed, then applies only selected reviewed relations once", async ({
  page,
}) => {
  let ids: string[] = [],
    finish = () => {};
  const server = await streamingServer((body, res) => {
    expect(body.stream).toBe(true);
    for (const id of ids) expect(JSON.stringify(body.messages)).toContain(id);
    delta(res, '{"relations":[');
    finish = () => {
      delta(
        res,
        JSON.stringify({
          source: ids[0],
          target: ids[1],
          type: "prerequisite",
          reason: "基础先于进阶",
        }) +
          "," +
          JSON.stringify({
            source: ids[1],
            target: ids[2],
            type: "progression",
            reason: "从进阶到综合应用",
          }) +
          "]}",
      );
      done(res);
    };
  });
  try {
    await page.goto("/");
    ids = await seed(page);
    await repository(
      page,
      `await store.patch('edge','original-association',{source:${JSON.stringify(ids[0])},target:${JSON.stringify(ids[1])},label:'related',reason:'原有关联'});`,
    );
    await configure(page, server.url);
    await graph(page);
    await page
      .locator(".react-flow__pane")
      .click({ button: "right", position: { x: 16, y: 16 } });
    await page
      .getByRole("menuitem", { name: "自动关联全部条目", exact: true })
      .click();
    await page.getByRole("button", { name: "开始分析", exact: true }).click();
    await expect(page.locator(".ai-stream-content")).toContainText(
      '{"relations":[',
    );
    expect(
      await repository(
        page,
        `return store.getSnapshot().docs.filter(d=>d.collection==='edge').length;`,
      ),
    ).toBe(1);
    finish();
    await expect(
      page.getByRole("heading", { name: /知识关系预览/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    expect(
      await repository(
        page,
        `return store.getSnapshot().docs.filter(d=>d.collection==='edge').length;`,
      ),
    ).toBe(1);
    await expect(page.getByText(/普通关联升级 →/)).toHaveCount(0);
    await page.evaluate(async () => {
      const { aiJobs, openAIJob } = await import(
        "/src/services/ai-jobs.ts" as string
      );
      openAIJob(
        aiJobs.getSnapshot().jobs.find((j: any) => j.kind === "graph").id,
      );
    });
    await page
      .getByRole("checkbox", { name: "应用关系 2", exact: true })
      .uncheck();
    await expect(page.getByText(/普通关联升级 →/)).toBeVisible();
    await page.getByRole("button", { name: "确认并应用", exact: true }).click();
    await expect
      .poll(() =>
        repository(
          page,
          `return store.getSnapshot().docs.filter(d=>d.collection==='edge'&&!d.fields.deleted).map(d=>d.fields.label);`,
        ),
      )
      .toEqual(["prerequisite"]);
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
    expect(
      await repository(
        page,
        `return store.getSnapshot().docs.find(d=>d.collection==='edge'&&!d.fields.deleted).id;`,
      ),
    ).toBe("original-association");
    expect(
      await page.evaluate(async () => {
        const { aiJobs } = await import("/src/services/ai-jobs.ts" as string);
        return aiJobs.getSnapshot().jobs.filter((j: any) => j.kind === "graph")
          .length;
      }),
    ).toBe(0);
  } finally {
    await server.close();
  }
});
test("an edit after generation invalidates the global graph proposal and cannot be forced through", async ({
  page,
}) => {
  let ids: string[] = [];
  const server = await streamingServer((_body, res) => {
    delta(
      res,
      JSON.stringify({
        relations: [
          {
            source: ids[0],
            target: ids[1],
            type: "prerequisite",
            reason: "基础",
          },
        ],
      }),
    );
    done(res);
  });
  try {
    await page.goto("/");
    ids = await seed(page);
    await configure(page, server.url);
    await graph(page);
    await page
      .locator(".react-flow__pane")
      .click({ button: "right", position: { x: 16, y: 16 } });
    await page
      .getByRole("menuitem", { name: "自动关联全部条目", exact: true })
      .click();
    await page.getByRole("button", { name: "开始分析", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /知识关系预览/ }),
    ).toBeVisible();
    await repository(
      page,
      `await store.patch('entry',${JSON.stringify(ids[0])},{content:'新的解释，影响依赖判断'});`,
    );
    await expect(
      page.getByRole("button", { name: "确认并应用", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("请重新生成分析，避免应用过时的星图建议。"),
    ).toBeVisible();
    expect(
      await repository(
        page,
        `return store.getSnapshot().docs.filter(d=>d.collection==='edge').length;`,
      ),
    ).toBe(0);
  } finally {
    await server.close();
  }
});
