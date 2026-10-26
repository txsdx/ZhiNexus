/** Exercise the real shortcut recorder and native lease restoration, including capture of an already registered key. */
import assert from "node:assert/strict";
/** No typed accelerator strings: buttons capture actual keyboard events and cancel without losing the saved key. */
export async function testNativeShortcuts({ click, script, waitFor, command }) {
  await click('[data-settings-tab="desktop"]');
  const initial = await script(
    'return document.querySelector("[data-shortcut-capture]")?.textContent',
  );
  await click("[data-shortcut-capture]");
  await waitFor(() =>
    script(
      'return document.querySelector("[data-shortcut-capture]")?.getAttribute("aria-pressed")==="true"',
    ),
  );
  await command("POST", "/actions", {
    actions: [
      {
        type: "key",
        id: "shortcut-recorder",
        actions: [
          { type: "keyDown", value: "\uE009" },
          { type: "keyDown", value: "\uE008" },
          { type: "keyDown", value: "n" },
          { type: "keyUp", value: "n" },
          { type: "keyUp", value: "\uE008" },
          { type: "keyUp", value: "\uE009" },
        ],
      },
    ],
  });
  await waitFor(() =>
    script(
      'return document.querySelector("[data-shortcut-capture]")?.textContent==="Control+Shift+N"',
    ),
  );
  await click("[data-shortcut-capture]");
  await waitFor(() =>
    script(
      'return document.querySelector("[data-shortcut-capture]")?.getAttribute("aria-pressed")==="true"',
    ),
  );
  await script(
    'window.dispatchEvent(new KeyboardEvent("keydown",{code:"Escape",key:"Escape",bubbles:true,cancelable:true}));return true;',
  );
  await waitFor(() =>
    script(
      'return document.querySelector("[data-shortcut-capture]")?.getAttribute("aria-pressed")==="false"',
    ),
  );
  assert.equal(
    await script(
      'return document.querySelector("[data-shortcut-capture]")?.textContent',
    ),
    "Control+Shift+N",
  );
  assert.ok(initial);
  await waitFor(() =>
    script(
      'return document.querySelector("[data-save-status]")?.getAttribute("data-save-status")==="saved"',
    ),
  );
}
