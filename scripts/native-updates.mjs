/** Exercise public/private GitHub Release discovery in the installed app without launching an installer. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

/** Run the shipped Windows executable as its real replacement helper; verify both storage modes and corrupt-handoff rejection. */
export function testExecutableReplacement(application) {
  if (process.platform !== "win32") return;
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "zhinexus-exe-replacement-"),
  );
  const bytes = fs.readFileSync(application),
    hash = createHash("sha256").update(bytes).digest("hex");
  try {
    for (const mode of ["system", "portable", "bad-digest"]) {
      const directory = path.join(root, mode, "程序 空格"),
        data =
          mode === "portable"
            ? path.join(directory, "_data")
            : path.join(root, mode, "system-app-data"),
        cache = path.join(data, "updates");
      fs.mkdirSync(cache, { recursive: true });
      fs.mkdirSync(directory, { recursive: true });
      if (mode === "portable")
        fs.writeFileSync(path.join(directory, "portable"), "");
      const target = path.join(directory, "ZhiNexus_protable.exe"),
        payload = path.join(cache, hash + ".exe");
      const original = Buffer.concat([
        bytes,
        Buffer.from("previous-version-marker"),
      ]);
      fs.writeFileSync(target, original);
      fs.writeFileSync(payload, bytes);
      const database = path.join(data, "knowledge.db");
      fs.writeFileSync(database, "existing knowledge must remain");
      let plan;
      if (mode === "system") {
        const staged = path.join(directory, ".zhinexus-update-fixture.tmp"),
          backup = path.join(cache, "previous-fixture.bin");
        fs.writeFileSync(staged, bytes);
        fs.writeFileSync(backup, original);
        plan = {
          target,
          staged,
          backup,
          old_sha256: createHash("sha256").update(original).digest("hex"),
          new_sha256: hash,
        };
      }
      fs.writeFileSync(
        path.join(cache, "pending.json"),
        JSON.stringify({
          target,
          sha256: mode === "bad-digest" ? "0".repeat(64) : hash,
          ...(plan ? { plan } : {}),
        }),
      );
      if (mode === "bad-digest") {
        assert.throws(() =>
          execFileSync(
            payload,
            ["--finish-portable-update", target, "--no-restart"],
            { timeout: 90000, windowsHide: true, stdio: "pipe" },
          ),
        );
        assert.deepEqual(fs.readFileSync(target), original);
        assert.ok(fs.existsSync(path.join(cache, "last-error.json")));
      } else {
        execFileSync(
          payload,
          ["--finish-portable-update", target, "--no-restart"],
          { timeout: 90000, windowsHide: true, stdio: "pipe" },
        );
        assert.deepEqual(fs.readFileSync(target), bytes);
        assert.deepEqual(
          fs.readFileSync(path.join(cache, "previous.bin")),
          original,
        );
        assert.equal(
          fs.existsSync(path.join(directory, "portable")),
          mode === "portable",
        );
        assert.equal(
          fs.readdirSync(directory).filter((n) => n.endsWith(".exe")).length,
          1,
        );
        assert.equal(
          fs
            .readdirSync(directory)
            .some((n) => n.startsWith(".zhinexus-update-")),
          false,
        );
      }
      assert.equal(
        fs.readFileSync(database, "utf8"),
        "existing knowledge must remain",
      );
    }
    console.log(
      "PASS: actual Windows single-exe helper replaces both storage modes, preserves data/marker, and rejects corrupt handoffs without changing the original executable",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Use the ordinary About controls so both native IPC and real private manifest download are exercised. */
export async function testNativeUpdates({ click, script, waitFor }) {
  await click('[data-settings-tab="about"]');
  await click(".settings-content .actions button");
  const result = await waitFor(
    () =>
      script(
        'const error=document.querySelector(".settings-content>[role=alert]")?.innerText;const heading=document.querySelector(".settings-content>section>h3")?.innerText;return error?{error}:heading?{heading}:false;',
      ),
    90000,
  );
  assert.ok(!result.error, result.error);
  assert.match(
    result.heading,
    /^(?:\d+\.\d+\.\d+\s*→\s*|版本说明\s+|Release notes\s+)\d+\.\d+\.\d+$/,
  );
  console.log(
    "PASS: native updater reads the published GitHub Release and downloads latest.json anonymously through validated public Release URLs",
  );
}
