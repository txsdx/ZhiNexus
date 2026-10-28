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
  assert.deepEqual(manual.sort(), ["build.yml", "native-ui.yml"]);
  assert.deepEqual(workflow.jobs.desktop.strategy.matrix.include, [
    { platform: "windows", os: "windows-latest" },
    { platform: "ubuntu", os: "ubuntu-24.04" },
  ]);
  assert.ok(workflow.jobs.android);
});
test("Android builds only the arm64 release with package verification and no emulator workload", () => {
  const steps = workflow.jobs.android.steps;
  assert.equal(
    steps.find((s) => s.uses === "dtolnay/rust-toolchain@stable").with.targets,
    "aarch64-linux-android",
  );
  assert.ok(
    steps.some(
      (s) => s.run === "npm run tauri -- android build --apk --target aarch64",
    ),
  );
  assert.ok(steps.some((s) => s.run === "bash scripts/android-sign.sh"));
  assert.ok(
    steps.some(
      (s) =>
        s.uses === "actions/upload-artifact@v4" &&
        s.with.name === "ZhiNexus-Android",
    ),
  );
  assert.ok(
    !/emulator-runner|--target x86_64|\/dev\/kvm|system-images|Android-device-test-results|android-smoke\.mjs/.test(
      JSON.stringify(steps),
    ),
  );
  assert.match(
    fs.readFileSync("scripts/android-sign.sh", "utf8"),
    /apksigner" verify/,
  );
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

test("Ubuntu UI diagnostics are opt-in, use the pinned built artifact and cannot publish", () => {
  const diagnostic = parse(
    fs.readFileSync(".github/workflows/native-ui.yml", "utf8"),
  );
  assert.ok(diagnostic.on.workflow_dispatch);
  assert.deepEqual(diagnostic.permissions, {
    contents: "read",
    actions: "read",
  });
  assert.ok(
    !workflow.jobs.desktop.steps.some((step) =>
      step.name?.includes("packaged Ubuntu executable"),
    ),
  );
  assert.ok(
    !workflow.jobs.desktop.steps.some(
      (step) => step.run === "bash scripts/start-linux-driver.sh",
    ),
  );
  const steps = diagnostic.jobs.ubuntu.steps;
  assert.ok(
    steps.some(
      (step) =>
        step.uses === "actions/download-artifact@v4" &&
        step.with.name === "ZhiNexus-ubuntu-24.04-x64",
    ),
  );
  assert.ok(steps.some((step) => step.run === "node scripts/native-smoke.mjs"));
  assert.ok(
    !steps.some(
      (step) =>
        String(step.uses).includes("tauri-action") ||
        String(step.run).includes("release create"),
    ),
  );
});
