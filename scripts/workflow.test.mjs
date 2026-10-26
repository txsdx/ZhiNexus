/** The single manual build entry shares one frontend and gates optional publication on all supported native jobs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parse } from "yaml";
const workflow = parse(fs.readFileSync(".github/workflows/build.yml", "utf8"));
test("one manual entry builds every target with only publication and draft options", () => {
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs).sort(), [
    "create_release",
    "draft",
  ]);
  assert.equal(
    workflow.on.workflow_dispatch.inputs.create_release.default,
    false,
  );
  assert.equal(workflow.on.workflow_dispatch.inputs.draft.default, true);
  const manual = fs
    .readdirSync(".github/workflows")
    .filter(
      (name) =>
        parse(fs.readFileSync(".github/workflows/" + name, "utf8")).on
          ?.workflow_dispatch !== undefined,
    );
  assert.deepEqual(manual, ["build.yml"]);
  assert.deepEqual(workflow.jobs.desktop.strategy.matrix.include, [
    { platform: "windows", os: "windows-latest" },
    { platform: "ubuntu", os: "ubuntu-24.04" },
  ]);
  assert.ok(workflow.jobs.android);
});
test("the frontend is compiled once and all native jobs verify its artifact", () => {
  assert.equal(
    workflow.jobs.frontend.steps.filter((s) => s.run === "npm run build")
      .length,
    1,
  );
  for (const id of ["desktop", "android"]) {
    const job = workflow.jobs[id];
    assert.equal(job.needs, "frontend");
    assert.ok(
      job.steps.some(
        (s) =>
          s.uses === "actions/download-artifact@v4" &&
          s.with.name === "shared-frontend",
      ),
    );
    assert.ok(
      job.steps.some((s) => s.run === "node scripts/frontend-artifact.mjs use"),
    );
    assert.equal(job.steps.filter((s) => s.run === "npm run build").length, 0);
  }
});
test("only a complete successful native build can publish using automatic repository credentials", () => {
  assert.deepEqual(workflow.jobs.publish.needs, ["desktop", "android"]);
  assert.equal(workflow.jobs.publish.if, "inputs.create_release");
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.jobs.publish.permissions.contents, "write");
  const publish = workflow.jobs.publish.steps.find(
    (s) => s.name === "Publish Release",
  );
  assert.equal(publish.env.GH_TOKEN, "${{ github.token }}");
  assert.equal(publish.env.RELEASE_DRAFT, "${{ inputs.draft }}");
  assert.ok(!JSON.stringify(workflow).includes("RELEASE_TOKEN"));
});
