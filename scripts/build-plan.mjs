/** Resolve exactly the supported targets, their package formats and independent version keys. */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
/** Default to Windows only; Android and Ubuntu require explicit selection and macOS is excluded. */
export function buildPlan({
  windows = true,
  android = false,
  ubuntu = false,
} = {}) {
  const include = [];
  if (windows)
    include.push({
      os: "windows-latest",
      target: "windows-x64",
      version_key: "windows",
      bundles: "nsis",
    });
  if (ubuntu)
    include.push({
      os: "ubuntu-24.04",
      target: "ubuntu-24.04-x64",
      version_key: "ubuntu",
      bundles: "deb",
    });
  if (!include.length && !android)
    throw Error("Choose at least one build target");
  return { matrix: { include }, has_desktop: include.length > 0, android };
}
/** Write only public plan metadata to GitHub outputs. */
export function run() {
  const p = buildPlan({
    windows: process.env.BUILD_WINDOWS !== "false",
    android: process.env.BUILD_ANDROID === "true",
    ubuntu: process.env.BUILD_UBUNTU === "true",
  });
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `matrix=${JSON.stringify(p.matrix)}\nhas_desktop=${p.has_desktop}\nandroid=${p.android}\n`,
    );
  console.log(JSON.stringify(p));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run();
