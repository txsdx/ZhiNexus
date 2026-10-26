/** Android target support is independent of newer stable compile-SDK templates. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { configureAndroid } from "./configure-android.mjs";
test("retains current compileSdk while enforcing Android 15 minimum", () => {
  const r = configureAndroid("compileSdk = 37\nminSdk = 26", 35);
  assert.equal(r.compileSdk, 37);
  assert.match(r.text, /minSdk = 35/);
});
test("does not allow unsupported older Android targets", () =>
  assert.throws(() => configureAndroid("compileSdk = 37", 26)));
