/** Notification behavior: actual focus, per-device opt-outs, preview privacy and throttling. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { store } from "../core/store";
import { defaultNotifications, notifyCompletion } from "./notifications";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
/** Install a browser notification sink without requesting OS permissions in automatic completion paths. */
function environment(
  focused: boolean,
  options: Partial<typeof defaultNotifications> = {},
) {
  const sent: { body: string }[] = [];
  class NotificationStub {
    static permission = "granted";
    constructor(_title: string, value: { body: string }) {
      sent.push(value);
    }
  }
  vi.stubGlobal("window", { Notification: NotificationStub });
  vi.stubGlobal("Notification", NotificationStub);
  vi.stubGlobal("document", {
    visibilityState: "visible",
    hasFocus: () => focused,
  });
  const snapshot = store.getSnapshot();
  vi.spyOn(store, "getSnapshot").mockReturnValue({
    ...snapshot,
    device: {
      ...snapshot.device,
      notificationOptions: {
        ...defaultNotifications,
        cooldownSeconds: 0,
        ...options,
      },
    },
  });
  return sent;
}
describe("completion notifications", () => {
  it("suppresses AI notifications while focused", async () => {
    const sent = environment(true);
    await notifyCompletion("ai", "private material");
    expect(sent).toHaveLength(0);
  });
  it("notifies while unfocused, hiding content by default", async () => {
    const sent = environment(false);
    await notifyCompletion("ai", "private material");
    expect(sent).toHaveLength(1);
    expect(sent[0].body).not.toContain("private material");
  });
  it("honors separate AI and sync opt-outs", async () => {
    const sent = environment(false, {
      aiWhenUnfocused: false,
      syncFailures: false,
    });
    await notifyCompletion("ai");
    await notifyCompletion("sync");
    expect(sent).toHaveLength(0);
  });
  it("previews only when enabled and throttles repeated completions", async () => {
    const sent = environment(false, { preview: true, cooldownSeconds: 300 });
    await notifyCompletion("ocr", "recognized text");
    await notifyCompletion("ocr", "second result");
    expect(sent).toEqual([{ body: "recognized text" }]);
  });
});
