/** Import the maintainer's private signing bundle through stdin; no secret enters command arguments, logs or source control. */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
/** Require all four values together and reject malformed bundles before changing repository secrets. */
export function androidSigningValues(value) {
  const names = [
    "ANDROID_KEYSTORE_BASE64",
    "ANDROID_KEY_ALIAS",
    "ANDROID_KEYSTORE_PASSWORD",
    "ANDROID_KEY_PASSWORD",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    names.some((name) => typeof value[name] !== "string" || !value[name].trim())
  )
    throw Error(
      "All four Android signing values are required; values were not printed",
    );
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.ANDROID_KEYSTORE_BASE64) ||
    Buffer.from(value.ANDROID_KEYSTORE_BASE64, "base64").length < 1000
  )
    throw Error("Invalid encoded keystore");
  return names.map((name) => [name, value[name]]);
}
/** The authenticated maintainer account must have repository Actions Secrets write permission. */
export function configureAndroidSigning(
  file,
  repository = "txsdx/ZhiNexus",
  run = spawnSync,
) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error("Invalid repository");
  let bundle;
  try {
    bundle = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw Error(
      "Unable to read the signing bundle. Check its path and JSON format; secret values were not printed.",
    );
  }
  const values = androidSigningValues(bundle);
  for (const [name, value] of values) {
    const result = run("gh", ["secret", "set", name, "--repo", repository], {
      input: value,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0)
      throw Error(
        `Could not configure ${name}: the signed-in GitHub account needs Actions Secrets write permission. Secret values were not printed.`,
      );
    console.log("Configured " + name);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (!process.argv[2])
      throw Error(
        "Usage: node scripts/setup-android-signing.mjs /private/path/signing-secrets.json [owner/repository]",
      );
    configureAndroidSigning(process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
