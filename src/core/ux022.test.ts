/** Editing, fuzzy commands and durable drafts protect user input across delayed writes and failures. */
import { afterEach, expect, it, vi } from "vitest";
import { ChatDrafts, chatDraftKey } from "./chat-drafts";
import { formatMarkdown, markdownReplacement } from "./markdown-edit";
import {
  rankPickerItems,
  rememberPickerAction,
  shortcutModifier,
} from "./action-picker";
const empty = { text: "", quote: "", model: "", effort: "medium" };
afterEach(() => vi.useRealTimers());
it("scopes drafts without entry/topic collisions and retains exact model IDs across restart", async () => {
  vi.useFakeTimers();
  let disk: unknown = {};
  const drafts = new ChatDrafts(
    async () => disk,
    async (value) => {
      disk = structuredClone(value);
    },
  );
  await drafts.init();
  const global = chatDraftKey("", "a"),
    entry = chatDraftKey("a", "");
  drafts.patch(global, { text: "未发送", model: "gpt-6.1-sol-fast" }, empty);
  drafts.patch(entry, { text: "条目草稿", quote: "选择的上下文" }, empty);
  await drafts.flush();
  const reopened = new ChatDrafts(
    async () => disk,
    async () => {},
  );
  await reopened.init();
  expect(reopened.getSnapshot().drafts[global].model).toBe("gpt-6.1-sol-fast");
  expect(reopened.getSnapshot().drafts[entry].quote).toBe("选择的上下文");
  expect(global).not.toBe(entry);
});
it("a slow save drains newer edits and a failed save retains input until explicit retry", async () => {
  vi.useFakeTimers();
  let release = () => {},
    calls = 0,
    fail = false,
    disk = {};
  const drafts = new ChatDrafts(
    async () => ({}),
    async (value) => {
      if (fail) throw Error("disk full");
      if (++calls === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      disk = structuredClone(value);
    },
  );
  await drafts.init();
  drafts.patch("a", { text: "old" }, empty);
  const pending = drafts.flush();
  await Promise.resolve();
  await Promise.resolve();
  drafts.patch("a", { text: "new" }, empty);
  release();
  await pending;
  expect((disk as any).a.text).toBe("new");
  fail = true;
  drafts.patch("a", { text: "retained" }, empty);
  await expect(drafts.freeze()).rejects.toThrow("disk full");
  expect(drafts.getSnapshot()).toMatchObject({ pending: true, frozen: true });
  expect(drafts.getSnapshot().drafts.a.text).toBe("retained");
  drafts.resume();
  fail = false;
  await drafts.flush();
  expect(drafts.getSnapshot().pending).toBe(false);
});
it("topic creation transfers late input; acknowledging an older send never erases new text", async () => {
  vi.useFakeTimers();
  const drafts = new ChatDrafts(
    async () => ({}),
    async () => {},
  );
  await drafts.init();
  drafts.patch("new", { text: "sent", quote: "old" }, empty);
  drafts.patch("new", { text: "typed while creating" }, empty);
  drafts.transfer("new", "topic");
  drafts.clearSent("topic", "sent", "old");
  expect(drafts.getSnapshot().drafts.topic).toMatchObject({
    text: "typed while creating",
    quote: "",
  });
  expect(drafts.getSnapshot().drafts.new).toBeUndefined();
  await drafts.flush();
});
it("malformed saved drafts are not overwritten", async () => {
  const write = vi.fn(),
    drafts = new ChatDrafts(async () => ({ a: { text: 1 } }), write);
  await expect(drafts.init()).rejects.toThrow();
  expect(() => drafts.patch("a", { text: "new" }, empty)).toThrow("writable");
  await drafts.flush();
  expect(write).not.toHaveBeenCalled();
});
it("formatting preserves surrounding text, Unicode and nesting, and toggles selected wrappers", () => {
  expect(formatMarkdown("前😀后", 2, 3, "bold").value).toBe("前**😀**后");
  expect(formatMarkdown("**文字**", 2, 4, "italic").value).toBe("***文字***");
  expect(formatMarkdown("***文字***", 3, 5, "italic").value).toBe("**文字**");
  expect(formatMarkdown("**文字**", 0, 6, "bold").value).toBe("文字");
  expect(formatMarkdown("第一行\n第二行\n尾", 0, 7, "list").value).toBe(
    "- 第一行\n- 第二行\n尾",
  );
  expect(formatMarkdown("第一行\n第二行", 0, 0, "heading").value).toBe(
    "## 第一行\n第二行",
  );
  expect(formatMarkdown("```js\nx\n```", 0, 11, "code").value).toContain(
    "````\n```js",
  );
  const before = "前文 body 后文",
    edited = formatMarkdown(before, 3, 7, "bold"),
    edit = markdownReplacement(before, edited.value);
  expect(before.slice(0, edit.start) + edit.text + before.slice(edit.end)).toBe(
    edited.value,
  );
});
it("command search excludes unavailable actions and recent identities never store query text", () => {
  const items = [
    { id: "a", label: "搜索知识", keywords: "search" },
    { id: "b", label: "设置模型", disabled: true },
    { id: "c", label: "知识星图", keywords: "graph" },
  ];
  expect(rankPickerItems(items, "graph").map((x) => x.id)).toEqual(["c"]);
  expect(rankPickerItems(items, "", ["c"])[0].id).toBe("c");
  expect(rememberPickerAction(["a", "c", "a", 8], "a")).toEqual(["a", "c"]);
  expect(shortcutModifier("Win32")).toBe("Ctrl");
  expect(shortcutModifier("MacIntel")).toBe("⌘");
});

it("conversation exports only visible messages and never repeats an already committed streamed response", async () => {
  const { conversationMarkdown } = await import("./conversation-export");
  const topic = {
    title: "话题",
    messages: [
      { role: "system", content: "hidden prompt" },
      { role: "user", content: "问题" },
      { role: "tool", content: "raw tool secret" },
      { role: "assistant", content: "回复", jobId: "job", responseId: "r1" },
    ],
  } as any;
  const complete = {
    id: "job",
    state: "running",
    stages: [{ content: "回复", responseId: "r1" }],
  } as any;
  const partial = {
    id: "other",
    state: "cancelled",
    stages: [{ content: "未完成输出", responseId: "r2" }],
  } as any;
  const text = conversationMarkdown(topic, [complete, partial]);
  expect(text).not.toContain("hidden prompt");
  expect(text).not.toContain("raw tool secret");
  expect(text.match(/回复/g)).toHaveLength(1);
  expect(text).toContain("cancelled; partial output");
  expect(text).toContain("未完成输出");
});
