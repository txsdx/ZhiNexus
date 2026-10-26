/** Stage verified build artifacts as a draft, then publish only after all uploads succeed; published versions are immutable. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { releaseVersion } from "./versions.mjs";
/** Produce reviewable CLI argument arrays without shell interpolation or writing to an existing public version. */
export function publicationPlan({ tag, sha, draft, existing, artifacts }) {
  if (existing && !existing.draft)
    throw Error(
      "This version is already published. Bump the version before creating another release.",
    );
  if (
    !artifacts.length ||
    !artifacts.some((file) => path.basename(file) === "latest.json")
  )
    throw Error("Release artifacts and latest.json are required");
  const commands = [];
  if (!existing)
    commands.push([
      "release",
      "create",
      tag,
      "--draft",
      "--target",
      sha,
      "--title",
      `知枢 ZhiNexus ${tag}`,
      "--notes-file",
      ".ai/CHANGELOG.md",
    ]);
  commands.push(["release", "upload", tag, ...artifacts, "--clobber"]);
  if (!draft) commands.push(["release", "edit", tag, "--draft=false"]);
  return commands;
}
/** Resolve an existing tag through the authenticated GitHub CLI; permission/network failures are never treated as absence. */
function existingRelease(repository, tag) {
  try {
    return JSON.parse(
      execFileSync("gh", ["api", `repos/${repository}/releases/tags/${tag}`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (error) {
    if (String(error.stderr).includes("HTTP 404")) return null;
    throw Error(
      "Unable to inspect Release; check the job's repository permissions and network",
    );
  }
}
/** Publish only the complete all-platform workflow output using its automatically supplied GITHUB_TOKEN. */
export function run() {
  const versions = JSON.parse(fs.readFileSync("versions.json", "utf8")),
    tag = `v${releaseVersion(versions)}`,
    directory = process.argv[2] ?? "release-artifacts";
  const artifacts = fs
    .readdirSync(directory)
    .filter(
      (file) => /\.(exe|deb|apk|sig)$/.test(file) || file === "latest.json",
    )
    .sort()
    .map((file) => path.join(directory, file));
  const commands = publicationPlan({
    tag,
    sha: process.env.GITHUB_SHA,
    draft: process.env.RELEASE_DRAFT === "true",
    existing: existingRelease(process.env.GITHUB_REPOSITORY, tag),
    artifacts,
  });
  for (const args of commands) execFileSync("gh", args, { stdio: "inherit" });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run();
