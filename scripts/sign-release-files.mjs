/** Optionally sign the exact published files using CLI environment bindings, never command-line private-key values. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  console.log(
    "No publisher key: SHA-256/HTTPS update verification remains enabled.",
  );
  process.exit(0);
}
const root = process.argv[2],
  version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
/** Sign only final platform artifacts; installers and their portable counterpart share the app version. */
function visit(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) visit(p);
    else if (/\.(exe|deb|apk)$/.test(e.name)) {
      const result = spawnSync(
        process.platform === "win32" ? "npx.cmd" : "npx",
        ["tauri", "signer", "sign", "--app-version", version, p],
        { stdio: "inherit", shell: process.platform === "win32" },
      );
      if (result.status !== 0) throw Error("Artifact signing failed");
    }
  }
}
visit(root);
