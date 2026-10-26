/** Shared frontend verification rejects stale, incomplete or tampered builds before mutating native configuration. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sealFrontend, useFrontend } from "./frontend-artifact.mjs";
/** Create an isolated build fixture without touching the repository's actual Tauri hooks. */
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zhinexus-frontend-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dist = path.join(root, "dist");
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, "index.html"), "<div>shared</div>");
  fs.writeFileSync(path.join(dist, "app.js"), "verified");
  const config = path.join(root, "tauri.json");
  fs.writeFileSync(
    config,
    JSON.stringify({
      version: "1.0.0",
      build: { beforeBuildCommand: "npm run build", frontendDist: "../dist" },
    }),
  );
  return { dist, config, sha: "a".repeat(40) };
}
test("all native platforms consume the same verified assets and skip duplicate production builds", (t) => {
  const { dist, config, sha } = fixture(t);
  sealFrontend(dist, sha);
  assert.equal(useFrontend(dist, sha, config), 2);
  const c = JSON.parse(fs.readFileSync(config));
  assert.equal(c.build.beforeBuildCommand, null);
  assert.equal(c.build.frontendDist, "../dist");
  assert.equal(c.version, "1.0.0");
});
test("stale source revision cannot disable the frontend build", (t) => {
  const { dist, config, sha } = fixture(t);
  sealFrontend(dist, sha);
  assert.throws(
    () => useFrontend(dist, "b".repeat(40), config),
    /revision mismatch/,
  );
  assert.equal(
    JSON.parse(fs.readFileSync(config)).build.beforeBuildCommand,
    "npm run build",
  );
});
test("missing, injected and modified assets fail verification", (t) => {
  const { dist, config, sha } = fixture(t);
  sealFrontend(dist, sha);
  fs.writeFileSync(path.join(dist, "app.js"), "tampered");
  assert.throws(() => useFrontend(dist, sha, config), /checksum/);
  fs.writeFileSync(path.join(dist, "app.js"), "verified");
  fs.unlinkSync(path.join(dist, "app.js"));
  assert.throws(() => useFrontend(dist, sha, config), /file set/);
  fs.writeFileSync(path.join(dist, "app.js"), "verified");
  fs.writeFileSync(path.join(dist, "extra.js"), "unexpected");
  assert.throws(() => useFrontend(dist, sha, config), /file set/);
});
