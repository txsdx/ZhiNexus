/** Align generated Android minimum SDK with the committed Tauri requirement and report the current template SDK. */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
/** Apply the user's Android 15+ requirement without pinning a stale generated compile SDK. */
export function configureAndroid(text, minSdk) {
  if (!Number.isInteger(minSdk) || minSdk < 35)
    throw Error("Android 15+ requires minSdk >= 35");
  const sdk = Number(text.match(/compileSdk\s*=\s*(\d+)/)?.[1]);
  if (!sdk) throw Error("Generated Android compileSdk not found");
  return {
    text: text.replace(/minSdk\s*=\s*\d+/, `minSdk = ${minSdk}`),
    compileSdk: sdk,
  };
}
/** Preserve generated activity behavior and install safe areas plus native page-zoom policy exactly once. */
export function configureActivity(text) {
  const call = "io.github.txsdx.zhinexus.ui.SystemInsets.apply(this)";
  const anchor = "super.onCreate(savedInstanceState)";
  if (!text.includes(anchor))
    throw Error(
      "Unsupported Android activity template; review system inset initialization",
    );
  if (!text.includes(call))
    text = text.replace(anchor, anchor + "\n    " + call);
  const gestureCall = "io.github.txsdx.zhinexus.ui.PageGestures.apply(webView)";
  if (!text.includes(gestureCall)) {
    if (
      /fun\s+onWebViewCreate\s*\(/.test(text) ||
      !text.trimEnd().endsWith("}")
    )
      throw Error(
        "Unsupported Android WebView hook; review gesture initialization",
      );
    const end = text.lastIndexOf("}");
    text =
      text.slice(0, end) +
      `  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    ${gestureCall}
  }
` +
      text.slice(end);
  }
  return text;
}
/** Replace generated template launcher resources and bind normal/round icons to the committed application artwork. */
export function configureLauncherIcons(manifest, resourceDir) {
  fs.cpSync("src-tauri/icons/android", resourceDir, { recursive: true });
  fs.copyFileSync(
    "src-tauri/icons/android/mipmap-anydpi-v26/ic_launcher.xml",
    resourceDir + "/mipmap-anydpi-v26/ic_launcher_round.xml",
  );
  if (!/<application\b[^>]*>/.test(manifest))
    throw Error("Android application manifest tag not found");
  return manifest.replace(/<application\b[^>]*>/, (tag) => {
    for (const [attribute, value] of [
      ["icon", "@mipmap/ic_launcher"],
      ["roundIcon", "@mipmap/ic_launcher_round"],
    ]) {
      const pattern = new RegExp(`android:${attribute}="[^"]*"`);
      const replacement = `android:${attribute}="${value}"`;
      tag = pattern.test(tag)
        ? tag.replace(pattern, replacement)
        : tag.replace(
            /\s*(\/?)>$/,
            (_, slash) => ` ${replacement}${slash ? " /" : ""}>`,
          );
    }
    return tag;
  });
}
/** Modify only Tauri's ignored generated project, keeping source requirements and CI metadata synchronized. */
export function run() {
  const file = "src-tauri/gen/android/app/build.gradle.kts";
  const config = JSON.parse(
      fs.readFileSync("src-tauri/tauri.conf.json", "utf8"),
    ),
    result = configureAndroid(
      fs.readFileSync(file, "utf8"),
      config.bundle.android.minSdkVersion,
    );
  fs.writeFileSync(file, result.text);
  const activity =
    "src-tauri/gen/android/app/src/main/java/io/github/txsdx/zhinexus/MainActivity.kt";
  fs.writeFileSync(
    activity,
    configureActivity(fs.readFileSync(activity, "utf8")),
  );
  const uiDir =
    "src-tauri/gen/android/app/src/main/java/io/github/txsdx/zhinexus/ui";
  fs.mkdirSync(uiDir, { recursive: true });
  fs.copyFileSync(
    "src-tauri/mobile/android/SystemInsets.kt",
    uiDir + "/SystemInsets.kt",
  );
  fs.copyFileSync(
    "src-tauri/mobile/android/PageGestures.kt",
    uiDir + "/PageGestures.kt",
  );
  const props = "src-tauri/gen/android/gradle.properties";
  const current = fs.existsSync(props) ? fs.readFileSync(props, "utf8") : "";
  if (!current.includes("org.gradle.caching="))
    fs.appendFileSync(
      props,
      "\norg.gradle.caching=true\norg.gradle.parallel=true\n",
    );
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `compile_sdk=${result.compileSdk}\nplatform_package=platforms;android-${result.compileSdk >= 37 ? result.compileSdk + ".0" : result.compileSdk}\n`,
    );
  const kotlinDir =
    "src-tauri/gen/android/app/src/main/java/io/github/txsdx/zhinexus/updates";
  fs.mkdirSync(kotlinDir, { recursive: true });
  fs.copyFileSync(
    "src-tauri/mobile/android/UpdateInstaller.kt",
    kotlinDir + "/UpdateInstaller.kt",
  );
  const xmlDir = "src-tauri/gen/android/app/src/main/res/xml";
  fs.mkdirSync(xmlDir, { recursive: true });
  fs.copyFileSync(
    "src-tauri/mobile/android/update_paths.xml",
    xmlDir + "/zhinexus_update_paths.xml",
  );
  const manifestPath = "src-tauri/gen/android/app/src/main/AndroidManifest.xml";
  let manifest = configureLauncherIcons(
    fs.readFileSync(manifestPath, "utf8"),
    "src-tauri/gen/android/app/src/main/res",
  );
  if (!manifest.includes("android.permission.REQUEST_INSTALL_PACKAGES"))
    manifest = manifest.replace(
      "<application",
      '<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES"/><application',
    );
  if (!manifest.includes("zhinexus-updates"))
    manifest = manifest.replace(
      "</application>",
      '<provider android:name="io.github.txsdx.zhinexus.updates.UpdateFileProvider" android:authorities="${applicationId}.zhinexus-updates" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/zhinexus_update_paths"/></provider></application>',
    );
  fs.writeFileSync(manifestPath, manifest);
  console.log(
    `Android minSdk=${config.bundle.android.minSdkVersion}; compileSdk=${result.compileSdk}`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run();
