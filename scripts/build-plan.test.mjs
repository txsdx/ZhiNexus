/** Regression coverage for opt-in Android/Ubuntu and the default Windows-only workflow. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "./build-plan.mjs";
test("defaults to Windows latest x64 only", () =>
  assert.deepEqual(
    buildPlan().matrix.include.map((x) => x.os),
    ["windows-latest"],
  ));
test("Android-only selection skips the desktop matrix", () => {
  const p = buildPlan({ windows: false, android: true });
  assert.equal(p.has_desktop, false);
  assert.equal(p.android, true);
});
test("Ubuntu is opt-in and macOS never appears", () => {
  const p = buildPlan({ windows: true, android: true, ubuntu: true });
  assert.deepEqual(
    p.matrix.include.map((x) => x.os),
    ["windows-latest", "ubuntu-24.04"],
  );
});
test("an empty selection fails with a useful error", () =>
  assert.throws(() => buildPlan({ windows: false }), /Choose at least/));
test("matrix packages only NSIS and DEB and always includes a version key", () => {
  const rows = buildPlan({ windows: true, ubuntu: true }).matrix.include;
  assert.deepEqual(
    rows.map((x) => [x.version_key, x.bundles]),
    [
      ["windows", "nsis"],
      ["ubuntu", "deb"],
    ],
  );
});
