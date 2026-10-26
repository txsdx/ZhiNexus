/** Tests for publishing with only GitHub's automatic token and optional updater signing. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareRelease } from "./release-config.mjs";
test("publication needs no custom signing secrets", () => {
  const r = prepareRelease({ config: {}, version: "0.2.0", publish: true });
  assert.equal(r.tag, "v0.2.0");
  assert.equal(r.signing, false);
  assert.deepEqual(r.config.plugins.updater.endpoints, []);
  assert.equal(r.config.bundle.createUpdaterArtifacts, false);
});
test("partial signing configuration does not block release publication", () => {
  assert.equal(
    prepareRelease({
      config: {},
      version: "1.0.0",
      publicKey: "public-only",
      publish: true,
    }).signing,
    false,
  );
});
test("complete signing configuration enables verified updater artifacts", () => {
  const original = { plugins: {}, bundle: {} };
  const r = prepareRelease({
    config: original,
    version: "1.0.0",
    publicKey: "test-public",
    hasPrivateKey: true,
  });
  assert.equal(r.signing, true);
  assert.equal(r.config.plugins.updater.pubkey, "test-public");
  assert.deepEqual(original, { plugins: {}, bundle: {} });
});
test("tag mismatch is rejected only for publication", () => {
  assert.throws(() =>
    prepareRelease({
      config: {},
      version: "1.0.0",
      tag: "v2.0.0",
      publish: true,
    }),
  );
});
