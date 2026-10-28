/** Pack size, causal coverage, corruption and local reconstruction contracts. */
import { expect, it } from "vitest";
import { sha256, canonical } from "./crypto";
import type { Envelope, Operation } from "./types";
import {
  preparePacks,
  makeCheckpoint,
  parseCheckpoint,
  verifyCheckpoint,
  readPack,
  knownPack,
  indexEvents,
  packedPath,
  parseHead,
  newPackedPath,
  PACK_LIMITS,
} from "./sync-packs";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
/** Create authentic free-form settings operations, including explicitly supplied causal dependencies. */
async function event(
  seq: number,
  patch: Operation["patch"] = { value: seq },
  device = A,
  vector = { [device]: seq },
): Promise<Envelope> {
  const op: Operation = {
    schema: 1,
    device,
    seq,
    vector,
    collection: "setting",
    entity: "fixture",
    patch,
    at: "2026-10-28T00:00:00.000Z",
    source: "test",
  };
  return { op, hash: await sha256(op) };
}
it("packs thousands of operations into bounded batches and reconstructs the same complete state", async () => {
  const events: Envelope[] = [];
  for (let n = 1; n <= 2048; n++)
    events.push(
      await event(n, { value: n, text: "重复知识正文。".repeat(80) }),
    );
  const packs = await preparePacks([...events].reverse(), 1);
  expect(packs.length).toBe(8);
  expect(
    packs.every(
      (p) =>
        p.ref.count <= PACK_LIMITS.events &&
        p.ref.bytes < PACK_LIMITS.targetBytes,
    ),
  ).toBe(true);
  const checkpoint = await makeCheckpoint(
    events,
    packs.map((p) => p.ref),
    [],
    1,
  );
  const recovered: Envelope[] = [];
  for (const pack of packs)
    recovered.push(...(await readPack(JSON.parse(pack.body), pack.ref)));
  expect(await verifyCheckpoint(checkpoint, recovered)).toEqual(events);
  expect(checkpoint.count).toBe(2048);
}, 15000);
it("can hash an existing local pack without downloading its body and detects a divergent local dot", async () => {
  const events = [await event(1), await event(2)],
    [pack] = await preparePacks(events, 1);
  expect(await knownPack(pack.ref, indexEvents(events))).toEqual(events);
  expect(await knownPack(pack.ref, indexEvents(events.slice(1)))).toBeNull();
  expect(
    await knownPack(
      pack.ref,
      indexEvents([await event(1, { value: "fork" }), events[1]]),
    ),
  ).toBeNull();
});
it("never silently merges two distinct operations at the same writer sequence", async () => {
  const a = await event(1),
    fork = await event(1, { value: "other" });
  await expect(preparePacks([a, fork], 1)).rejects.toThrow("计数器冲突");
});
it("does not certify missing causal predecessors or dependencies", async () => {
  const events = [await event(2)],
    packs = await preparePacks(events, 1);
  await expect(
    makeCheckpoint(
      events,
      packs.map((p) => p.ref),
      [],
      1,
    ),
  ).rejects.toThrow("缺口");
  const observed = [await event(1, { value: 1 }, A, { [A]: 1, [B]: 1 })],
    refs = await preparePacks(observed, 1);
  await expect(
    makeCheckpoint(
      observed,
      refs.map((p) => p.ref),
      [],
      1,
    ),
  ).rejects.toThrow();
});
it("rejects a changed payload, range, count, byte size or replica digest", async () => {
  const events = [await event(1)],
    [pack] = await preparePacks(events, 1),
    checkpoint = await makeCheckpoint(events, [pack.ref], [], 1);
  const body = JSON.parse(pack.body);
  body.events[0].op.patch.value = "tampered";
  await expect(readPack(body, pack.ref)).rejects.toThrow("摘要");
  await expect(
    readPack(JSON.parse(pack.body), { ...pack.ref, bytes: 1 }),
  ).rejects.toThrow();
  expect(() => parseCheckpoint({ ...checkpoint, count: 2 })).toThrow();
  expect(() =>
    parseCheckpoint({
      ...checkpoint,
      packs: [{ ...pack.ref, ranges: [{ device: A, from: 2, to: 2 }] }],
    }),
  ).toThrow();
  await expect(
    verifyCheckpoint({ ...checkpoint, state: "0".repeat(64) }, events),
  ).rejects.toThrow();
  const corrupt = {
    ...events[0],
    op: { ...events[0].op, patch: { value: "bad local row" } },
  };
  await expect(makeCheckpoint([corrupt], [pack.ref], [], 1)).rejects.toThrow();
});
it("requires every historical attachment reference to exist in the inventory", async () => {
  const asset = "a".repeat(64),
    events = [await event(1, { image: "asset:" + asset })],
    [pack] = await preparePacks(events, 1);
  await expect(makeCheckpoint(events, [pack.ref], [], 1)).rejects.toThrow(
    "缺少引用附件",
  );
  const good = await makeCheckpoint(
    events,
    [pack.ref],
    [{ hash: asset, mime: "image/png", bytes: 5 }],
    1,
  );
  expect(good.blobs).toHaveLength(1);
});
it("accepts a verified empty root and complete independent writer ranges", async () => {
  expect(await makeCheckpoint([], [], [], 1)).toMatchObject({
    count: 0,
    vector: {},
  });
  const events = [await event(1), await event(1, { value: "b" }, B)],
    packs = await preparePacks(events, 1);
  const checkpoint = await makeCheckpoint(
    events,
    packs.map((p) => p.ref),
    [],
    1,
  );
  expect(checkpoint.vector).toEqual({ [A]: 1, [B]: 1 });
  expect(() =>
    parseCheckpoint({
      ...checkpoint,
      packs: [...checkpoint.packs, ...checkpoint.packs],
      count: 4,
    }),
  ).toThrow();
});
it("allows only matching, epoch-scoped immutable paths and never reuses a prepared path", async () => {
  const digest = "f".repeat(64),
    first = newPackedPath("checkpoints", 2, digest),
    second = newPackedPath("checkpoints", 2, digest);
  expect(first).not.toBe(second);
  expect(packedPath(first)).toMatchObject({
    kind: "checkpoints",
    epoch: 2,
    hash: digest,
  });
  expect(packedPath("../" + first)).toBeNull();
  expect(packedPath(first.replace(".json", ".json.gz"))).toBeNull();
  expect(
    parseHead({
      schema: 2,
      epoch: 3,
      checkpoint: { path: first, hash: digest },
    }).checkpoint.path,
  ).toBe(first);
  expect(() =>
    parseHead({
      schema: 2,
      epoch: 1,
      checkpoint: { path: first, hash: digest },
    }),
  ).toThrow();
  expect(() =>
    parseHead({
      schema: 2,
      epoch: 2,
      checkpoint: { path: first, hash: "a".repeat(64) },
    }),
  ).toThrow();
});
it("a single large operation stays intact and byte-oriented limits account for multibyte text", async () => {
  const events = [
      await event(1, { text: "汉".repeat(400000) }),
      await event(2),
    ],
    packs = await preparePacks(events, 1);
  expect(packs).toHaveLength(2);
  expect(packs[0].ref.count).toBe(1);
  expect(packs[0].ref.bytes).toBeGreaterThan(PACK_LIMITS.targetBytes);
  expect(new TextEncoder().encode(packs[0].body).length).toBe(
    packs[0].ref.bytes,
  );
  expect(
    canonical((await readPack(JSON.parse(packs[0].body), packs[0].ref))[0]),
  ).toBe(canonical(events[0]));
});
