/** Update prompts are platform-local and download sources must remain in the project Release namespace. */
import { describe, it, expect } from "vitest";
import { isNewer, selectUpdate, validateReleaseAsset } from "./updates";
const artifact = {
  url: "https://github.com/txsdx/ZhiNexus/releases/download/v0.2.3/app.apk",
  sha256: "a".repeat(64),
};
const manifest = {
  schema: 2,
  commonVersion: "0.2",
  publishedAt: "2026-10-26T00:00:00.000Z",
  platforms: {
    "android-arm64": {
      version: "0.2.0",
      notes: "unchanged",
      artifacts: { apk: artifact },
    },
    "windows-x86_64": {
      version: "0.2.3",
      notes: "Windows fixes",
      artifacts: {
        setup: {
          ...artifact,
          url: artifact.url.replace("app.apk", "app_setup.exe"),
        },
        portable: {
          ...artifact,
          url: artifact.url.replace("app.apk", "app_protable.exe"),
        },
      },
    },
  },
};
describe("platform update selection", () => {
  it("does not update Android because only Windows received a patch", () =>
    expect(
      selectUpdate(manifest, {
        platform: "android-arm64",
        version: "0.2.0",
        portable: false,
      })?.available,
    ).toBe(false));
  it.each([false, true])(
    "selects the single executable with portable storage=%s",
    (portable) => {
      const info = selectUpdate(manifest, {
        platform: "windows-x86_64",
        version: "0.2.1",
        portable,
      });
      expect(info).toMatchObject({
        available: true,
        kind: "portable",
        version: "0.2.3",
        notes: "Windows fixes",
      });
      expect(info?.url).toContain("_protable.exe");
    },
  );
  it("never falls back to an installer when the single-file artifact is missing", () => {
    const onlyInstaller = structuredClone(manifest);
    delete (
      onlyInstaller.platforms["windows-x86_64"].artifacts as {
        portable?: unknown;
      }
    ).portable;
    expect(
      selectUpdate(onlyInstaller, {
        platform: "windows-x86_64",
        version: "0.2.1",
        portable: false,
      }),
    ).toBeNull();
  });
  it("compares numeric patch versions and rejects unsafe URLs or inconsistent lines", () => {
    expect(isNewer("0.2.10", "0.2.9")).toBe(true);
    expect(() =>
      validateReleaseAsset("https://attacker.example/app.exe"),
    ).toThrow();
    expect(() =>
      selectUpdate(
        { ...manifest, commonVersion: "0.3" },
        { platform: "android-arm64", version: "0.2.0", portable: false },
      ),
    ).toThrow();
  });
});
