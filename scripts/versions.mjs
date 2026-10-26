/** Single source of release and platform versions; shared changes bump all platforms, isolated changes bump one patch. */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
/** Validate and compare numeric semantic versions without lexical ordering errors. */
export function compareVersions(a, b) {
  const parts = (v) => {
    if (!/^\d+\.\d+\.\d+$/.test(v)) throw Error("Expected major.minor.patch");
    return v.split(".").map(Number);
  };
  const aa = parts(a),
    bb = parts(b);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return 0;
}
/** Bump the common release line or one platform while preserving all other platform versions. */
export function bumpVersions(input, target) {
  const v = structuredClone(input);
  if (target === "shared" || target === "major") {
    const [major, minor] = v.shared.split(".").map(Number);
    v.shared = target === "major" ? `${major + 1}.0` : `${major}.${minor + 1}`;
    for (const p of Object.keys(v.platforms)) v.platforms[p] = v.shared + ".0";
  } else {
    if (!(target in v.platforms))
      throw Error("Target must be shared, major, windows, android or ubuntu");
    const parts = v.platforms[target].split(".").map(Number);
    parts[2]++;
    v.platforms[target] = parts.join(".");
  }
  return v;
}
/** Use the highest platform patch as the repository Release tag; app builds retain their own platform version. */
export function releaseVersion(v) {
  for (const version of Object.values(v.platforms))
    if (!version.startsWith(v.shared + "."))
      throw Error("Platform versions must share major.minor");
  return Object.values(v.platforms).sort(compareVersions).at(-1);
}
/** Synchronize build inputs without introducing a database compatibility layer or touching user data. */
export function writeBuildVersion(version) {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.version = version;
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  lock.version = version;
  lock.packages[""].version = version;
  fs.writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
  for (const file of ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
    let text = fs.readFileSync(file, "utf8");
    if (file.endsWith("Cargo.toml"))
      text = text.replace(
        /(\[package\][\s\S]*?\nversion = ")[^"]+/,
        `$1${version}`,
      );
    else
      text = text.replace(
        /(\[\[package\]\]\nname = "zhinexus"\nversion = ")[^"]+/,
        `$1${version}`,
      );
    fs.writeFileSync(file, text);
  }
  const config = JSON.parse(
    fs.readFileSync("src-tauri/tauri.conf.json", "utf8"),
  );
  config.version = version;
  fs.writeFileSync(
    "src-tauri/tauri.conf.json",
    JSON.stringify(config, null, 2) + "\n",
  );
}
/** Apply a platform override only inside its CI checkout; committed source keeps the repository version. */
export function run() {
  const [action, target] = process.argv.slice(2);
  let v = JSON.parse(fs.readFileSync("versions.json", "utf8"));
  if (action === "bump") {
    v = bumpVersions(v, target);
    fs.writeFileSync("versions.json", JSON.stringify(v, null, 2) + "\n");
    writeBuildVersion(releaseVersion(v));
  } else if (action === "prepare") {
    if (!v.platforms[target]) throw Error("Unknown platform");
    writeBuildVersion(v.platforms[target]);
  } else if (action === "sync") writeBuildVersion(releaseVersion(v));
  else if (action === "release") console.log(releaseVersion(v));
  else
    throw Error(
      "Use bump <shared|major|platform>, prepare <platform>, sync, or release",
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run();
