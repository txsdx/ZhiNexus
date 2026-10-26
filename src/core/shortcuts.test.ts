/** Shortcut recording contracts: stable physical keys, complete modifiers and safe cancellation/IME handling. */
import { describe, it, expect } from "vitest";
import { shortcutFromStroke, type ShortcutStroke } from "./shortcuts";
const stroke = (code: string, flags: Partial<ShortcutStroke> = {}) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...flags,
});
describe("shortcut capture", () => {
  it("records physical keys independently of layout and preserves all modifiers", () => {
    expect(
      shortcutFromStroke(stroke("KeyN", { ctrlKey: true, shiftKey: true })),
    ).toBe("Control+Shift+N");
    expect(
      shortcutFromStroke(stroke("Space", { metaKey: true, altKey: true })),
    ).toBe("Alt+Super+Space");
    expect(
      shortcutFromStroke(stroke("Digit2", { ctrlKey: true, shiftKey: true })),
    ).toBe("Control+Shift+2");
    expect(shortcutFromStroke(stroke("F12"))).toBe("F12");
  });
  it("rejects partial, repeating, IME and bare typing strokes", () => {
    for (const e of [
      stroke("ControlLeft", { ctrlKey: true }),
      stroke("KeyA"),
      stroke("Escape", { ctrlKey: true }),
      stroke("KeyA", { ctrlKey: true, isComposing: true }),
      stroke("KeyA", { ctrlKey: true, repeat: true }),
      stroke("F25"),
    ])
      expect(shortcutFromStroke(e)).toBeNull();
  });
});
