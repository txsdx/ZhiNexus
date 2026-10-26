/** Release policy regressions: draft preference, safe upload ordering, immutable public versions and complete metadata. */
import test from "node:test";
import assert from "node:assert/strict";
import { publicationPlan } from "./publish-release.mjs";
const input = {
  tag: "v0.4.0",
  sha: "fixture-sha",
  artifacts: ["release-artifacts/latest.json", "release-artifacts/app.apk"],
  existing: null,
};
test("new releases stay drafts until all assets have uploaded", () => {
  const plan = publicationPlan({ ...input, draft: false });
  assert.ok(plan[0].includes("--draft"));
  assert.equal(plan[1][1], "upload");
  assert.deepEqual(plan[2], ["release", "edit", input.tag, "--draft=false"]);
});
test("draft selection never executes a publish command", () => {
  const plan = publicationPlan({ ...input, draft: true });
  assert.equal(plan.length, 2);
  assert.equal(
    plan.some((args) => args.includes("--draft=false")),
    false,
  );
});
test("an existing draft can be uploaded and published, while public versions cannot be overwritten", () => {
  const plan = publicationPlan({
    ...input,
    existing: { draft: true },
    draft: false,
  });
  assert.equal(plan[0][1], "upload");
  assert.equal(plan[1][1], "edit");
  assert.throws(
    () =>
      publicationPlan({ ...input, existing: { draft: false }, draft: true }),
    /already published/,
  );
  assert.throws(
    () =>
      publicationPlan({ ...input, existing: { draft: false }, draft: false }),
    /already published/,
  );
});
test("missing update metadata prevents any publication", () => {
  assert.throws(
    () => publicationPlan({ ...input, draft: false, artifacts: ["app.apk"] }),
    /latest.json/,
  );
});
