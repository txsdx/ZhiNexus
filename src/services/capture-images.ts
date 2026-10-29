/** Image validation and Markdown image references for resumable capture drafts. */
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

/** Confirm supported image bytes before trusting clipboard, file or RPC MIME declarations. */
export function captureImageMime(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    throw Error("图片上限20 MiB / Images must be at most 20 MiB");
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  const prefix = new TextDecoder("ascii").decode(bytes.slice(0, 12));
  if (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a"))
    return "image/gif";
  if (prefix.startsWith("RIFF") && prefix.slice(8) === "WEBP")
    return "image/webp";
  throw Error("支持PNG、JPEG、WebP、GIF图片 / Unsupported or invalid image");
}
/** Find actual Markdown image nodes, excluding code examples and unrelated asset-looking text. */
export function captureImageReferences(content: string) {
  const tree = fromMarkdown(content),
    definitions = new Map<string, string>();
  const walk = (node: Nodes, visit: (node: Nodes) => void) => {
    visit(node);
    if ("children" in node)
      for (const child of node.children) walk(child, visit);
  };
  walk(tree, (node) => {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
  });
  const references: { hash: string; start: number; end: number }[] = [];
  walk(tree, (node) => {
    const url =
      node.type === "image"
        ? node.url
        : node.type === "imageReference"
          ? definitions.get(node.identifier)
          : "";
    if (typeof url !== "string" || !/^asset:[a-f0-9]{64}$/.test(url)) return;
    if (
      node.position?.start.offset !== undefined &&
      node.position?.end.offset !== undefined
    )
      references.push({
        hash: url.slice(6),
        start: node.position.start.offset,
        end: node.position.end.offset,
      });
  });
  return references;
}
/** Send only a small static preview to the editor; original attachment bytes remain unchanged. */
export async function captureImagePreview(bytes: Uint8Array, mime: string) {
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(
      1,
      240 / image.naturalWidth,
      160 / image.naturalHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("无法生成图片预览 / Image preview unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
/** Read an explicitly requested clipboard image; native desktops use the OS clipboard without exposing filesystem paths. */
export async function captureClipboardImages(): Promise<File[]> {
  const { native } = await import("../core/database");
  if (native && !/Android/i.test(navigator.userAgent)) {
    const { readImage } = await import("@tauri-apps/plugin-clipboard-manager");
    const image = await readImage();
    try {
      const { width, height } = await image.size();
      if (!width || !height || width * height > 40_000_000)
        throw Error(
          "剪贴板图片过大或为空 / Clipboard image is empty or too large",
        );
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw Error("无法读取图片 / Image clipboard unavailable");
      context.putImageData(
        new ImageData(new Uint8ClampedArray(await image.rgba()), width, height),
        0,
        0,
      );
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(Error("Image encoding failed")),
          "image/png",
        ),
      );
      return [new File([blob], "剪贴板图片.png", { type: "image/png" })];
    } finally {
      await image.close();
    }
  }
  if (!navigator.clipboard?.read)
    throw Error(
      "系统未提供图片剪贴板，请使用粘贴快捷键或添加文件 / Use the paste shortcut or add an image file",
    );
  const files: File[] = [];
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((type) =>
      ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type),
    );
    if (type)
      files.push(
        new File(
          [await item.getType(type)],
          "clipboard." + type.split("/")[1],
          { type },
        ),
      );
  }
  if (!files.length)
    throw Error("剪贴板中没有支持的图片 / No supported image in the clipboard");
  return files;
}
/** Remove only image syntax for one preview, retaining surrounding text and every other attachment. */
export function removeCaptureImage(content: string, hash: string) {
  for (const ref of captureImageReferences(content)
    .filter((r) => r.hash === hash)
    .sort((a, b) => b.start - a.start))
    content = content.slice(0, ref.start) + content.slice(ref.end);
  return content;
}
