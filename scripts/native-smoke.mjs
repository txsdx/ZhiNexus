/** Real Tauri/WebKit smoke test: native SQLite edits, portable isolation, restart and physical-corruption recovery. */
import fs from "node:fs";
import { testNativeShortcuts } from "./native-shortcuts.mjs";
import { testNativeNetwork } from "./native-network.mjs";
import { testNativeOcr } from "./native-ocr.mjs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
const base = process.env.TAURI_DRIVER_URL || "http://127.0.0.1:4444",
  application = path.resolve(
    process.env.TAURI_APPLICATION || "src-tauri/target/debug/zhinexus",
  );
let session = "";
let ownedDriver;
let ownedApplication;
let driverOutput;
let driverError;
let applicationOutput;
let applicationError;
/** Submit one WebDriver command and preserve protocol failures. */
async function command(method, suffix, body) {
  const res = await fetch(
    base + (session ? "/session/" + session : "") + suffix,
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const data = await res.json();
  if (data.value?.error)
    throw Error(data.value.error + ": " + data.value.message);
  return data.value;
}
/** Poll a real rendered state while allowing startup and recovery work to complete. */
async function waitFor(fn, timeout = 45000) {
  const end = Date.now() + timeout;
  let error;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      error = e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw error || Error("Timed out waiting for native UI");
}
/** Execute an inspection script in the native webview, not a Chromium mock. */
const script = (code, args = []) =>
  command("POST", "/execute/sync", { script: code, args });
/** Find a control by its CSS identity. */
const element = (selector) =>
  command("POST", "/element", { using: "css selector", value: selector });
/** Click one real DOM control through the native driver. */
async function click(selector) {
  const e = await waitFor(async () => {
    const ready = await script(
      'const e=document.querySelector(arguments[0]);if(!e||e.disabled)return false;e.scrollIntoView({block:"center",inline:"nearest"});return true;',
      [selector],
    );
    return ready ? element(selector) : false;
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await command(
    "POST",
    "/element/" + e["element-6066-11e4-a52e-4f735466cecf"] + "/click",
    {},
  );
}
/** Enter text with standard WebDriver keyboard events so React receives actual input. */
async function type(selector, text, normalizedValues = []) {
  const e = await waitFor(() => element(selector)),
    id = e["element-6066-11e4-a52e-4f735466cecf"];
  // Select before typing: React can restore the old controlled value between clear() and sendKeys().
  await click(selector);
  await command("POST", "/actions", {
    actions: [
      {
        type: "key",
        id: "replace-input",
        actions: [
          { type: "keyDown", value: "\uE009" },
          { type: "keyDown", value: "a" },
          { type: "keyUp", value: "a" },
          { type: "keyUp", value: "\uE009" },
        ],
      },
    ],
  });
  // WebKit sendKeys ignores raw LF characters; use the WebDriver Return key for real multiline input.
  await command("POST", "/element/" + id + "/value", {
    text: text.replace(/\r\n?/g, "\n").replace(/\n/g, "\uE007"),
  });
  await waitFor(() =>
    script(
      "return [arguments[1],...arguments[2]].includes(document.querySelector(arguments[0])?.value)",
      [selector, text, normalizedValues],
    ),
  );
}
/** Start a Tauri process and wait for the SQLite-backed workspace. */
async function start() {
  await waitFor(async () => {
    const r = await fetch(base + "/status");
    return (await r.json()).value.ready;
  });
  let options = { "tauri:options": { application } };
  if (process.platform === "win32") {
    ownedApplication = spawn(application, [], {
      stdio: ["ignore", applicationOutput, applicationError],
      env: {
        ...process.env,
        RUST_BACKTRACE: "1",
        TAURI_WEBVIEW_AUTOMATION: "true",
        ZHINEXUS_TEST_DEBUG_PORT: "9222",
      },
    });
    ownedApplication.on("error", (error) =>
      fs.appendFileSync(
        "native-test-results/application.err.log",
        String(error),
      ),
    );
    await waitFor(async () => {
      const res = await fetch("http://127.0.0.1:9222/json/version");
      return res.ok;
    });
    options = {
      browserName: "webview2",
      "ms:edgeChromium": true,
      "ms:edgeOptions": { debuggerAddress: "127.0.0.1:9222" },
    };
  }
  const data = await command("POST", "/session", {
    capabilities: { alwaysMatch: options },
  });
  session = data.sessionId;
  await waitFor(() => script('return !!document.querySelector(".app-shell")'));
  assert.equal(await script("return !!window.__TAURI_INTERNALS__"), true);
  await waitFor(() => script('return document.fonts.status === "loaded"'));
  // Native window fitting and offline font loading must settle before coordinate-based clicks.
  await new Promise((resolve) => setTimeout(resolve, 500));
}
/** Close only the process created by this test. */
async function stop() {
  try {
    if (session) {
      // Closing a window now hides it in the tray. Explicitly quit the test-owned app before releasing its driver session.
      await script(
        'setTimeout(()=>window.__TAURI_INTERNALS__.invoke("quit_desktop"),50);return true;',
      ).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 300));
      await command("DELETE", "").catch(() => {});
    }
  } finally {
    session = "";
    if (ownedApplication) {
      const child = ownedApplication;
      ownedApplication = undefined;
      child.kill();
      await waitFor(
        () => child.exitCode !== null || child.signalCode !== null,
        10000,
      );
      await waitFor(async () => {
        try {
          await fetch("http://127.0.0.1:9222/json/version");
          return false;
        } catch {
          return true;
        }
      }, 10000);
    }
  }
}
const marker = path.join(path.dirname(application), "portable");
assert.ok(
  !fs.existsSync(marker),
  "Test requires no pre-existing portable marker",
);
try {
  // Microsoft EdgeDriver directly supports WebView2; owning it here also preserves verbose startup diagnostics.
  if (process.env.TAURI_NATIVE_DRIVER) {
    fs.mkdirSync("native-test-results", { recursive: true });
    driverOutput = fs.openSync("native-test-results/tauri-driver.log", "w");
    driverError = fs.openSync("native-test-results/tauri-driver.err.log", "w");
    applicationOutput = fs.openSync("native-test-results/application.log", "w");
    applicationError = fs.openSync(
      "native-test-results/application.err.log",
      "w",
    );
    ownedDriver = spawn(
      process.env.TAURI_NATIVE_DRIVER,
      [
        "--port=4444",
        "--verbose",
        "--log-path=" + path.resolve("native-test-results/edgedriver.log"),
      ],
      {
        stdio: ["ignore", driverOutput, driverError],
        windowsHide: true,
        env: { ...process.env, TAURI_WEBVIEW_AUTOMATION: "true" },
      },
    );
    ownedDriver.on("error", (error) =>
      fs.appendFileSync(
        "native-test-results/tauri-driver.err.log",
        String(error),
      ),
    );
  }
  await start();
  await click(".sidebar-bottom>button");
  await click('.settings-tabs [data-settings-tab="database"]');
  await waitFor(() =>
    script('return !!document.querySelector(".database-stats")'),
  );
  // Exercise the maintained SDK against a real directly spawned local child, using the normal settings UI.
  await click('.settings-tabs [data-settings-tab="mcp"]');
  await script(
    'document.querySelectorAll(".settings-content button")[0].click();return true;',
  );
  await waitFor(() =>
    script('return !!document.querySelector(".mcp-card select")'),
  );
  await script(
    'const select=document.querySelector(".mcp-card select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(select,"stdio");select.dispatchEvent(new Event("change",{bubbles:true}));return true;',
  );
  await type(".mcp-card input:not([type])", "Native MCP fixture");
  await type(".mcp-card label:nth-of-type(3) input", process.execPath);
  await type(
    ".mcp-card textarea",
    JSON.stringify([path.resolve("scripts/fixtures/mcp-server.mjs")]),
  );
  await click('.mcp-card input[type="checkbox"]');
  await click(".mcp-card .actions button");
  const mcpResult = await waitFor(() =>
    script('return document.querySelector(".toast")?.innerText'),
  );
  assert.match(mcpResult, /Connected: 1 tools|连接成功：1 个工具/);
  await click('.settings-tabs [data-settings-tab="database"]');
  await testNativeShortcuts({ click, script, waitFor, command });
  await testNativeNetwork({ click, type, script, waitFor });
  await testNativeOcr({ command, script, click, type, waitFor });
  await click(".sidebar-bottom>button");
  await click('[data-settings-tab="database"]');
  await click("[data-storage-location] summary");
  const systemInfo = await script(
    'return document.querySelector("[data-storage-location] .notice code")?.innerText',
  );
  assert.ok(!systemInfo.includes("_data"));
  await stop();
  fs.writeFileSync(marker, "");
  await start();
  // A previous failed smoke run may have left this fixture's intentionally unsaved draft; exercise cancel before reusing it.
  if (
    await script(
      'return document.querySelector(".title-input")?.value==="Native portable recovery"',
    )
  )
    await click(".entry-heading .actions button:nth-child(2)");
  await click(".capture-button");
  await type(".modal input", "Native portable recovery");
  await type(".modal textarea", "Native SQLite first draft");
  await click(".modal .primary");
  await waitFor(() =>
    script(
      'return document.querySelector(".entry-heading h1")?.innerText==="Native portable recovery"',
    ),
  );
  await click(".entry-heading .actions button:nth-child(2)");
  await click('[data-editor-mode="rich"]');
  await click('.block-document[contenteditable="true"]');
  const richText = "native rich block editing persists.";
  await command("POST", "/actions", {
    actions: [
      {
        type: "key",
        id: "rich-editor",
        actions: [
          { type: "keyDown", value: "\uE009" },
          { type: "keyDown", value: "a" },
          { type: "keyUp", value: "a" },
          { type: "keyUp", value: "\uE009" },
          ...Array.from(richText).flatMap((value) => [
            { type: "keyDown", value },
            { type: "keyUp", value },
          ]),
        ],
      },
    ],
  });
  await waitFor(() =>
    script(
      'return document.querySelector(".rich-editor")?.textContent.includes("native rich block editing persists.")',
    ),
  );
  await click(".entry-heading .primary");
  await waitFor(() =>
    script(
      'return !document.querySelector(".title-input")&&document.querySelector(".rich-editor")?.textContent.includes("native rich block editing persists.")',
    ),
  );
  await click(".entry-heading .actions button:nth-child(2)");
  await click('[data-editor-mode="source"]');
  await type(
    ".content-editor",
    "# Native portable recovery\n\nVerified native edit survives corruption.",
  );
  await click(".entry-heading .primary");
  await waitFor(() =>
    script(
      'return document.querySelector(".paper .markdown")?.innerText.includes("Verified native edit")',
    ),
  );
  await click(".sidebar-bottom>button");
  await click('.settings-tabs [data-settings-tab="database"]');
  await waitFor(() =>
    script('return !!document.querySelector(".database-stats")'),
  );
  await click("[data-storage-location] summary");
  const portableInfo = await script(
    'return document.querySelector("[data-storage-location] .notice code")?.innerText',
  );
  assert.ok(portableInfo.includes("_data"));
  fs.mkdirSync("native-test-results", { recursive: true });
  fs.writeFileSync(
    "native-test-results/native-database.png",
    Buffer.from(await command("GET", "/screenshot"), "base64"),
  );
  // Force all three independent generations to cover the current union before pruning its recovery mirror.
  const cleaned = await command("POST", "/execute/async", {
    script:
      'const done=arguments[arguments.length-1];const invoke=window.__TAURI_INTERNALS__.invoke;(async()=>{for(let i=0;i<3;i++)await invoke("checkpoint_storage");return invoke("cleanup_storage");})().then(done,e=>done({error:String(e)}));',
    args: [],
  });
  assert.ok(!cleaned.error, cleaned.error);
  assert.ok(cleaned.files > 0);
  assert.ok(cleaned.bytes > 0);
  await stop();
  const root = path.join(path.dirname(application), "_data"),
    db = path.join(root, "zhinexus.db");
  const journal = path.join(root, "recovery", "journal", "events");
  assert.ok(fs.existsSync(db));
  const mirrored = () =>
    fs.readdirSync(journal).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
  assert.equal(
    mirrored().length,
    0,
    "All current operations are covered by all three checkpoints",
  );
  await start();
  await waitFor(() =>
    script(
      'return document.body.innerText.includes("Native portable recovery")',
    ),
  );
  assert.equal(
    mirrored().length,
    0,
    "Restart must not recreate the checkpoint-covered journal",
  );
  const freshTitle = "After cleanup " + Date.now();
  await click(".capture-button");
  await type(".modal input", freshTitle);
  await type(
    ".modal textarea",
    "A newer journal record must survive fallback to an older checkpoint.",
  );
  await click(".modal .primary");
  await waitFor(() =>
    script(
      'return document.querySelector(".entry-heading h1")?.innerText===arguments[0]',
      [freshTitle],
    ),
  );
  assert.ok(
    mirrored().length > 0,
    "New edits after cleanup must still be journaled",
  );
  await stop();
  // A damaged newest checkpoint must not lose records whose journal copies were safely pruned.
  const latest = fs
    .readdirSync(path.join(root, "recovery"))
    .filter((name) => /^checkpoint-.*\.sqlite$/.test(name))
    .sort()
    .at(-1);
  assert.ok(latest);
  const checkpointPath = path.join(root, "recovery", latest),
    checkpointBytes = fs.readFileSync(checkpointPath);
  checkpointBytes.fill(0, 0, Math.min(128, checkpointBytes.length));
  fs.writeFileSync(checkpointPath, checkpointBytes);
  // WAL can legitimately repair the primary header by itself. Damage both headers to exercise the independent checkpoint/journal fallback.
  for (const file of [db, db + "-wal"]) {
    if (!fs.existsSync(file)) continue;
    const damaged = fs.readFileSync(file);
    damaged.fill(0, 0, Math.min(64, damaged.length));
    fs.writeFileSync(file, damaged);
  }
  await start();
  await click(".sidebar nav button:nth-child(2)");
  await type(".search-box input", freshTitle);
  await waitFor(() =>
    script(
      'return Array.from(document.querySelectorAll(".entry-row")).some(row=>row.innerText.includes(arguments[0]))',
      [freshTitle],
    ),
  );
  await type(".search-box input", "Native portable recovery");
  await waitFor(() =>
    script('return document.querySelectorAll(".entry-row").length===1'),
  );
  await click(".entry-title-cell button");
  await waitFor(() =>
    script(
      'return document.querySelector(".paper .markdown h1")?.textContent==="Native portable recovery"&&document.querySelector(".paper .markdown")?.innerText.includes("Verified native edit survives corruption.")',
    ),
  );
  assert.ok(
    fs
      .readdirSync(path.join(root, "recovery"))
      .some((n) => n.startsWith("damaged-")),
  );
  fs.writeFileSync(
    "native-test-results/native-recovery.png",
    Buffer.from(await command("GET", "/screenshot"), "base64"),
  );
  await stop();
  console.log(
    "PASS: native shortcut recording, screenshot/OCR, custom-port proxy/model networking, MCP stdio SDK, SQLite editing, system/portable isolation, cleanup surviving restart and recovery after primary/WAL/newest-checkpoint corruption",
  );
} catch (error) {
  fs.mkdirSync("native-test-results", { recursive: true });
  fs.writeFileSync(
    "native-test-results/error.txt",
    String(error.stack || error),
  );
  if (process.platform === "win32") {
    fs.writeFileSync(
      "native-test-results/application-status.json",
      JSON.stringify(
        {
          pid: ownedApplication?.pid,
          exitCode: ownedApplication?.exitCode,
          signal: ownedApplication?.signalCode,
        },
        null,
        2,
      ),
    );
    const config = JSON.parse(
      fs.readFileSync("src-tauri/tauri.conf.json", "utf8"),
    );
    for (const root of [
      path.join(process.env.APPDATA, config.identifier),
      path.join(path.dirname(application), "_data"),
    ]) {
      const diagnostic = path.join(root, "recovery", "native-startup.log");
      if (fs.existsSync(diagnostic))
        fs.copyFileSync(
          diagnostic,
          path.join(
            "native-test-results",
            root.endsWith("_data")
              ? "portable-native-startup.log"
              : "system-native-startup.log",
          ),
        );
    }
    try {
      fs.writeFileSync(
        "native-test-results/processes.json",
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'ZhiNexus|msedgewebview2' } | Select-Object Name,ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Depth 3",
          ],
          { encoding: "utf8", timeout: 15000 },
        ),
      );
    } catch {}
  }
  try {
    fs.writeFileSync(
      "native-test-results/native-failure.txt",
      String(await script("return document.body.innerText")),
    );
    fs.writeFileSync(
      "native-test-results/native-failure.png",
      Buffer.from(await command("GET", "/screenshot"), "base64"),
    );
  } catch {}
  throw error;
} finally {
  await stop().catch(() => {});
  ownedDriver?.kill();
  if (driverOutput !== undefined) fs.closeSync(driverOutput);
  if (driverError !== undefined) fs.closeSync(driverError);
  if (applicationOutput !== undefined) fs.closeSync(applicationOutput);
  if (applicationError !== undefined) fs.closeSync(applicationError);
  if (fs.existsSync(marker)) fs.unlinkSync(marker);
}
