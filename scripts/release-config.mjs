/** Prepare release metadata; GitHub publication never depends on optional updater-signing credentials. */
import fs from "node:fs";
import { releaseVersion } from "./versions.mjs";
import { pathToFileURL } from "node:url";
/** Configure signed updates only when a complete signing pair exists, retaining secure defaults otherwise. */
export function prepareRelease({
  config,
  version,
  tag = "",
  publish = false,
  publicKey = "",
  hasPrivateKey = false,
}) {
  const releaseTag = tag || `v${version}`;
  if (publish && releaseTag !== `v${version}`)
    throw Error("Release tag must match the package version");
  const signing = Boolean(publicKey.trim() && hasPrivateKey);
  const next = structuredClone(config);
  next.plugins ??= {};
  next.bundle ??= {};
  next.plugins.updater = signing
    ? {
        pubkey: publicKey,
        requireSignedVersion: true,
        endpoints: [
          "https://github.com/txsdx/ZhiNexus/releases/latest/download/latest.json",
        ],
      }
    : { pubkey: "", endpoints: [] };
  // Publisher signatures are emitted for direct files, never installer-specific archives.
  next.bundle.createUpdaterArtifacts = false;
  return { config: next, tag: releaseTag, signing };
}
/** Write CI outputs without exposing private keys or requiring any manually configured GitHub token. */
export function run() {
  const path = "src-tauri/tauri.conf.json",
    pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const result = prepareRelease({
    config: JSON.parse(fs.readFileSync(path, "utf8")),
    version: fs.existsSync("versions.json")
      ? releaseVersion(JSON.parse(fs.readFileSync("versions.json", "utf8")))
      : pkg.version,
    tag: process.env.RELEASE_TAG,
    publish: process.env.PUBLISH_RELEASE === "true",
    publicKey: process.env.UPDATER_PUBLIC_KEY,
    hasPrivateKey: Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY),
  });
  // Direct release files are signed explicitly; Tauri must never create Windows installer archives.
  result.config.bundle.createUpdaterArtifacts = false;
  fs.writeFileSync(path, JSON.stringify(result.config, null, 2) + "\n");
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `tag=${result.tag}\nsigning=${result.signing}\n`,
    );
  console.log(
    result.signing
      ? "Updater signature verification configured."
      : "Release builds enabled without custom keys; signed in-app updates are disabled.",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run();
