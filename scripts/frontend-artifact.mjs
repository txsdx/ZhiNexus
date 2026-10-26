/** Seal shared browser assets and prevent native jobs from accidentally rebuilding or consuming a stale frontend. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const manifestName = "zhinexus-frontend.json";
/** Enumerate regular build files only; links and path traversal are never accepted. */
function files(directory) {
  const result = [];
  const visit = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw Error("Frontend artifact contains a symbolic link");
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const relative = path
          .relative(directory, full)
          .split(path.sep)
          .join("/");
        if (relative !== manifestName) result.push(relative);
      }
    }
  };
  visit(directory);
  return result.sort();
}
/** Hash exactly the bytes that each platform's Tauri binary will embed. */
function digest(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
/** Record the current commit and all built payloads after the single production frontend build. */
export function sealFrontend(directory, revision) {
  if (!/^[a-f0-9]{40,64}$/.test(revision ?? ""))
    throw Error("A source revision is required");
  const names = files(directory);
  if (!names.includes("index.html")) throw Error("Missing built index.html");
  const manifest = {
    schema: 1,
    revision,
    files: Object.fromEntries(
      names.map((name) => [name, digest(path.join(directory, name))]),
    ),
  };
  fs.writeFileSync(
    path.join(directory, manifestName),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
/** Verify source identity, file completeness and checksums before disabling Tauri's duplicate frontend build hook. */
export function useFrontend(directory, revision, configPath) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, manifestName), "utf8"),
  );
  if (manifest.schema !== 1 || manifest.revision !== revision)
    throw Error("Frontend source revision mismatch");
  const names = files(directory);
  if (
    !names.includes("index.html") ||
    JSON.stringify(names) !== JSON.stringify(Object.keys(manifest.files).sort())
  )
    throw Error("Frontend file set mismatch");
  for (const name of names)
    if (digest(path.join(directory, name)) !== manifest.files[name])
      throw Error("Frontend checksum mismatch: " + name);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.build = { ...config.build, beforeBuildCommand: null };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return names.length;
}
/** CI entry point; native builds fail closed when their shared assets do not match the checked-out commit. */
export function run() {
  if (process.argv[2] === "create")
    sealFrontend("dist", process.env.GITHUB_SHA);
  else if (process.argv[2] === "use")
    console.log(
      "Verified shared frontend files:",
      useFrontend("dist", process.env.GITHUB_SHA, "src-tauri/tauri.conf.json"),
    );
  else throw Error("Use create or use");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run();
