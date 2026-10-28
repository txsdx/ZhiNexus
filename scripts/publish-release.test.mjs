/** Release policy regressions: draft preference, safe upload ordering, immutable public versions and complete metadata. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  publicationPlan,
  releaseArtifacts,
  existingRelease,
} from "./publish-release.mjs";
const input = {
  tag: "v0.4.0",
  sha: "fixture-sha",
  artifacts: [
    "release-artifacts/latest.json",
    "release-artifacts/app.apk",
    "release-artifacts/app.deb",
    "release-artifacts/app_protable.exe",
    "release-artifacts/app_setup.exe",
  ],
  existing: null,
};
test("a draft hidden by the tag endpoint is found on later release-list pages and reused", () => {
  const draft = { id: 42, tag_name: input.tag, draft: true };
  const reads = [];
  const existing = existingRelease("owner/repo", input.tag, (args) => {
    reads.push(args);
    if (reads.length === 1)
      throw Object.assign(Error("Not found"), { stderr: "HTTP 404" });
    return reads.length === 2
      ? Array.from({ length: 100 }, (_, i) => ({
          tag_name: "older-" + i,
          draft: false,
        }))
      : [draft];
  });
  assert.deepEqual(existing, draft);
  assert.ok(reads[2][1].endsWith("page=2"));
  assert.ok(
    !publicationPlan({ ...input, existing, draft: true }).some(
      (args) => args[1] === "create",
    ),
  );
});
test("missing releases require a successful list query; permission and transport errors cannot create a duplicate", () => {
  const missing = () => {
    throw Object.assign(Error("Not found"), { stderr: "HTTP 404" });
  };
  assert.equal(
    existingRelease("owner/repo", input.tag, (args) =>
      args[1].includes("per_page") ? [] : missing(),
    ),
    null,
  );
  assert.throws(
    () =>
      existingRelease("owner/repo", input.tag, () => {
        throw Object.assign(Error("Forbidden"), { stderr: "HTTP 403" });
      }),
    /Unable to inspect Release/,
  );
  assert.throws(
    () =>
      existingRelease("owner/repo", input.tag, (args) =>
        args[1].includes("per_page")
          ? (() => {
              throw Error("offline");
            })()
          : missing(),
      ),
    /Unable to inspect draft Releases/,
  );
});
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

test("recursive artifact discovery includes the nested Windows/Deb paths created by Actions", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "zhinexus-release-artifacts-"),
  );
  try {
    const names = [
      "release-files/app_protable.exe",
      "release-files/app_setup.exe",
      "src-tauri/target/release/bundle/deb/app.deb",
      "app.apk",
      "latest.json",
    ];
    for (const name of names) {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "fixture");
    }
    const artifacts = releaseArtifacts(root);
    assert.equal(artifacts.length, 5);
    assert.equal(
      publicationPlan({ ...input, draft: true, artifacts })[1].length,
      9,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("metadata alone or missing platforms cannot produce a public update with absent installers", () => {
  assert.throws(
    () =>
      publicationPlan({ ...input, draft: false, artifacts: ["latest.json"] }),
    /Missing platform artifact/,
  );
  assert.throws(
    () =>
      publicationPlan({
        ...input,
        draft: true,
        artifacts: [...input.artifacts, "nested/app.apk"],
      }),
    /unique/,
  );
});
