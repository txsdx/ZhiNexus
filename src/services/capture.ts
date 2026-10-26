/** Explicit desktop shortcut captures selection/provenance through the native boundary before focusing the app. */
import { native } from "../core/database";
/** Register a desktop-only shortcut and return ownership-scoped cleanup. */
export async function registerCapture(
  open: (capture: { text: string; source: string }) => void,
): Promise<() => void> {
  if (!native || /Android/i.test(navigator.userAgent)) return () => {};
  const { register, unregister } =
    await import("@tauri-apps/plugin-global-shortcut");
  const shortcut = "CommandOrControl+Shift+N";
  await register(shortcut, async (event) => {
    if (event.state !== "Pressed") return;
    let captured = { text: "", source: "clipboard:unknown-process" };
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      captured = await invoke("capture_knowledge");
    } catch {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      captured.text = await readText().catch(() => "");
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    await window.show();
    await window.setFocus();
    open(captured);
  });
  return () => {
    void unregister(shortcut);
  };
}
