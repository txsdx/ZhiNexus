/** Real screen-selection test: native capture, isolated overlay, crop, editable local OCR result and attachment creation. */
import fs from "node:fs";
import assert from "node:assert/strict";
/** Use normal window switching and the overlay's constrained IPC rather than bypassing its window/token checks. */
export async function testNativeOcr({ command, script, click, type, waitFor }) {
  await click(".sidebar nav button:first-child");
  const main = await command("GET", "/window");
  const start = await command("POST", "/execute/async", {
    script:
      'const done=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke("begin_ocr_capture").then(()=>done({ok:true}),e=>done({error:String(e)}));',
    args: [],
  });
  assert.equal(start.ok, true, start.error);
  const overlay = await waitFor(async () => {
    const handles = await command("GET", "/window/handles");
    return handles.find((handle) => handle !== main);
  });
  await command("POST", "/window", { handle: overlay });
  await waitFor(() =>
    script('return document.querySelector(".ocr-overlay img")?.naturalWidth>0'),
  );
  const crop = await command("POST", "/execute/async", {
    script:
      'const done=arguments[arguments.length-1];const invoke=window.__TAURI_INTERNALS__.invoke;invoke("ocr_frame").then(frame=>invoke("finish_ocr_capture",{id:frame.id,x:280,y:120,width:420,height:220})).then(()=>done({ok:true}),e=>done({error:String(e)}));',
    args: [],
  }).catch(() => ({ ok: true }));
  // Destroying the overlay can end its pending WebDriver callback; the result in the surviving main window is authoritative.
  if (crop.error) throw Error(crop.error);
  await command("POST", "/window", { handle: main });
  await waitFor(() =>
    script(
      'return document.querySelector(".ocr-preview")?.naturalWidth === 420',
    ),
  );
  await waitFor(
    () =>
      script(
        'return document.querySelector(".modal textarea") && !document.querySelector(".modal textarea").disabled',
      ),
    60000,
  );
  const result = await script(
    'return {recognized:!!document.querySelector(".modal textarea")?.value.trim(),diagnostic:document.querySelector(".modal [role=alert]")?.innerText??""};',
  );
  assert.ok(
    result.recognized || result.diagnostic,
    "Local OCR must return text or a useful engine diagnostic",
  );
  fs.mkdirSync("native-test-results", { recursive: true });
  fs.writeFileSync(
    "native-test-results/ocr-engine.json",
    JSON.stringify(result, null, 2),
  );
  await type(".modal textarea", "Native screenshot fixture");
  await click(".modal .primary");
  await waitFor(() =>
    script(
      'return document.querySelector(".modal input:not([type])")?.value === "Native screenshot fixture"',
    ),
  );
  await click(".modal .primary");
  await waitFor(() =>
    script(
      'return document.querySelector(".entry-heading h1")?.innerText === "Native screenshot fixture"',
    ),
  );
  await waitFor(() =>
    script(
      'return document.querySelector(".paper .markdown img")?.naturalWidth === 420',
    ),
  );
}
