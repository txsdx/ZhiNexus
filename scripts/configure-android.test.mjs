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
    "class MainActivity : TauriActivity() {\noverride fun onCreate(savedInstanceState: Bundle?) {\nenableEdgeToEdge()\nsuper.onCreate(savedInstanceState)\nsetupOtherPlugin()\n}\n}\n";
  const result = configureActivity(text);
  assert.match(
    result,
    /enableEdgeToEdge\(\)\nsuper\.onCreate\(savedInstanceState\)\n    io\.github\.txsdx\.zhinexus\.ui\.SystemInsets\.apply\(this\)\nsetupOtherPlugin\(\)/,
  );
  assert.equal(configureActivity(result), result);
  assert.match(
    result,
    /override fun onWebViewCreate\(webView: android\.webkit\.WebView\)/,
  );
  assert.match(
    result,
    /super\.onWebViewCreate\(webView\)\n    io\.github\.txsdx\.zhinexus\.ui\.PageGestures\.apply\(webView\)/,
  );
});
test("an unsupported activity template fails before shipping without safe areas", () =>
  assert.throws(
    () => configureActivity("class ChangedActivity"),
    /Unsupported Android activity template/,
  ));
test("existing safe-area setup also receives the gesture hook, while unknown hooks fail closed", () => {
  const previous =
    "class MainActivity : TauriActivity() {\noverride fun onCreate(savedInstanceState: Bundle?) {\nsuper.onCreate(savedInstanceState)\nio.github.txsdx.zhinexus.ui.SystemInsets.apply(this)\n}\n}\n";
  const updated = configureActivity(previous);
  assert.equal(updated.match(/SystemInsets\.apply/g).length, 1);
  assert.equal(updated.match(/PageGestures\.apply/g).length, 1);
  assert.equal(configureActivity(updated), updated);
  assert.throws(
    () =>
      configureActivity(
        previous.replace(
          /}\s*$/,
          "override fun onWebViewCreate(webView: WebView) {}\n}",
        ),
      ),
    /Unsupported Android WebView hook/,
  );
});
