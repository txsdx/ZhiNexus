/** Typed graph proposals, safe relationship mutations and persistent group layout shared by UI and Agent tools. */
import { z } from "zod";
import { store, json, type StorePatch } from "../core/store";
import { canonical } from "../core/crypto";
export const relationTypes = [
  "prerequisite",
  "progression",
  "related",
] as const;
/** Directed learning relationships use source as the prerequisite/base and target as the dependent/advanced concept. */
export const graphRelationSchema = z
  .object({
    source: z.string().min(1).max(200),
    target: z.string().min(1).max(200),
    type: z.enum(relationTypes),
    reason: z.string().max(1000).optional(),
  })
  .strict();
export const graphProposalSchema = z
  .object({
    relations: z
      .array(
        graphRelationSchema.extend({
          reason: z.string().trim().min(1).max(1000),
        }),
      )
      .max(10000),
  })
  .strict();
/** A reviewable relationship contains identifiers, a semantic type and optional supporting explanation. */
export type GraphRelation = z.infer<typeof graphRelationSchema>;
/** Active edges only; deleted/missing entries never reappear as ghost graph nodes. */
export function graphEdges() {
  const s = store.getSnapshot(),
    ids = new Set(s.entries.map((e) => e.id));
  return s.docs
    .filter(
      (d) =>
        d.collection === "edge" &&
        !d.fields.deleted &&
        ids.has(String(d.fields.source)) &&
        ids.has(String(d.fields.target)),
    )
    .map((d) => ({
      id: d.id,
      source: String(d.fields.source),
      target: String(d.fields.target),
      type: relationTypes.includes(d.fields.label as GraphRelation["type"])
        ? (d.fields.label as GraphRelation["type"])
        : ("related" as const),
      reason: String(d.fields.reason ?? ""),
      label: String(d.fields.label ?? "related"),
    }));
}
/** Capture all entries as bounded excerpts, explicitly indicating when the explanation is longer. */
export function graphCatalog() {
  return store.getSnapshot().entries.map((e) => ({
    id: e.id,
    title: e.title,
    summary: (e.summary ?? "").slice(0, 400),
    content: e.content.slice(0, 2000),
    hasMoreContent: e.content.length > 2000,
    prerequisites: e.prerequisites.slice(0, 8).map((p) => p.slice(0, 200)),
  }));
}
/** Include full source content in the guard even when generation uses shorter excerpts. */
export function graphSignature(layout = false) {
  const s = store.getSnapshot();
  return canonical({
    entries: s.entries.map((e) => [
      e.id,
      e.title,
      e.summary ?? "",
      e.content,
      e.prerequisites,
    ]),
    edges: s.docs
      .filter((d) => d.collection === "edge")
      .map((d) => [d.id, d.fields]),
    ...(layout
      ? {
          positions:
            s.docs.find((d) => d.collection === "setting" && d.id === "graph")
              ?.fields ?? {},
        }
      : {}),
  });
}
/** Split into size-bounded groups; every group pair is compared so large libraries do not silently omit cross-group candidates. */
export function graphBatches(
  entries: ReturnType<typeof graphCatalog>,
  budget = 24000,
) {
  const groups: (typeof entries)[] = [];
  let group: typeof entries = [],
    size = 0;
  for (const original of entries) {
    const e = {
      ...original,
      content: original.content.slice(0, Math.max(128, budget - 3000)),
      hasMoreContent:
        original.hasMoreContent ||
        original.content.length > Math.max(128, budget - 3000),
    };
    const n = JSON.stringify(e).length;
    if (group.length && (size + n > budget || group.length >= 32)) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(e);
    size += n;
  }
  if (group.length) groups.push(group);
  return groups;
}
/** Count useful group comparisons; a singleton cannot propose a relationship with itself. */
export function graphBatchCount(groups: { length: number }[]) {
  return (
    (groups.length * (groups.length + 1)) / 2 -
    groups.filter((g) => g.length < 2).length
  );
}
/** Retain explicit directed pairs, optionally upgrade ordinary associations after review, and reject invalid learning cycles. */
export function relationPatches(
  proposals: GraphRelation[],
  removedId?: string,
  allowUpgrades = false,
): StorePatch[] {
  const s = store.getSnapshot(),
    ids = new Set(s.entries.map((e) => e.id));
  const edges = graphEdges().filter((e) => e.id !== removedId),
    adjacency = new Map<string, Set<string>>();
  const pair = (a: string, b: string) => JSON.stringify([a, b].sort());
  const pairs = new Set(edges.map((e) => pair(e.source, e.target)));
  const existingPairs = new Map(
    edges.map((e) => [pair(e.source, e.target), e]),
  );
  const proposed = new Set<string>();
  const add = (a: string, b: string) =>
    adjacency.set(a, new Set([...(adjacency.get(a) ?? []), b]));
  for (const e of edges) if (e.type !== "related") add(e.source, e.target);
  const reaches = (from: string, to: string) => {
    const pending = [from],
      seen = new Set<string>();
    while (pending.length) {
      const n = pending.pop()!;
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      pending.push(...(adjacency.get(n) ?? []));
    }
    return false;
  };
  const patches: StorePatch[] = [];
  for (const input of proposals) {
    const r = graphRelationSchema.parse(input);
    if (!ids.has(r.source) || !ids.has(r.target))
      throw Error("关系包含未知或已删除条目 / Unknown graph entry");
    if (r.source === r.target)
      throw Error("不能连接条目自身 / Self relationships are not allowed");
    const key = pair(r.source, r.target);
    if (proposed.has(key)) continue;
    proposed.add(key);
    const existing = existingPairs.get(key);
    if (
      pairs.has(key) &&
      !(allowUpgrades && existing?.type === "related" && r.type !== "related")
    )
      continue;
    if (r.type !== "related") {
      if (reaches(r.target, r.source))
        throw Error(
          "依赖或递进关系会形成循环 / Learning relationships would form a cycle",
        );
      add(r.source, r.target);
    }
    pairs.add(key);
    patches.push({
      collection: "edge",
      id: existing?.id ?? removedId ?? crypto.randomUUID(),
      patch: {
        source: r.source,
        target: r.target,
        label: r.type,
        reason: r.reason ?? "",
        deleted: false,
      },
    });
  }
  return patches;
}
/** Calculate a deterministic left-to-right arrangement without mutating graph documents. */
export async function graphLayoutPatches(): Promise<StorePatch[]> {
  const { default: dagre } = await import("@dagrejs/dagre");
  const s = store.getSnapshot(),
    edges = graphEdges();
  const g = new dagre.graphlib.Graph()
    .setGraph({ rankdir: "LR", nodesep: 70, ranksep: 110 })
    .setDefaultEdgeLabel(() => ({}));
  for (const e of s.entries) g.setNode(e.id, { width: 190, height: 65 });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return [
    {
      collection: "setting",
      id: "graph",
      patch: Object.fromEntries(
        s.entries.map((e) => {
          const p = g.node(e.id);
          return [e.id, json({ x: p.x - 95, y: p.y - 32.5 })];
        }),
      ),
    },
  ];
}
/** Persist only the changed positions of all dragged nodes in one guarded transaction. */
export async function saveGraphPositions(
  nodes: { id: string; position: { x: number; y: number } }[],
  expected?: string,
) {
  const ids = new Set(store.getSnapshot().entries.map((e) => e.id));
  const fields =
    store
      .getSnapshot()
      .docs.find((d) => d.collection === "setting" && d.id === "graph")
      ?.fields ?? {};
  const patch = Object.fromEntries(
    nodes
      .filter(
        (n) =>
          ids.has(n.id) &&
          Number.isFinite(n.position.x) &&
          Number.isFinite(n.position.y) &&
          canonical(fields[n.id] ?? null) !== canonical(n.position),
      )
      .map((n) => [n.id, json(n.position)]),
  );
  if (!Object.keys(patch).length) return;
  const before = canonical(fields);
  if (expected !== undefined && before !== expected)
    throw Error(
      "布局在拖动期间已改变，请重试 / Graph layout changed during dragging; retry",
    );
  const saved = await store.batchWhen(
    [{ collection: "setting", id: "graph", patch }],
    "graph-move",
    () =>
      canonical(
        store
          .getSnapshot()
          .docs.find((d) => d.collection === "setting" && d.id === "graph")
          ?.fields ?? {},
      ) === before &&
      Object.keys(patch).every((id) =>
        store.getSnapshot().entries.some((e) => e.id === id),
      ),
  );
  if (!saved) {
    const current =
      store
        .getSnapshot()
        .docs.find((d) => d.collection === "setting" && d.id === "graph")
        ?.fields ?? {};
    if (
      !Object.entries(patch).every(
        ([id, p]) => canonical(current[id]) === canonical(p),
      )
    )
      throw Error("布局已改变，请重试 / Graph layout changed; retry");
  }
}
/** Capture the layout before a drag so an intervening remote move cannot be overwritten. */
export function graphPositionSignature() {
  return canonical(
    store
      .getSnapshot()
      .docs.find((d) => d.collection === "setting" && d.id === "graph")
      ?.fields ?? {},
  );
}
