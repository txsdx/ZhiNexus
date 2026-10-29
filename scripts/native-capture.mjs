/** Real floating-window smoke: OS pin/resize/close, image clipboard and one main-owned durable creation. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
/** Exercise the existing native bridge through rendered controls, without opening another database or injecting fixtures into storage. */
export async function testNativeCapture({
  command,
  script,
  click,
  type,
  waitFor,
  processId,
}) {
  const main = await command("GET", "/window");
  const invoke = (name, args = {}) =>
    command("POST", "/execute/async", {
      script:
        "const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({value}),e=>done({error:String(e)}));",
      args: [name, args],
    });
  const denied = await invoke("capture_request", { body: { type: "load" } });
  assert.match(denied.error, /Invalid capture window/);
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^+n')",
      ],
      { timeout: 15000 },
    );
  } else {
    const opened = await invoke("open_quick_capture");
    assert.ok(!opened.error, opened.error);
  }
  const capture = await waitFor(async () =>
    (await command("GET", "/window/handles")).find((h) => h !== main),
  );
  await command("POST", "/window", { handle: capture });
  await waitFor(() =>
    script(
      'return !!document.querySelector(".capture-form input:not([type])")',
    ),
  );
  assert.equal(
    await script(
      'return !!document.querySelector(".app-shell,.modal-backdrop")',
    ),
    false,
  );
  for (const method of ["is_always_on_top", "is_resizable", "is_decorated"]) {
    const status = await invoke("plugin:window|" + method, {
      label: "quick-capture",
    });
    assert.equal(status.value, true, status.error || method);
  }
  const initial = await command("GET", "/window/rect");
  await command("POST", "/window/rect", { width: 400, height: 480 });
  await waitFor(() =>
    script(
      'const f=document.querySelector(".capture-footer"),r=f?.getBoundingClientRect();return r&&r.bottom<=innerHeight+1&&r.top>=0&&document.documentElement.scrollWidth<=innerWidth+1;',
    ),
  );
  const resized = await command("GET", "/window/rect");
  assert.equal(
    await script(
      'return getComputedStyle(document.body).backgroundColor === "rgb(255, 255, 255)"',
    ),
    true,
  );
  const title = "Native floating capture " + Date.now();
  const content = "Native close preserves this complete draft.";
  await type(".capture-form input:not([type])", title);
  await type(".capture-form textarea", content);
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-STA",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $captureBitmap=New-Object System.Drawing.Bitmap 24,16; $captureGraphics=[System.Drawing.Graphics]::FromImage($captureBitmap); $captureGraphics.Clear([System.Drawing.Color]::CornflowerBlue); [System.Windows.Forms.Clipboard]::SetImage($captureBitmap); $captureGraphics.Dispose(); $captureBitmap.Dispose()",
      ],
      { timeout: 15000 },
    );
    await script(
      'const button=[...document.querySelectorAll(".capture-footer button")].find(b=>/粘贴图片|Paste image/.test(b.textContent));button.click();return true;',
    );
    await waitFor(() =>
      script(
        'return document.querySelector(".capture-image img")?.naturalWidth>0&&document.querySelector(".capture-form textarea")?.value.includes("asset:")',
      ),
    );
  }
  await waitFor(() =>
    script(
      'return document.querySelector("[data-capture-save-status]")?.dataset.captureSaveStatus==="saved"',
    ),
  );
  fs.mkdirSync("native-test-results", { recursive: true });
  fs.writeFileSync(
    "native-test-results/native-floating-capture.png",
    Buffer.from(await command("GET", "/screenshot"), "base64"),
  );
  if (process.platform === "win32") {
    // WM_CLOSE exercises the OS title-bar close handler and its acknowledged frontend flush.
    assert.ok(Number.isSafeInteger(processId) && processId > 0);
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        "scripts/close-capture-window.ps1",
        "-ApplicationProcessId",
        String(processId),
      ],
      { encoding: "utf8", timeout: 15000 },
    );
  } else {
    const hidden = await invoke("plugin:window|hide", {
      label: "quick-capture",
    });
    assert.ok(!hidden.error, hidden.error);
  }
  await command("POST", "/window", { handle: main });
  await waitFor(
    async () =>
      (await invoke("plugin:window|is_visible", { label: "quick-capture" }))
        .value === false,
  );
  const reopened = await invoke("open_quick_capture");
  assert.ok(!reopened.error, reopened.error);
  await command("POST", "/window", { handle: capture });
  await waitFor(() =>
    script(
      'return document.querySelector(".capture-form input:not([type])")?.value===arguments[0]&&document.querySelector(".capture-form textarea")?.value.includes(arguments[1])',
      [title, content],
    ),
  );
  const restored = await command("GET", "/window/rect");
  assert.equal(restored.width, resized.width);
  assert.equal(restored.height, resized.height);
  await command("POST", "/window/rect", {
    width: initial.width,
    height: initial.height,
  });
  await click(".capture-footer .primary");
  await waitFor(() =>
    script(
      'return document.querySelector(".capture-form input:not([type])")?.value===""&&document.querySelector(".capture-notice")?.textContent.trim()',
    ),
  );
  const hidden = await invoke("plugin:window|hide", { label: "quick-capture" });
  assert.ok(!hidden.error, hidden.error);
  await command("POST", "/window", { handle: main });
  await click('.sidebar nav button[data-nav="library"]');
  await waitFor(() =>
    script(
      'return [...document.querySelectorAll(".entry-title-cell button")].filter(b=>b.textContent===arguments[0]).length===1',
      [title],
    ),
  );
  await script(
    'const b=[...document.querySelectorAll(".entry-title-cell button")].find(b=>b.textContent===arguments[0]);b.click();return true;',
    [title],
  );
  await waitFor(() =>
    script(
      'return document.querySelector(".entry-heading h1")?.textContent===arguments[0]&&document.querySelector(".paper")?.textContent.includes(arguments[1])',
      [title, content],
    ),
  );
  if (process.platform === "win32")
    await waitFor(() =>
      script('return document.querySelector(".paper img")?.naturalWidth===24'),
    );
  console.log(
    "PASS: real floating capture is pinned/resizable/opaque, OS close restores the draft and clipboard image, one entry saves through the main writer",
  );
}
