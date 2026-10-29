/** Imported source is bounded before conversion and insertion preserves later typing and unrelated Markdown. */
import { expect, it } from "vitest";
import { boundedDocx, insertCaptureMaterial } from "./capture-import";
import {
  captureImageReferences,
  removeCaptureImage,
  captureImageMime,
} from "./capture-images";
import { captureDocx } from "../../tests/helpers/capture-files";
it("a valid OOXML fixture is accepted and oversized ZIP metadata is rejected before expansion", () => {
  const zip = captureDocx();
  expect(boundedDocx(zip).length).toBeGreaterThan(0);
  const damaged = zip.slice(),
    view = new DataView(damaged.buffer);
  for (let i = 0; i < damaged.length - 46; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, 80 * 1024 * 1024, true);
      break;
    }
  expect(() => boundedDocx(damaged)).toThrow(/64 MiB/);
  expect(() => boundedDocx(new Uint8Array([1, 2, 3]))).toThrow();
});
it("an async insertion uses the old selection only when its source is unchanged and otherwise appends to the newest text", () => {
  expect(insertCaptureMaterial("abcd", "abcd", 1, 3, "image")).toBe(
    "a\n\nimage\n\nd",
  );
  expect(insertCaptureMaterial("new typing", "abcd", 1, 3, "image")).toBe(
    "new typing\n\nimage",
  );
});
it("only actual Markdown images count as staged media; code examples and other images survive removal", () => {
  const a = "a".repeat(64),
    b = "b".repeat(64),
    content = `literal asset:${a}\n\n\`![example](asset:${a})\`\n\n![real](asset:${a})\n\n![other][photo]\n\n[photo]: asset:${b}`;
  expect(captureImageReferences(content).map((r) => r.hash)).toEqual([a, b]);
  const removed = removeCaptureImage(content, a);
  expect(removed).toContain("`![example]");
  expect(removed).toContain("![other][photo]");
  expect(removed).not.toContain("![real]");
  expect(() => captureImageMime(new Uint8Array([1, 2, 3]))).toThrow();
});
