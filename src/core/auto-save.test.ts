/** Autosave contracts: concurrent edits, serialized durability and retry without losing unsaved input. */
import { afterEach, expect, it, vi } from "vitest";
import { AutoSave, mergeEdits } from "./auto-save";
afterEach(() => vi.useRealTimers());

it("merges edited nested preferences without reverting another device's untouched changes", () => {
  const base = {
    ai: { model: "a", prompt: "old" },
    device: { key: "old", sync: 10 },
  };
  const current = {
    ai: { model: "b", prompt: "old" },
    device: { key: "downloaded", sync: 10 },
  };
  expect(
    mergeEdits(current, base, {
      ...base,
      ai: { ...base.ai, prompt: "edited" },
    }),
  ).toEqual({ ...current, ai: { model: "b", prompt: "edited" } });
});

it("debounces changes and retains them until persistence completes", async () => {
  vi.useFakeTimers();
  let source = { model: "a" };
  const save = vi.fn(async (value) => {
    source = value;
  });
  const editor = new AutoSave(() => source, save);
  editor.update({ model: "b" });
  editor.update({ model: "c" });
  expect(source.model).toBe("a");
  await vi.advanceTimersByTimeAsync(350);
  expect(save).toHaveBeenCalledOnce();
  expect(source.model).toBe("c");
  expect(editor.getSnapshot().status).toBe("saved");
});

it("serializes a newer edit and incorporates concurrent downloaded credentials", async () => {
  let source = { prompt: "a", key: "old" };
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const save = vi.fn(async (next, base) => {
    if (save.mock.calls.length === 1) await blocked;
    source = mergeEdits(source, base, next);
  });
  const editor = new AutoSave(() => source, save);
  editor.update({ ...source, prompt: "b" });
  const first = editor.flush();
  await Promise.resolve();
  source = { ...source, key: "downloaded" };
  editor.receive();
  editor.update((previous) => ({ ...previous, prompt: "c" }));
  const second = editor.flush();
  expect(save).toHaveBeenCalledOnce();
  finish();
  await Promise.all([first, second]);
  expect(source).toEqual({ prompt: "c", key: "downloaded" });
  expect(editor.getSnapshot().status).toBe("saved");
});

it("keeps failed edits retryable and never reports a failed save as saved", async () => {
  let source = { value: "old" };
  const save = vi
    .fn()
    .mockRejectedValueOnce(Error("disk full"))
    .mockImplementation(async (next) => {
      source = next;
    });
  const errors = vi.fn(),
    editor = new AutoSave(() => source, save, errors);
  editor.update({ value: "new" });
  await expect(editor.flush()).rejects.toThrow("disk full");
  expect(editor.getSnapshot()).toMatchObject({
    value: { value: "new" },
    status: "error",
    error: "disk full",
  });
  expect(source.value).toBe("old");
  expect(errors).toHaveBeenCalledOnce();
  await editor.flush();
  expect(source.value).toBe("new");
});
