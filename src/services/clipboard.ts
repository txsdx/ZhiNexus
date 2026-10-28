/** Clipboard access only in response to explicit user actions, including native WebViews. */
import { native } from "../core/database";
/** Copy plain text without requesting clipboard read permission. */
export async function copyText(text: string) {
  if (native && !/Android/i.test(navigator.userAgent))
    await (
      await import("@tauri-apps/plugin-clipboard-manager")
    ).writeText(text);
  else await navigator.clipboard.writeText(text);
}
/** Paste through the platform API after the user chooses Paste. */
export async function pasteText() {
  return native && !/Android/i.test(navigator.userAgent)
    ? await (await import("@tauri-apps/plugin-clipboard-manager")).readText()
    : await navigator.clipboard.readText();
}
