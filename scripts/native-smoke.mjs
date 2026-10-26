/** Real Tauri/WebKit smoke test: native SQLite edits, portable isolation, restart and physical-corruption recovery. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const base = process.env.TAURI_DRIVER_URL || "http://127.0.0.1:4444",
  application = path.resolve(
    process.env.TAURI_APPLICATION || "src-tauri/target/debug/zhinexus",
  );
let session = "";
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
  const e = await waitFor(() => element(selector));
  await command(
    "POST",
    "/element/" + e["element-6066-11e4-a52e-4f735466cecf"] + "/click",
    {},
  );
}
/** Enter text with standard WebDriver keyboard events so React receives actual input. */
async function type(selector, text) {
  const e = await waitFor(() => element(selector)),
    id = e["element-6066-11e4-a52e-4f735466cecf"];
  await command("POST", "/element/" + id + "/clear", {});
  await command("POST", "/element/" + id + "/value", { text });
}
/** Start a Tauri process and wait for the SQLite-backed workspace. */
async function start() {
  await waitFor(async () => {
    const r = await fetch(base + "/status");
    return (await r.json()).value.ready;
  });
  const data = await command("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application } } },
  });
  session = data.sessionId;
  await waitFor(() => script('return !!document.querySelector(".app-shell")'));
  assert.equal(await script("return !!window.__TAURI_INTERNALS__"), true);
}
/** Close only the process created by this test. */
async function stop() {
  if (session) {
    await command("DELETE", "");
    session = "";
  }
}
const marker = path.join(path.dirname(application), "portable");
assert.ok(
  !fs.existsSync(marker),
  "Test requires no pre-existing portable marker",
);
try {
  await start();
  await click(".sidebar-bottom>button");
  await click(".settings-tabs button:nth-child(7)");
  await waitFor(() =>
    script('return !!document.querySelector(".database-stats")'),
  );
  const systemInfo = await script(
    'return document.querySelector(".settings-content .notice")?.innerText',
  );
  assert.ok(!systemInfo.includes("_data"));
  await stop();
  fs.writeFileSync(marker, "");
  await start();
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
  await click(".settings-tabs button:nth-child(7)");
  await waitFor(() =>
    script('return !!document.querySelector(".database-stats")'),
  );
  const portableInfo = await script(
    'return document.querySelector(".settings-content .notice")?.innerText',
  );
  assert.ok(portableInfo.includes("_data"));
  fs.mkdirSync("native-test-results", { recursive: true });
  fs.writeFileSync(
    "native-test-results/native-database.png",
    Buffer.from(await command("GET", "/screenshot"), "base64"),
  );
  await stop();
  const root = path.join(path.dirname(application), "_data"),
    db = path.join(root, "zhinexus.db");
  assert.ok(fs.existsSync(db));
  assert.ok(fs.existsSync(path.join(root, "recovery", "journal", "events")));
  // WAL can legitimately repair the primary header by itself. Damage both headers to exercise the independent checkpoint/journal fallback.
  for (const file of [db, db + "-wal"]) {
    if (!fs.existsSync(file)) continue;
    const damaged = fs.readFileSync(file);
    damaged.fill(0, 0, Math.min(64, damaged.length));
    fs.writeFileSync(file, damaged);
  }
  await start();
  await click(".sidebar nav button:nth-child(2)");
  await type(".search-box input", "Native portable recovery");
  await waitFor(() =>
    script('return document.querySelectorAll(".entry-card").length===1'),
  );
  await click(".entry-card");
  await waitFor(() =>
    script(
      'return document.querySelector(".paper .markdown")?.innerText.includes("Verified native edit survives corruption.")',
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
    "PASS: native SQLite editing, system/portable isolation, restart and durable-journal corruption recovery",
  );
} catch (error) {
  fs.mkdirSync("native-test-results", { recursive: true });
  fs.writeFileSync(
    "native-test-results/error.txt",
    String(error.stack || error),
  );
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
  if (fs.existsSync(marker)) fs.unlinkSync(marker);
}
