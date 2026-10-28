/** Exercise private GitHub Release discovery in the installed app without launching an installer. */
import assert from "node:assert/strict";

/** Use the ordinary About controls so both native IPC and real private manifest download are exercised. */
export async function testNativeUpdates({ click, script, waitFor }) {
  await click('[data-settings-tab="about"]');
  await click(".settings-content .actions button");
  const result = await waitFor(
    () =>
      script(
        'const error=document.querySelector(".settings-content>[role=alert]")?.innerText;const heading=document.querySelector(".settings-content>section>h3")?.innerText;return error?{error}:heading?{heading}:false;',
      ),
    90000,
  );
  assert.ok(!result.error, result.error);
  assert.match(result.heading, /^\d+\.\d+\.\d+\s*→\s*\d+\.\d+\.\d+$/);
  console.log(
    "PASS: embedded GitHub credential reads the private Release and downloads latest.json through the native updater",
  );
}
