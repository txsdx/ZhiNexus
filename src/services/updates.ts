/** Platform-aware update discovery: one Release JSON, independent patch versions and verified installation requests. */
import { z } from "zod";
import { native } from "../core/database";
import { boundedText } from "./network";
import { ensureNativeProxy } from "./proxy";
import versions from "../../versions.json";
const artifact = z.object({
  url: z.string().url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().optional(),
});
const platform = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  notes: z.string(),
  artifacts: z.partialRecord(
    z.enum(["setup", "portable", "apk", "deb"]),
    artifact,
  ),
});
export const updateManifestSchema = z.object({
  schema: z.literal(2),
  commonVersion: z.string().regex(/^\d+\.\d+$/),
  publishedAt: z.iso.datetime(),
  platforms: z.partialRecord(
    z.enum(["windows-x86_64", "android-arm64", "linux-x86_64"]),
    platform,
  ),
});
export type UpdateManifest = z.infer<typeof updateManifestSchema>;
export interface UpdateInfo {
  platform: string;
  current: string;
  version: string;
  notes: string;
  kind: "setup" | "portable" | "apk" | "deb";
  url: string;
  sha256: string;
  signature?: string;
  available: boolean;
}
/** Compare only numeric versions for the selected platform, never the shared Release tag. */
export function isNewer(candidate: string, current: string): boolean {
  const a = candidate.split(".").map(Number),
    b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}
/** Reject destinations outside this repository before downloading or attaching any application authentication. */
export function validateReleaseAsset(url: string) {
  const u = new URL(url);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "github.com" ||
    !u.pathname.startsWith("/txsdx/ZhiNexus/releases/download/") ||
    u.username ||
    u.password ||
    u.hash ||
    u.search
  )
    throw Error("非法更新下载地址 / Untrusted update asset");
  return url;
}
/** Resolve a central manifest using the running executable's own platform version and installation mode. */
export function selectUpdate(
  input: unknown,
  identity: { platform: string; version: string; portable: boolean },
): UpdateInfo | null {
  const m = updateManifestSchema.parse(input),
    entry = m.platforms[identity.platform as keyof typeof m.platforms];
  if (!entry) return null;
  if (!entry.version.startsWith(m.commonVersion + "."))
    throw Error("更新版本线不一致 / Inconsistent release line");
  const kind =
      identity.platform === "windows-x86_64"
        ? identity.portable
          ? "portable"
          : "setup"
        : identity.platform === "android-arm64"
          ? "apk"
          : "deb",
    asset = entry.artifacts[kind];
  if (!asset) return null;
  validateReleaseAsset(asset.url);
  return {
    ...asset,
    platform: identity.platform,
    current: identity.version,
    version: entry.version,
    notes: entry.notes,
    kind,
    available: isNewer(entry.version, identity.version),
  };
}
/** Native packages read private Releases with their embedded credential; browser previews retain public discovery. */
export async function checkUpdates(): Promise<UpdateInfo | null> {
  let identity = {
    platform: "windows-x86_64",
    version: versions.platforms.windows,
    portable: false,
  };
  if (native) {
    const { invoke } = await import("@tauri-apps/api/core");
    await ensureNativeProxy();
    identity = await invoke("update_identity");
    return selectUpdate(await invoke("read_update_manifest"), identity);
  }
  const url =
    "https://github.com/txsdx/ZhiNexus/releases/latest/download/latest.json";
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(60000),
  });
  const final = new URL(res.url);
  if (
    final.protocol !== "https:" ||
    ![
      "github.com",
      "release-assets.githubusercontent.com",
      "objects.githubusercontent.com",
    ].includes(final.hostname)
  )
    throw Error("Untrusted manifest redirect");
  if (res.status === 404)
    throw Error("Release 缺少 latest.json / Update manifest missing");
  if (!res.ok) throw Error(`Update manifest HTTP ${res.status}`);
  const payload = JSON.parse(await boundedText(res, 2 * 1024 * 1024));
  return selectUpdate(payload, identity);
}
/** Ask the native boundary to download, verify and launch the platform-appropriate installer. */
export async function applyUpdate(info: UpdateInfo) {
  if (!native) throw Error("请在原生应用中更新 / Native app required");
  if (!info.available) throw Error("没有更新 / Already current");
  validateReleaseAsset(info.url);
  await ensureNativeProxy();
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("install_platform_update", {
    update: {
      kind: info.kind,
      url: info.url,
      sha256: info.sha256,
      signature: info.signature ?? null,
      version: info.version,
    },
  });
}
