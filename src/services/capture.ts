/** Desktop shortcut captures the clipboard on explicit user action; no synthetic keys or process surveillance. */
import { native } from "../core/database";
/** Register a desktop-only shortcut and return ownership-scoped cleanup. */
export async function registerCapture(
  open: (text: string) => void,
): Promise<() => void> {
  if (!native || /Android/i.test(navigator.userAgent)) return () => {};
  const { register, unregister } =
    await import("@tauri-apps/plugin-global-shortcut");
  const shortcut = "CommandOrControl+Shift+N";
  await register(shortcut, async (event) => {
    if (event.state !== "Pressed") return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    await window.show();
    await window.setFocus();
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      open((await readText()).slice(0, 5000));
    } catch {
      open("");
    }
  });
  return () => {
    void unregister(shortcut);
  };
}
