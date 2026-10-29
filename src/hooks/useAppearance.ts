/** Apply shared presentation preferences to either the full workspace or the small capture-only webview. */
import { useEffect } from "react";
import type { Json } from "../core/types";
/** Return the chosen locale and keep theme/font/scale consistent without initializing another repository. */
export function useAppearance(appearance: Record<string, Json>) {
  const language = String(appearance.language ?? "auto");
  const locale: "zh" | "en" =
    language === "auto"
      ? navigator.language.toLowerCase().startsWith("zh")
        ? "zh"
        : "en"
      : language === "en"
        ? "en"
        : "zh";
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    for (const [key, value] of Object.entries({
      theme: appearance.theme ?? "light",
      layout: appearance.layout ?? "comfortable",
      mobile: appearance.mobileLayout ?? "bottom",
      font: appearance.font ?? "sans",
    }))
      document.documentElement.dataset[key] = String(value);
    document.documentElement.style.setProperty(
      "--accent",
      String(appearance.accent ?? "#7562d9"),
    );
    document.documentElement.style.setProperty(
      "--scale",
      String(appearance.scale ?? 1),
    );
  }, [appearance, locale]);
  return locale;
}
