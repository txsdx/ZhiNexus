/** Build the shared latest.json manifest with independent platform versions, SHA-256 assets and per-platform notes. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { releaseVersion } from "./versions.mjs";
/** Classify only the output formats supported by this project; ignore intermediate build files. */
export function artifactIdentity(name) {
  if (name.endsWith("_protable.exe"))
    return {
      platform: "windows-x86_64",
      kind: "portable",
      versionKey: "windows",
    };
  if (name.endsWith("_setup.exe"))
    return { platform: "windows-x86_64", kind: "setup", versionKey: "windows" };
  if (name.endsWith(".apk") && !name.includes("unsigned"))
    return { platform: "android-arm64", kind: "apk", versionKey: "android" };
  if (name.endsWith(".deb"))
    return { platform: "linux-x86_64", kind: "deb", versionKey: "ubuntu" };
  return null;
}
/** Preserve unbuilt platforms only within the same common release line, preventing spurious cross-platform updates. */
export function createManifest(
  files,
  {
    versions,
    tag = `v${releaseVersion(versions)}`,
    notes = "",
    previous = null,
    repository = "txsdx/ZhiNexus",
  },
) {
  const platforms = {};
  if (previous?.schema === 2)
    for (const [key, value] of Object.entries(previous.platforms ?? {}))
      if (value.version?.startsWith(versions.shared + "."))
        platforms[key] = value;
  for (const file of files) {
    const name = path.basename(file),
      identity = artifactIdentity(name);
    if (!identity) continue;
    const { platform, kind, versionKey } = identity,
      version = versions.platforms[versionKey];
    if (!platforms[platform] || platforms[platform].version !== version)
      platforms[platform] = { version, notes, artifacts: {} };
    const data = fs.readFileSync(file),
      artifact = {
        url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
        sha256: crypto.createHash("sha256").update(data).digest("hex"),
      };
    if (fs.existsSync(file + ".sig"))
      artifact.signature = fs.readFileSync(file + ".sig", "utf8").trim();
    platforms[platform].artifacts[kind] = artifact;
  }
  if (!Object.keys(platforms).length)
    throw Error("No supported release artifacts");
  return {
    schema: 2,
    commonVersion: versions.shared,
    publishedAt: new Date().toISOString(),
    platforms,
  };
}
/** Walk only regular files and generate the one manifest read by every supported platform. */
export function run(root) {
  const files = [];
  const visit = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isSymbolicLink()) continue;
      const p = path.join(dir, f.name);
      if (f.isDirectory()) visit(p);
      else files.push(p);
    }
  };
  visit(root);
  const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
  let previous = null;
  if (fs.existsSync("previous-latest.json"))
    try {
      previous = JSON.parse(fs.readFileSync("previous-latest.json", "utf8"));
    } catch {}
  const result = createManifest(files, {
    versions,
    tag: process.env.RELEASE_TAG || `v${releaseVersion(versions)}`,
    notes: fs.readFileSync(".ai/CHANGELOG.md", "utf8"),
    previous,
  });
  fs.writeFileSync(
    path.join(root, "latest.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    "Update metadata: " +
      Object.entries(result.platforms)
        .map(([p, v]) => p + " " + v.version)
        .join(", "),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run(process.argv[2] ?? "release-artifacts");
