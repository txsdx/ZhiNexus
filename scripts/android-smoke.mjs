/** Exercise the installed native Android WebView through CDP, preserving real SQLite and OS notification integration. */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import http from "node:http";
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
/** Capture the actual display without changing WebView layout metrics to emulate a full-page screenshot. */
function captureScreen(name) {
  fs.writeFileSync(
    "android-test-results/" + name + ".png",
    execFileSync(adb, ["exec-out", "screencap", "-p"], {
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
}
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
  // The debug socket can be listening before its new page target exists after a force-stop.
  await waitFor(async () => {
    const response = await fetch("http://127.0.0.1:9223/json/list");
    const targets = await response.json();
    return targets.some(
      (target) => target.type === "page" && target.webSocketDebuggerUrl,
    );
  });
  const { browser, page } = await waitFor(async () => {
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", {
      noDefaults: true,
      timeout: 10000,
    });
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => !page.isClosed());
    if (page) return { browser, page };
    await browser.close();
    return false;
  });
  connected = { browser, page };
  await page.waitForSelector(".app-shell", { timeout: 60000 });
  assert.equal(await page.evaluate(() => !!window.__TAURI_INTERNALS__), true);
  const display = device("shell", "wm", "size").match(
    /Physical size:\s*(\d+)x(\d+)/,
  );
  assert.ok(display, "The emulator must report its physical display size");
  const viewport = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
    dpr: devicePixelRatio,
  }));
  fs.writeFileSync(
    "android-test-results/viewport.json",
    JSON.stringify(viewport, null, 2),
  );
  assert.ok(
    viewport.height * viewport.dpr <= Number(display[2]) - 24,
    "The native WebView must leave room for system bars instead of drawing underneath them",
  );
  const cdp = await page.context().newCDPSession(page);
  try {
    const scale = await page.evaluate(() => window.visualViewport.scale);
    for (const scaleFactor of [1.8, 0.65]) {
      await cdp.send("Input.synthesizePinchGesture", {
        x: viewport.width / 2,
        y: viewport.height / 2,
        scaleFactor,
        relativeSpeed: 400,
        gestureSourceType: "touch",
      });
      assert.ok(
        Math.abs(
          (await page.evaluate(() => window.visualViewport.scale)) - scale,
        ) < 0.01,
        "Native page magnification must stay disabled after a two-finger pinch",
      );
    }
  } finally {
    await cdp.detach();
  }
  return { browser, page };
}
/** Verify real chunk delivery across the Android native HTTP bridge before the provider completes. */
async function testStreaming(page) {
  let requests = 0,
    finish = () => {};
  const fixture = http.createServer((request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "android-stream-model" }] }));
      return;
    }
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const body = JSON.parse(raw);
      assert.equal(body.stream, true);
      assert.equal(body.model, "android-stream-model");
      if (body.messages?.[0]?.content?.startsWith("为这段对话生成一个简短")) {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end(
          "data: " +
            JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    content: JSON.stringify({
                      title: "Android generated title",
                    }),
                  },
                  finish_reason: "stop",
                },
              ],
            }) +
            "\n\ndata: [DONE]\n\n",
        );
        return;
      }
      requests++;
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      response.flushHeaders();
      response.write(
        'data: {"choices":[{"index":0,"delta":{"content":"Android streaming partial"}}]}\n\n',
      );
      finish = () =>
        response.end(
          'data: {"choices":[{"index":0,"delta":{"content":" complete"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        );
    });
  });
  await new Promise((resolve) => fixture.listen(0, "0.0.0.0", resolve));
  try {
    await page.locator('[data-settings-tab="ai"]').click();
    await page
      .locator(
        '.settings-content input[placeholder="https://api.example.com/v1"]',
      )
      .fill(`http://10.0.2.2:${fixture.address().port}/v1`);
    await page
      .locator('.settings-content input[type="password"]')
      .fill("android-stream-fixture");
    await page.locator(".settings-content .actions button").click();
    await page
      .locator(".model-list strong")
      .filter({ hasText: "android-stream-model" })
      .waitFor();
    await page.locator(".sidebar nav button[data-nav=agent]").click();
    await page
      .getByRole("combobox", { name: "Chat model", exact: true })
      .selectOption("android-stream-model");
    await page
      .locator(".chat-input textarea")
      .fill("Android streaming verification");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await waitFor(() =>
      page
        .locator(".ai-live-message")
        .textContent()
        .then((text) => text?.includes("Android streaming partial")),
    );
    assert.equal(requests, 1);
    assert.equal(
      await page
        .locator(".messages")
        .innerText()
        .then((text) => text.includes("partial complete")),
      false,
    );
    captureScreen("streaming-partial");
    finish();
    await page
      .locator(".message.assistant")
      .filter({ hasText: "Android streaming partial complete" })
      .waitFor();
    await page
      .locator(".chat-thread-header h1")
      .filter({ hasText: "Android generated title" })
      .waitFor();
    await page.locator(".ai-queue-button").click();
    await page.locator(".ai-task-center").waitFor();
    await page.locator(".ai-job-card").waitFor({ state: "hidden" });
    captureScreen("streaming-reviewed");
  } finally {
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
  }
}
fs.mkdirSync("android-test-results", { recursive: true });
let connected;
try {
  device("shell", "pm", "grant", pkg, "android.permission.POST_NOTIFICATIONS");
  device("shell", "am", "start", "-W", "-n", pkg + "/.MainActivity");
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
  await page.locator(".entry-heading .actions button:nth-child(2)").click();
  await page.locator('[data-editor-mode="rich"]').click();
  await page
    .locator('.block-document[contenteditable="true"]')
    .fill(
      "SQLite content survives a native restart. Rich blocks were edited on Android.",
    );
  await page.locator(".entry-heading .primary").click();
  await page.locator(".entry-heading h1").waitFor();
  await waitFor(() =>
    page
      .locator(".entry-tabs-status")
      .textContent()
      .then((text) => /Local drafts saved|本机草稿已保存/.test(text ?? "")),
  );
  captureScreen("entry");
  await connected.browser.close();
  connected = null;
  device("forward", "--remove", "tcp:9223");
  device("shell", "am", "force-stop", pkg);
  await waitFor(() => {
    try {
      return !device("shell", "pidof", pkg).trim();
    } catch {
      return true;
    }
  });
  device("shell", "am", "start", "-W", "-n", pkg + "/.MainActivity");
  connected = await connect();
  page = connected.page;
  await page.locator('.entry-tabs [role="tab"]').waitFor();
  assert.ok(
    await page.evaluate(
      () =>
        document.body.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
    "Restored blocks must not widen the mobile viewport or move fixed navigation outside it",
  );
  assert.ok(
    (await page.locator(".paper .markdown").innerText()).includes(
      "Rich blocks were edited on Android.",
    ),
  );
  await page.locator(".sidebar nav button[data-nav=library]").click();
  await page.locator(".search-box input").fill("Android native memory");
  await page.locator(".entry-title-cell button").click();
  assert.ok(
    (await page.locator(".paper .markdown").innerText()).includes(
      "SQLite content survives",
    ),
  );
  await page.locator(".mobile-settings").click();
  await page
    .locator('.settings-tabs [data-settings-tab="notifications"]')
    .click();
  const toggle = page.locator(".settings-content input[type=checkbox]").first();
  await toggle.check();
  await page.locator('[data-save-status="saved"]').waitFor();
  await waitFor(() => device("shell", "dumpsys", "alarm").includes(pkg));
  captureScreen("sync-reminders");
  await testStreaming(page);
  await page.locator(".mobile-settings").click();
  await page.locator('[data-settings-tab="about"]').click();
  await page.locator(".settings-content .actions button").first().click();
  await page
    .locator(".settings-content>section>h3,.settings-content>[role=alert]")
    .first()
    .waitFor({ timeout: 90000 });
  const updateFailure = page.locator(".settings-content>[role=alert]");
  if (await updateFailure.count()) throw Error(await updateFailure.innerText());
  assert.match(
    await page.locator(".settings-content>section>h3").innerText(),
    /^\d+\.\d+\.\d+\s*→\s*\d+\.\d+\.\d+$/,
  );
  captureScreen("private-release-updater");
  fs.writeFileSync(
    "android-test-results/result.txt",
    "PASS: Android native WebView, SQLite capture, rich blocks, restored tabs, mobile navigation, process restart, per-device reminder, OS alarm registration and genuine SSE chat before completion.\n",
  );
  console.log(
    "PASS: Android native storage, restart, OS notification scheduling, genuine SSE chat and validated GitHub Release manifest download",
  );
} catch (error) {
  fs.writeFileSync(
    "android-test-results/error.txt",
    String(error.stack || error),
  );
  try {
    captureScreen("failure");
  } catch {}
  if (connected)
    await connected.page
      .evaluate(() => {
        const button = document.querySelector(
          ".sidebar nav button[data-nav=library]",
        );
        const bounds = button?.getBoundingClientRect();
        return {
          width: innerWidth,
          height: innerHeight,
          bodyWidth: document.body.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          dpr: devicePixelRatio,
          viewport: visualViewport && {
            width: visualViewport.width,
            height: visualViewport.height,
            scale: visualViewport.scale,
          },
          navigation: bounds?.toJSON(),
          hit:
            bounds &&
            document.elementFromPoint(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2,
            )?.tagName,
        };
      })
      .then((value) =>
        fs.writeFileSync(
          "android-test-results/layout.json",
          JSON.stringify(value, null, 2),
        ),
      )
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
    const pid = device("shell", "pidof", pkg).trim().split(/\s/)[0];
    if (pid)
      fs.writeFileSync(
        "android-test-results/app-logcat.txt",
        device("logcat", "-d", "--pid", pid),
      );
    fs.writeFileSync(
      "android-test-results/activity.txt",
      device("shell", "dumpsys", "activity", "top"),
    );
    const targets = await fetch("http://127.0.0.1:9223/json/list")
      .then((response) => response.json())
      .catch(() => null);
    fs.writeFileSync(
      "android-test-results/devtools-targets.json",
      JSON.stringify(targets, null, 2),
    );
  } catch {}
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
