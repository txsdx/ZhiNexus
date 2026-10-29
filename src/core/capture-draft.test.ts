/** Capture persistence waits for current input, retains failures and follows acknowledged creation-ID changes. */
import { expect, it, vi, afterEach } from "vitest";
import {
  CaptureSession,
  flushCaptureEditors,
  resumeCaptureEditors,
  registerCaptureEditor,
  type CaptureClient,
  type CaptureDraft,
  type CaptureRequest,
} from "./capture-draft";
const draft = (): CaptureDraft => ({
  id: crypto.randomUUID(),
  revision: 0,
  title: "",
  content: "",
  category: "",
  source: "manual-capture",
});
afterEach(() => resumeCaptureEditors());
it("typing during a save is coalesced without an older acknowledgement replacing the newest text", async () => {
  let stored = draft(),
    release = () => {};
  let calls = 0;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const client: CaptureClient = {
    async request<T>(request: CaptureRequest) {
      if (request.type === "load") return structuredClone(stored) as T;
      if (request.type !== "save") throw Error("unexpected");
      if (++calls === 1) await gate;
      stored = { ...request.draft, revision: stored.revision + 1 };
      return structuredClone(stored) as T;
    },
  };
  const session = new CaptureSession(client);
  await session.init();
  session.patch({ title: "first" });
  await vi.waitFor(() => expect(calls).toBe(1));
  session.patch({ content: "newer typing" });
  release();
  await session.flush();
  expect(stored).toMatchObject({
    title: "first",
    content: "newer typing",
    revision: 2,
  });
  expect(session.getSnapshot()).toMatchObject({
    pending: false,
    error: "",
    draft: { content: "newer typing" },
  });
});
it("failed writes retain input and retry without reporting the draft as saved", async () => {
  let stored = draft(),
    fail = true;
  const client: CaptureClient = {
    async request<T>(request: CaptureRequest) {
      if (request.type === "load") return stored as T;
      if (request.type !== "save") throw Error("unexpected");
      if (fail) throw Error("disk full");
      stored = { ...request.draft, revision: stored.revision + 1 };
      return stored as T;
    },
  };
  const session = new CaptureSession(client);
  await session.init();
  session.patch({ content: "must survive" });
  await vi.waitFor(() =>
    expect(session.getSnapshot().error).toContain("disk full"),
  );
  expect(stored.content).toBe("");
  expect(session.getSnapshot().pending).toBe(true);
  fail = false;
  await session.flush();
  expect(stored.content).toBe("must survive");
  expect(session.getSnapshot().pending).toBe(false);
});
it("an acknowledged fork after a prior saved entry carries newer typing into the new stable creation ID", async () => {
  let stored = draft(),
    release = () => {};
  const nextId = crypto.randomUUID();
  let calls = 0;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const sent: CaptureDraft[] = [];
  const client: CaptureClient = {
    async request<T>(request: CaptureRequest) {
      if (request.type === "load") return stored as T;
      if (request.type !== "save") throw Error("unexpected");
      sent.push(request.draft);
      if (++calls === 1) await gate;
      stored = { ...request.draft, id: nextId, revision: stored.revision + 1 };
      return structuredClone(stored) as T;
    },
  };
  const session = new CaptureSession(client);
  await session.init();
  session.patch({ content: "edited" });
  await vi.waitFor(() => expect(calls).toBe(1));
  session.patch({ title: "new concept" });
  release();
  await session.flush();
  expect(sent[1].id).toBe(nextId);
  expect(stored).toMatchObject({
    id: nextId,
    title: "new concept",
    content: "edited",
  });
});
it("shutdown waits for imports/persistence and keeps newly registered editors frozen until explicitly resumed", async () => {
  let release = () => {},
    finished = false;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const states: boolean[] = [];
  const stop = registerCaptureEditor({
    flush: () => gate,
    freeze: (value) => states.push(value),
  });
  const work = flushCaptureEditors(true).then(() => (finished = true));
  await Promise.resolve();
  expect(finished).toBe(false);
  const lateStates: boolean[] = [];
  const stopLate = registerCaptureEditor({
    flush: async () => {},
    freeze: (value) => lateStates.push(value),
  });
  expect(lateStates).toEqual([true]);
  release();
  await work;
  expect(finished).toBe(true);
  resumeCaptureEditors();
  expect(states).toEqual([true, false]);
  expect(lateStates).toEqual([true, false]);
  stop();
  stopLate();
});
