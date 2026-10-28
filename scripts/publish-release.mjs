/** Stage verified build artifacts as a draft, then publish only after all uploads succeed; published versions are immutable. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { releaseVersion } from "./versions.mjs";
import { artifactIdentity } from "./updater-manifest.mjs";
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
  const names = artifacts.map((file) => path.basename(file));
  if (new Set(names).size !== names.length)
    throw Error("Release artifact basenames must be unique");
  const kinds = new Set(
    artifacts
      .map((file) => artifactIdentity(path.basename(file)))
      .filter(Boolean)
      .map((item) => item.platform + "/" + item.kind),
  );
  for (const kind of [
    "windows-x86_64/portable",
    "windows-x86_64/setup",
    "android-arm64/apk",
    "linux-x86_64/deb",
  ])
    if (!kinds.has(kind)) throw Error("Missing platform artifact: " + kind);
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
/** Execute authenticated JSON queries without printing credential-bearing CLI diagnostics. */
function queryGitHub(args) {
  return JSON.parse(
    execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
}
/** Find published releases or drafts: the tag endpoint can return 404 for an existing draft. */
export function existingRelease(repository, tag, query = queryGitHub) {
  try {
    return query(["api", `repos/${repository}/releases/tags/${tag}`]);
  } catch (error) {
    if (String(error.stderr).includes("HTTP 404")) {
      try {
        for (let page = 1; ; page++) {
          const releases = query([
            "api",
            `repos/${repository}/releases?per_page=100&page=${page}`,
          ]);
          const match = releases.find((release) => release.tag_name === tag);
          if (match) return match;
          if (releases.length < 100) return null;
        }
      } catch {
        throw Error(
          "Unable to inspect draft Releases; check repository permissions and network",
        );
      }
    }
    throw Error(
      "Unable to inspect Release; check the job's repository permissions and network",
    );
  }
}
/** Collect nested upload-artifact paths, excluding links and unrelated intermediate files. */
export function releaseArtifacts(directory) {
  const files = [];
  const visit = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (
        entry.isFile() &&
        (/\.(exe|deb|apk|sig)$/.test(entry.name) ||
          entry.name === "latest.json")
      )
        files.push(file);
    }
  };
  visit(directory);
  return files.sort();
}
/** Publish only the complete all-platform workflow output using its automatically supplied GITHUB_TOKEN. */
export function run() {
  const versions = JSON.parse(fs.readFileSync("versions.json", "utf8")),
    tag = `v${releaseVersion(versions)}`,
    directory = process.argv[2] ?? "release-artifacts";
  const artifacts = releaseArtifacts(directory);
  const commands = publicationPlan({
    tag,
    sha: process.env.GITHUB_SHA,
    draft: process.env.RELEASE_DRAFT !== "false",
    existing: existingRelease(process.env.GITHUB_REPOSITORY, tag),
    artifacts,
  });
  for (const args of commands) execFileSync("gh", args, { stdio: "inherit" });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run();
