/** Guard against Tauri's async window.confirm being mistaken for the browser's synchronous boolean API. */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

test("application confirmation sites use the awaited application dialog instead of window.confirm", async () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const files = (await readdir(root, { recursive: true })).filter(
    (name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"),
  );
  const unsafe = [];
  for (const file of files) {
    const source = await readFile(
      new URL(file, new URL("../src/", import.meta.url)),
      "utf8",
    );
    if (
      /\b(?:window|globalThis)\s*(?:\.\s*confirm|\[\s*["']confirm["']\s*\])\s*\(/.test(
        source,
      )
    )
      unsafe.push(file);
  }
  assert.deepEqual(
    unsafe,
    [],
    "Use useConfirmation/runConfirmed: native confirm returns a Promise even though DOM typings say boolean",
  );
});
