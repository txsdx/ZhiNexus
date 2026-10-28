/** Android target support is independent of newer stable compile-SDK templates. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configureAndroid,
  configureActivity,
  configureLauncherIcons,
} from "./configure-android.mjs";
test("retains current compileSdk while enforcing Android 15 minimum", () => {
  const r = configureAndroid("compileSdk = 37\nminSdk = 26", 35);
  assert.equal(r.compileSdk, 37);
  assert.match(r.text, /minSdk = 35/);
});
test("does not allow unsupported older Android targets", () =>
  assert.throws(() => configureAndroid("compileSdk = 37", 26)));
test("both adaptive launcher shapes replace generated placeholder artwork, including reconfigured projects", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "zhinexus-launcher-"));
  try {
    const adaptive = path.join(fixture, "mipmap-anydpi-v26");
    fs.mkdirSync(adaptive, { recursive: true });
    fs.writeFileSync(
      path.join(adaptive, "ic_launcher_round.xml"),
      "<adaptive-icon>template circles</adaptive-icon>",
    );
    const manifest =
      '<manifest><application android:icon="@drawable/template" android:roundIcon="@mipmap/template_round" android:label="知枢"><activity/></application></manifest>';
    const configured = configureLauncherIcons(manifest, fixture);
    assert.match(configured, /android:icon="@mipmap\/ic_launcher"/);
    assert.match(configured, /android:roundIcon="@mipmap\/ic_launcher_round"/);
    assert.match(configured, /android:label="知枢"/);
    for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
      assert.equal(
        fs.readFileSync(path.join(adaptive, name), "utf8"),
        fs.readFileSync(
          "src-tauri/icons/android/mipmap-anydpi-v26/ic_launcher.xml",
          "utf8",
        ),
      );
    }
    assert.match(
      fs.readFileSync(path.join(adaptive, "ic_launcher.xml"), "utf8"),
      /@drawable\/zhinexus_launcher_foreground/,
    );
    assert.match(
      fs.readFileSync(
        path.join(fixture, "drawable/zhinexus_launcher_foreground.xml"),
        "utf8",
      ),
      /android:inset="21dp"/,
    );
    for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
      for (const name of [
        "ic_launcher",
        "ic_launcher_round",
        "ic_launcher_foreground",
      ]) {
        const relative = `mipmap-${density}/${name}.png`;
        assert.deepEqual(
          fs.readFileSync(path.join(fixture, relative)),
          fs.readFileSync("src-tauri/icons/android/" + relative),
        );
      }
    }
    assert.equal(configureLauncherIcons(configured, fixture), configured);
    assert.match(
      configureLauncherIcons("<manifest><application /></manifest>", fixture),
      /android:roundIcon="@mipmap\/ic_launcher_round"/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
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
