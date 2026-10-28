/** Wire compression, truncation and inflated-size protections. */
import { expect, it } from "vitest";
import { gzipText, gunzipText } from "./compression";
it("actually compresses repeated operation content and restores exact multibyte text", async () => {
  const text = JSON.stringify({ text: "安全约束与完整同步。".repeat(20000) });
  const packed = await gzipText(text, 1024 * 1024);
  expect(packed.byteLength).toBeLessThan(
    new TextEncoder().encode(text).byteLength / 10,
  );
  expect(await gunzipText(packed, 1024 * 1024)).toBe(text);
});
it("rejects truncated gzip and bounded decompression bombs", async () => {
  const packed = await gzipText("a".repeat(100000), 200000);
  await expect(
    gunzipText(packed.slice(0, packed.length - 5), 200000),
  ).rejects.toThrow();
  await expect(gunzipText(packed, 1000)).rejects.toThrow("大小限制");
  await expect(gzipText("汉".repeat(1000), 2000)).rejects.toThrow("大小限制");
});
