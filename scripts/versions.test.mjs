/** Version isolation prevents unnecessary update prompts on untouched platforms. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bumpVersions, compareVersions, releaseVersion } from "./versions.mjs";
const input = {
  schema: 1,
  shared: "0.2",
  platforms: { windows: "0.2.1", android: "0.2.0", ubuntu: "0.2.3" },
};
test("shared changes advance every platform together", () =>
  assert.deepEqual(bumpVersions(input, "shared").platforms, {
    windows: "0.3.0",
    android: "0.3.0",
    ubuntu: "0.3.0",
  }));
test("Windows-only changes preserve Android and Ubuntu", () =>
  assert.deepEqual(bumpVersions(input, "windows").platforms, {
    windows: "0.2.2",
    android: "0.2.0",
    ubuntu: "0.2.3",
  }));
test("release tags and comparisons use numeric patch ordering", () => {
  assert.equal(releaseVersion(input), "0.2.3");
  assert.ok(compareVersions("0.2.10", "0.2.9") > 0);
});
