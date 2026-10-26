/** Android target support is independent of newer stable compile-SDK templates. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { configureAndroid, configureActivity } from "./configure-android.mjs";
test("retains current compileSdk while enforcing Android 15 minimum", () => {
  const r = configureAndroid("compileSdk = 37\nminSdk = 26", 35);
  assert.equal(r.compileSdk, 37);
  assert.match(r.text, /minSdk = 35/);
});
test("does not allow unsupported older Android targets", () =>
  assert.throws(() => configureAndroid("compileSdk = 37", 26)));
test("native safe areas attach after WebView setup without replacing generated activity behavior", () => {
  const text =
    "enableEdgeToEdge()\nsuper.onCreate(savedInstanceState)\nsetupOtherPlugin()";
  const result = configureActivity(text);
  assert.match(
    result,
    /enableEdgeToEdge\(\)\nsuper\.onCreate\(savedInstanceState\)\n    io\.github\.txsdx\.zhinexus\.ui\.SystemInsets\.apply\(this\)\nsetupOtherPlugin\(\)/,
  );
  assert.equal(configureActivity(result), result);
});
test("an unsupported activity template fails before shipping without safe areas", () =>
  assert.throws(
    () => configureActivity("class ChangedActivity"),
    /Unsupported Android activity template/,
  ));
