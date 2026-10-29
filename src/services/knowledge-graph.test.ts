/** Graph invariants: valid learning DAGs, retained manual links, complete batch coverage and atomic group positions. */
import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  state: {} as any,
  commits: [] as any[],
  beforeCommit: () => {},
}));
vi.mock("../core/store", () => ({
  store: {
    getSnapshot: () => fixture.state,
    batchWhen: async (
      patches: any[],
      _source: string,
      guard: () => boolean,
    ) => {
      fixture.beforeCommit();
      if (!guard()) return false;
      fixture.commits.push(patches);
      for (const p of patches) {
        let d = fixture.state.docs.find(
          (d: any) => d.collection === p.collection && d.id === p.id,
        );
        if (!d) {
          d = { collection: p.collection, id: p.id, fields: {} };
          fixture.state.docs.push(d);
        }
        Object.assign(d.fields, p.patch);
      }
      return true;
    },
  },
  json: (v: unknown) => JSON.parse(JSON.stringify(v)),
}));
import {
  graphBatches,
  graphBatchCount,
  graphCatalog,
  graphSignature,
  relationPatches,
  saveGraphPositions,
  graphPositionSignature,
} from "./knowledge-graph";
beforeEach(() => {
  fixture.state = {
    entries: ["a", "b", "c"].map((id) => ({
      id,
      title: id,
      summary: "summary",
      content: "explanation",
      prerequisites: [],
    })),
    docs: [],
  };
  fixture.commits = [];
  fixture.beforeCommit = () => {};
});
it("retains existing manual pairs, rejects self/unknown references, and prevents multi-step learning cycles", () => {
  fixture.state.docs.push({
    collection: "edge",
    id: "manual",
    fields: { source: "a", target: "b", label: "prerequisite" },
  });
  expect(
    relationPatches([{ source: "b", target: "a", type: "related" }]),
  ).toEqual([]);
  expect(() =>
    relationPatches([{ source: "a", target: "a", type: "related" }]),
  ).toThrow(/自身/);
  expect(() =>
    relationPatches([{ source: "a", target: "deleted", type: "related" }]),
  ).toThrow(/未知/);
  expect(() =>
    relationPatches([
      { source: "b", target: "c", type: "progression" },
      { source: "c", target: "a", type: "prerequisite" },
    ]),
  ).toThrow(/循环/);
  expect(fixture.state.docs).toHaveLength(1);
  expect(
    relationPatches([
      { source: "b", target: "c", type: "progression" },
      { source: "c", target: "a", type: "related" },
    ]),
  ).toHaveLength(2);
});
it("updating one relationship validates the proposed graph after excluding that old edge", () => {
  fixture.state.docs.push({
    collection: "edge",
    id: "edge",
    fields: { source: "a", target: "b", label: "prerequisite" },
  });
  const p = relationPatches(
    [
      {
        source: "b",
        target: "a",
        type: "progression",
        reason: "new direction",
      },
    ],
    "edge",
  );
  expect(p[0]).toMatchObject({
    id: "edge",
    patch: { source: "b", target: "a", label: "progression" },
  });
});
it("reviewed upgrades retain the association ID, preserve directed edges, and still reject learning cycles", () => {
  fixture.state.docs.push(
    {
      collection: "edge",
      id: "ordinary",
      fields: { source: "a", target: "b", label: "related" },
    },
    {
      collection: "edge",
      id: "directed",
      fields: { source: "b", target: "c", label: "prerequisite" },
    },
  );
  const proposal = {
    source: "a",
    target: "b",
    type: "prerequisite" as const,
    reason: "A is required for B",
  };
  expect(relationPatches([proposal])).toEqual([]);
  expect(relationPatches([proposal, proposal], undefined, true)).toMatchObject([
    {
      id: "ordinary",
      patch: { label: "prerequisite", reason: proposal.reason },
    },
  ]);
  expect(
    relationPatches(
      [{ source: "c", target: "b", type: "progression" }],
      undefined,
      true,
    ),
  ).toEqual([]);
  expect(() =>
    relationPatches(
      [proposal, { source: "c", target: "a", type: "progression" }],
      undefined,
      true,
    ),
  ).toThrow(/循环/);
  expect(fixture.state.docs[0].fields.label).toBe("related");
});
it("bounded excerpts mark truncation and pairwise batches can cover every pair without dropping entries", () => {
  fixture.state.entries = Array.from({ length: 41 }, (_, i) => ({
    id: "entry-" + i,
    title: "title",
    summary: "x",
    content: "x".repeat(12000),
    prerequisites: [],
  }));
  const catalog = graphCatalog(),
    groups = graphBatches(catalog, 4096);
  expect(
    catalog.every((e) => e.hasMoreContent && e.content.length === 2000),
  ).toBe(true);
  expect(groups.flat().map((e) => e.id)).toEqual(catalog.map((e) => e.id));
  expect(graphBatchCount([[1], [2], [3, 4]])).toBe(4);
  const pairs = new Set<string>();
  for (let i = 0; i < groups.length; i++)
    for (let j = i; j < groups.length; j++) {
      const entries = i === j ? groups[i] : [...groups[i], ...groups[j]];
      for (const a of entries)
        for (const b of entries)
          if (a.id !== b.id) pairs.add(JSON.stringify([a.id, b.id].sort()));
    }
  expect(pairs.size).toBe((41 * 40) / 2);
});
it("all moved nodes commit together; duplicate drag callbacks do not create another write", async () => {
  const nodes = [
    { id: "a", position: { x: 25, y: 40 } },
    { id: "b", position: { x: 140, y: 40 } },
  ];
  await saveGraphPositions(nodes);
  expect(fixture.commits).toHaveLength(1);
  expect(fixture.commits[0][0].patch).toEqual({
    a: { x: 25, y: 40 },
    b: { x: 140, y: 40 },
  });
  await saveGraphPositions(nodes);
  expect(fixture.commits).toHaveLength(1);
});
it("a concurrent layout change is preserved instead of being overwritten at drag end", async () => {
  fixture.beforeCommit = () =>
    fixture.state.docs.push({
      collection: "setting",
      id: "graph",
      fields: { a: { x: 999, y: 999 } },
    });
  await expect(
    saveGraphPositions([{ id: "a", position: { x: 5, y: 5 } }]),
  ).rejects.toThrow(/已改变/);
  expect(fixture.commits).toHaveLength(0);
});
it("a remote move during the gesture is rejected instead of overwriting newer positions", async () => {
  const before = graphPositionSignature();
  fixture.state.docs.push({
    collection: "setting",
    id: "graph",
    fields: { a: { x: 800, y: 900 } },
  });
  await expect(
    saveGraphPositions([{ id: "a", position: { x: 5, y: 5 } }], before),
  ).rejects.toThrow(/拖动期间/);
  expect(fixture.commits).toHaveLength(0);
});
it("source edits invalidate graph proposals even after their visible excerpt", () => {
  fixture.state.entries[0].content = "x".repeat(5000);
  const before = graphSignature();
  fixture.state.entries[0].content += "new details";
  expect(graphSignature()).not.toBe(before);
});
