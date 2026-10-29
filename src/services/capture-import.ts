/** Convert explicitly supplied images, Markdown, text and DOCX into bounded editable Markdown without loading remote resources. */
import { unzipSync, zipSync } from "fflate";
import type { CaptureClient } from "../core/capture-draft";
import { base64 } from "../core/crypto";
import { captureImageMime } from "./capture-images";
/** An imported file supplies editable content, a filename suggestion and real converter warnings. */
export interface CaptureImport {
  markdown: string;
  title: string;
  warnings: string[];
}
/** Explicit file import passes image bytes to the local draft staging area, never an external service. */
export async function stageCaptureImage(
  client: CaptureClient,
  draftId: string,
  bytes: Uint8Array,
) {
  const mime = captureImageMime(bytes);
  return client.request<string>({
    type: "stage-image",
    draftId,
    mime: mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
    data: base64(bytes),
  });
}
/** Validate archive expansion before handing a fresh bounded ZIP to the document converter. */
export function boundedDocx(bytes: Uint8Array) {
  let total = 0,
    count = 0;
  const seen = new Set<string>();
  const files = unzipSync(bytes, {
    filter(file) {
      if (
        ++count > 2000 ||
        file.originalSize < 0 ||
        (total += file.originalSize) > 64 * 1024 * 1024
      )
        throw Error(
          "DOCX解压内容超过64 MiB或2000文件 / DOCX expansion limit exceeded",
        );
      if (
        seen.has(file.name) ||
        file.name.includes("\\") ||
        file.name.startsWith("/") ||
        file.name.split("/").includes("..")
      )
        throw Error("DOCX文件路径无效 / Invalid DOCX archive path");
      seen.add(file.name);
      return true;
    },
  });
  if (!files["[Content_Types].xml"] || !files["word/document.xml"])
    throw Error("不是有效的DOCX文档 / Invalid DOCX document");
  if (
    Object.values(files).reduce((sum, b) => sum + b.length, 0) >
    64 * 1024 * 1024
  )
    throw Error("DOCX内容过大 / DOCX is too large");
  return zipSync(files, { level: 0 });
}
/** Preserve standard text encodings without interpreting Markdown or imported text as commands. */
function decodeText(bytes: Uint8Array) {
  if (bytes[0] === 255 && bytes[1] === 254)
    return new TextDecoder("utf-16le", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
  if (bytes[0] === 254 && bytes[1] === 255)
    return new TextDecoder("utf-16be", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
  return new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, "");
}
/** Convert a file completely before inserting it; a failed conversion never replaces existing editor text. */
export async function importCaptureFile(
  file: File,
  client: CaptureClient,
  draftId: string,
): Promise<CaptureImport> {
  if (!file.size || file.size > 20 * 1024 * 1024)
    throw Error(
      "文件上限20 MiB，空文件不能导入 / Files must contain data and be at most 20 MiB",
    );
  const title = file.name.replace(/\.[^.]+$/, "").slice(0, 300),
    bytes = new Uint8Array(await file.arrayBuffer());
  if (
    file.type.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp)$/i.test(file.name)
  ) {
    const hash = await stageCaptureImage(client, draftId, bytes);
    return {
      markdown: `![${title.replace(/[\[\]\\\n\r]/g, " ")}](asset:${hash})`,
      title,
      warnings: [],
    };
  }
  if (/\.(md|markdown|txt)$/i.test(file.name)) {
    if (file.size > 8 * 1024 * 1024)
      throw Error("文本文件上限8 MiB / Text files must be at most 8 MiB");
    return { markdown: decodeText(bytes), title, warnings: [] };
  }
  if (!/\.docx$/i.test(file.name))
    throw Error(
      "支持图片、Markdown、TXT及DOCX / Supported files: images, Markdown, TXT and DOCX",
    );
  const document = boundedDocx(bytes);
  const [{ default: mammoth }, { default: Turndown }] = await Promise.all([
    import("mammoth"),
    import("turndown"),
  ]);
  let imageTail: Promise<unknown> = Promise.resolve();
  const converted = await mammoth.convertToHtml(
    { arrayBuffer: document.buffer as ArrayBuffer },
    {
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement((image) => {
        const task = imageTail.then(async () => {
          const data = new Uint8Array(await image.readAsArrayBuffer());
          const hash = await stageCaptureImage(client, draftId, data);
          return { src: `asset:${hash}` };
        });
        imageTail = task.catch(() => {});
        return task;
      }),
    },
  );
  const errors = converted.messages.filter(
    (message) => message.type === "error",
  );
  if (errors.length)
    throw Error(
      "DOCX转换未完成，原输入已保留 / DOCX conversion incomplete: " +
        errors.map((message) => message.message).join("; "),
    );
  // Parse in an inert document. No imported HTML is mounted into the application.
  const html = new DOMParser().parseFromString(converted.value, "text/html");
  html
    .querySelectorAll("script,style,iframe,object,embed")
    .forEach((n) => n.remove());
  const markdown = new Turndown({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  markdown.addRule("safe-links", {
    filter: "a",
    replacement(content, node) {
      const href = (node as HTMLElement).getAttribute("href") ?? "";
      if (!/^(https?:\/\/|mailto:|#)/i.test(href)) return content;
      return `[${content}](<${href.replace(/[<>\n\r]/g, "")}>)`;
    },
  });
  markdown.addRule("simple-tables", {
    filter: "table",
    replacement(_content, node) {
      const rows = [...(node as HTMLTableElement).rows].map((row) =>
        [...row.cells].map((cell) =>
          markdown
            .turndown(cell)
            .trim()
            .replace(/\r?\n+/g, " / ")
            .replace(/\|/g, "\\|"),
        ),
      );
      if (!rows.length) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const line = (row: string[]) =>
        "| " +
        Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ") +
        " |";
      return (
        "\n\n" +
        [
          line(rows[0]),
          line(Array(width).fill("---")),
          ...rows.slice(1).map(line),
        ].join("\n") +
        "\n\n"
      );
    },
  });
  const result = markdown.turndown(html.body).trim();
  if (!result)
    throw Error("DOCX中没有可导入的内容 / DOCX contains no importable content");
  if (result.length > 8 * 1024 * 1024)
    throw Error("转换后的Markdown超过8 MiB / Converted Markdown is too large");
  return {
    markdown: result,
    title,
    warnings: converted.messages.map((m) => m.message),
  };
}
/** Retain the insertion point only while its original text is unchanged; otherwise append to the latest input. */
export function insertCaptureMaterial(
  latest: string,
  original: string,
  start: number,
  end: number,
  material: string,
) {
  if (latest === original)
    return (
      latest.slice(0, start) +
      (start && latest[start - 1] !== "\n" ? "\n\n" : "") +
      material +
      (end < latest.length && latest[end] !== "\n" ? "\n\n" : "") +
      latest.slice(end)
    );
  return latest + (latest && !latest.endsWith("\n\n") ? "\n\n" : "") + material;
}
