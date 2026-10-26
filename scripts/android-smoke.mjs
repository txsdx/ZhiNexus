/** Exercise the installed native Android WebView through CDP, preserving real SQLite and OS notification integration. */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const adb = path.join(
    process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT,
    "platform-tools",
    "adb",
  ),
  pkg = "io.github.txsdx.zhinexus";
/** Execute bounded device operations without invoking a host shell or exposing credentials. */
const device = (...args) =>
  execFileSync(adb, args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
/** Wait for a remote WebView or a persisted UI transition. */
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  let error;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      error = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw error || Error("Android readiness timed out");
}
/** Reconnect to the application's own debug WebView after a real process restart. */
async function connect() {
  await waitFor(() => device("shell", "pidof", pkg).trim());
  const pid = device("shell", "pidof", pkg).trim().split(/\s/)[0];
  await waitFor(() =>
    device("shell", "cat", "/proc/net/unix").includes(
      "webview_devtools_remote_" + pid,
    ),
  );
  device("forward", "tcp:9223", "localabstract:webview_devtools_remote_" + pid);
  const browser = await waitFor(() =>
    chromium.connectOverCDP("http://127.0.0.1:9223", { noDefaults: true }),
  );
  const page = await waitFor(() => browser.contexts()[0]?.pages()[0]);
  connected = { browser, page };
  await page.waitForSelector(".app-shell", { timeout: 60000 });
  assert.equal(await page.evaluate(() => !!window.__TAURI_INTERNALS__), true);
  return { browser, page };
}
fs.mkdirSync("android-test-results", { recursive: true });
let connected;
try {
  device("shell", "pm", "grant", pkg, "android.permission.POST_NOTIFICATIONS");
  device("shell", "am", "start", "-n", pkg + "/.MainActivity");
  connected = await connect();
  let { page } = connected;
  await page.locator(".page-heading .primary").click();
  await page.locator(".modal input").fill("Android native memory");
  await page
    .locator(".modal textarea")
    .fill(
      "# Android native memory\n\nSQLite content survives a native restart.",
    );
  await page.locator(".modal .primary").click();
  await page.locator(".entry-heading h1").waitFor();
  assert.ok(
    await page
      .locator(".paper .markdown")
      .innerText()
      .then((t) => t.includes("SQLite content survives")),
  );
  await page.screenshot({
    path: "android-test-results/entry.png",
    fullPage: true,
  });
  await connected.browser.close();
  connected = null;
  device("shell", "am", "force-stop", pkg);
  device("shell", "am", "start", "-n", pkg + "/.MainActivity");
  connected = await connect();
  page = connected.page;
  await page.locator(".sidebar nav button:nth-child(2)").click();
  await page.locator(".search-box input").fill("Android native memory");
  await page.locator(".entry-card").click();
  assert.ok(
    (await page.locator(".paper .markdown").innerText()).includes(
      "SQLite content survives",
    ),
  );
  await page.locator(".mobile-settings").click();
  await page.locator('.settings-tabs [data-settings-tab="notifications"]').click();
  const toggle = page.locator(".settings-content input[type=checkbox]").first();
  await toggle.check();
  await page.locator(".settings-content .primary").click();
  await waitFor(() => device("shell", "dumpsys", "alarm").includes(pkg));
  await page.screenshot({
    path: "android-test-results/sync-reminders.png",
    fullPage: true,
  });
  fs.writeFileSync(
    "android-test-results/result.txt",
    "PASS: Android native WebView, SQLite capture, process restart, per-device reminder and OS alarm registration.\n",
  );
  console.log(
    "PASS: Android native storage, restart and OS notification scheduling",
  );
} catch (error) {
  fs.writeFileSync(
    "android-test-results/error.txt",
    String(error.stack || error),
  );
  if (connected)
    await connected.page
      .screenshot({ path: "android-test-results/failure.png", fullPage: true })
      .catch(() => {});
  if (connected)
    fs.writeFileSync(
      "android-test-results/page.txt",
      await connected.page
        .locator("body")
        .innerText()
        .catch(() => "WebView disconnected"),
    );
  try {
    fs.writeFileSync(
      "android-test-results/logcat.txt",
      device("logcat", "-d", "-t", "5000"),
    );
  } catch {}
  throw error;
} finally {
  await connected?.browser.close();
}
