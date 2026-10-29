/** User-requested UTF-8 exports use system Save on native platforms and a local browser download. */
import { native } from "../core/database";
/** Export a Markdown file without uploading its private conversation content. Cancellation writes nothing. */
export async function saveMarkdown(title: string, text: string) {
  const name =
    (title
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 90) || "conversation") + ".md";
  if (native) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: name,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (path) {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, text);
    }
  } else {
    const url = URL.createObjectURL(
        new Blob([text], { type: "text/markdown;charset=utf-8" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
