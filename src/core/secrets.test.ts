/** Encrypted API-key persistence contracts: portable defaults, custom isolation, randomized IVs and integrity rejection. */
import { describe, expect, it } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  encodeDevice,
  decodeDevice,
} from "./secrets";
import { defaultDevice } from "./defaults";
describe("API credential wrapping", () => {
  it("opens default encrypted records across devices without a password and uses fresh IVs", async () => {
    const first = await encryptSecret(
        { apiKey: "fixture-key" },
        "sync-api-key",
      ),
      second = await encryptSecret({ apiKey: "fixture-key" }, "sync-api-key");
    expect(first).not.toContain("fixture-key");
    expect(first).not.toBe(second);
    expect(await decryptSecret(first, "sync-api-key")).toEqual({
      apiKey: "fixture-key",
    });
  });
  it("authenticates a custom key and isolates local from sync ciphertext", async () => {
    const cipher = await encryptSecret(
      { apiKey: "fixture-key" },
      "sync-api-key",
      "my-private-key",
    );
    await expect(decryptSecret(cipher, "sync-api-key")).rejects.toThrow();
    await expect(
      decryptSecret(cipher, "local-device", "my-private-key"),
    ).rejects.toThrow();
    expect(
      await decryptSecret(cipher, "sync-api-key", "my-private-key"),
    ).toEqual({ apiKey: "fixture-key" });
    const envelope = JSON.parse(cipher);
    envelope.data = "AAAA";
    await expect(
      decryptSecret(JSON.stringify(envelope), "sync-api-key", "my-private-key"),
    ).rejects.toThrow();
  });
  it("wraps both local API and custom keys before SQLite/journal persistence", async () => {
    const device = {
        ...defaultDevice,
        apiKey: "local-api-key",
        apiKeySyncKey: "local-custom-key",
      },
      encoded = await encodeDevice(device);
    expect(JSON.stringify(encoded)).not.toContain("local-api-key");
    expect(JSON.stringify(encoded)).not.toContain("local-custom-key");
    expect(await decodeDevice(encoded)).toEqual(device);
    expect(await decodeDevice(await encodeDevice(encoded))).toEqual(device);
  });
});
