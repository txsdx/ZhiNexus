/** Release metadata must retain untouched platform patches and match exact artifact suffixes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { artifactIdentity, createManifest } from "./updater-manifest.mjs";
test("recognizes single-exe/APK/DEB outputs and never treats a Windows installer as an update", () => {
  assert.equal(artifactIdentity("app_protable.exe").kind, "portable");
  assert.equal(artifactIdentity("app_setup.exe"), null);
  assert.equal(artifactIdentity("a.deb").platform, "linux-x86_64");
  assert.equal(artifactIdentity("a.apk").platform, "android-arm64");
  assert.equal(artifactIdentity("a.msi"), null);
});
test("keeps untouched platform versions and hashes only supported artifacts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zhinexus-manifest-"));
  try {
    const file = path.join(dir, "app_protable.exe");
    fs.writeFileSync(file, "fixture");
    const previous = {
      schema: 2,
      platforms: {
        "android-arm64": { version: "0.2.0", notes: "old", artifacts: {} },
      },
    };
    const result = createManifest([file], {
      versions: {
        shared: "0.2",
        platforms: { windows: "0.2.3", android: "0.2.0", ubuntu: "0.2.0" },
      },
      previous,
    });
    assert.equal(result.platforms["android-arm64"].version, "0.2.0");
    assert.equal(result.platforms["windows-x86_64"].version, "0.2.3");
    assert.match(
      result.platforms["windows-x86_64"].artifacts.portable.sha256,
      /^[a-f0-9]{64}$/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
