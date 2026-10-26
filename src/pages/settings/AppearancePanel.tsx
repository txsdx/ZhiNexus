/** Appearance configuration panel with explicit persistence and verification. */
import { Check } from "lucide-react";
import { useSettings } from "./context";
/** AppearancePanel exposes one focused settings workflow. */
export function AppearancePanel() {
  const { t, appearance, updateAppearance } = useSettings();
  return (
    <>
      <h2>{t("一个舒适的思考空间", "A comfortable space to think")}</h2>
      <label>
        {t("主题模式", "Theme")}
        <div className="theme-options">
          {[
            ["light", "日间", "Day"],
            ["dark", "夜间", "Night"],
            ["sepia", "护眼", "Warm"],
          ].map(([id, zh, en]) => (
            <button
              className={
                "theme-preview " +
                id +
                " " +
                ((appearance.theme ?? "light") === id ? "chosen" : "")
              }
              key={id}
              onClick={() => updateAppearance("theme", id)}
            >
              <div>
                <i />
                <i />
                <i />
              </div>
              {t(zh, en)}
              {appearance.theme === id && <Check size={14} />}
            </button>
          ))}
        </div>
      </label>
      <label>
        {t("主题色", "Accent color")}
        <div className="swatches">
          {["#7562d9", "#3c8d84", "#4f7bcb", "#bd7752", "#be6387"].map(
            (color) => (
              <button
                key={color}
                aria-label={color}
                style={{ background: color }}
                className={appearance.accent === color ? "chosen" : ""}
                onClick={() => updateAppearance("accent", color)}
              />
            ),
          )}
        </div>
      </label>
      <div className="form-grid">
        <label>
          {t("语言", "Language")}
          <select
            value={String(appearance.language ?? "auto")}
            onChange={(e) => updateAppearance("language", e.target.value)}
          >
            <option value="auto">{t("跟随系统", "System")}</option>
            <option value="zh">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          {t("全局字体", "Interface font")}
          <select
            value={String(appearance.font ?? "sans")}
            onChange={(e) => updateAppearance("font", e.target.value)}
          >
            <option value="sans">Noto Sans SC · 思源黑体</option>
            <option value="serif">Noto Serif SC · 思源宋体</option>
            <option value="system">{t("系统字体", "System font")}</option>
          </select>
        </label>
        <label>
          {t("桌面布局", "Desktop layout")}
          <select
            value={String(appearance.layout ?? "comfortable")}
            onChange={(e) => updateAppearance("layout", e.target.value)}
          >
            <option value="comfortable">
              {t("舒展 · 完整侧栏", "Comfortable · sidebar")}
            </option>
            <option value="compact">
              {t("紧凑 · 精简导航", "Compact · icon rail")}
            </option>
          </select>
        </label>
        <label>
          {t("手机布局", "Mobile layout")}
          <select
            value={String(appearance.mobileLayout ?? "bottom")}
            onChange={(e) => updateAppearance("mobileLayout", e.target.value)}
          >
            <option value="bottom">{t("底部导航", "Bottom navigation")}</option>
            <option value="top">{t("顶部导航", "Top navigation")}</option>
          </select>
        </label>
      </div>
      <label>
        {t("字体大小系数", "Text scale")} ·{" "}
        {Number(appearance.scale ?? 1).toFixed(2)}×
        <input
          type="range"
          min="0.85"
          max="1.3"
          step="0.05"
          value={Number(appearance.scale ?? 1)}
          onChange={(e) => updateAppearance("scale", Number(e.target.value))}
        />
      </label>
      <div className="notice">
        {t(
          "外观自动保存并随知识库同步；字体随安装包离线可用。",
          "Appearance is saved and synced automatically. Bundled fonts work offline.",
        )}
      </div>
    </>
  );
}
