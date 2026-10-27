/** Modular settings shell and explicit confirmation dialogs. */
import { Busy, Modal } from "../components/common";
import { decryptBackup, encryptBackup } from "../core/crypto";
import { json, store } from "../core/store";
import type { DeviceConfig } from "../core/types";
import { restoreSnapshot, snapshot } from "../services/sync";
import { DesktopPanel } from "./settings/DesktopPanel";
import { NetworkPanel } from "./settings/NetworkPanel";
import { NotificationsPanel } from "./settings/NotificationsPanel";
import { AboutPanel } from "./settings/AboutPanel";
import { AppearancePanel } from "./settings/AppearancePanel";
import { CategoriesPanel } from "./settings/CategoriesPanel";
import { SettingsContext } from "./settings/context";
import { useSettingsState } from "./settings/controller";
import { DatabasePanel } from "./settings/DatabasePanel";
import { McpPanel } from "./settings/McpPanel";
import { ModelsPanel } from "./settings/ModelsPanel";
import { PromptsPanel } from "./settings/PromptsPanel";
import { saveFile } from "./settings/shared";
import { useConfirmation } from "../hooks/useConfirmation";
import { LogsPanel } from "./settings/LogsPanel";
/** Render independent settings panels and reviewable taxonomy/backup confirmations. */
export function Settings({
  notify,
  initialTab = "appearance",
}: {
  notify: (s: string) => void;
  initialTab?: string;
}) {
  const context = useSettingsState(notify, initialTab);
  const {
    t,
    busy,
    tabs,
    tab,
    setTab,
    report,
    act,
    archive,
    setArchive,
    password,
    setPassword,
    saveState,
    flushSettings,
  } = context;
  const confirmation = useConfirmation(notify, {
    title: t("确认恢复设备设置", "Confirm device settings restore"),
    confirmLabel: t("恢复设备设置", "Restore device settings"),
  });
  return (
    <SettingsContext.Provider value={context}>
      <div
        className="page settings-page"
        onBlurCapture={() => {
          void flushSettings().catch(() => {});
        }}
      >
        <div className="page-heading">
          <div>
            <div className="eyebrow">MAKE IT YOURS</div>
            <h1>{t("设置", "Settings")}</h1>
            <p>
              {t(
                "让工具适应你的习惯，让学习回归你自己。",
                "Shape your workspace around the way you learn.",
              )}
            </p>
          </div>
          {busy && <Busy label={busy} />}
        </div>
        <div
          className="settings-save-status"
          role={saveState.status === "error" ? "alert" : "status"}
          data-save-status={saveState.status}
        >
          {saveState.status === "saved"
            ? t("所有配置已自动保存", "All settings saved automatically")
            : saveState.status === "error"
              ? t("自动保存失败：", "Autosave failed: ") + saveState.error
              : t("正在自动保存…", "Saving automatically…")}
          {saveState.status === "error" && (
            <button
              onClick={() => {
                void flushSettings().catch(() => {});
              }}
            >
              {t("重试自动保存", "Retry autosave")}
            </button>
          )}
        </div>
        <div className="settings-shell">
          <aside className="settings-tabs">
            {tabs.map((x) => (
              <button
                key={x.id}
                data-settings-tab={x.id}
                className={tab === x.id ? "active" : ""}
                onClick={() => setTab(x.id)}
              >
                <x.icon size={17} />
                {x.label}
              </button>
            ))}
          </aside>
          <div className="settings-content">
            {tab === "appearance" && <AppearancePanel />}
            {tab === "ai" && <ModelsPanel />}
            {tab === "prompts" && <PromptsPanel />}
            {tab === "categories" && <CategoriesPanel />}
            {tab === "mcp" && <McpPanel />}
            {tab === "network" && <NetworkPanel />}
            {tab === "desktop" && <DesktopPanel />}
            {tab === "notifications" && <NotificationsPanel />}
            {tab === "database" && <DatabasePanel />}
            {tab === "about" && <AboutPanel />}
            {tab === "logs" && <LogsPanel />}
            {report && <pre className="report">{report}</pre>}
          </div>
        </div>
        {archive && (
          <Modal
            title={t("备份密码", "Backup passphrase")}
            onClose={() => setArchive(null)}
          >
            <label>
              {t(
                "至少 12 位，无法找回",
                "At least 12 characters; cannot be recovered",
              )}
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={!!busy || password.length < 12}
              onClick={() =>
                void act(
                  t("加密校验中…", "Encrypting / verifying…"),
                  async () => {
                    if (archive.mode === "export")
                      await saveFile(
                        await encryptBackup(
                          json({
                            snapshot: await snapshot(),
                            device: store.getSnapshot().device,
                          }),
                          password,
                        ),
                      );
                    else {
                      const data = (await decryptBackup(
                        archive.text,
                        password,
                      )) as { snapshot: unknown; device: unknown };
                      await restoreSnapshot(data.snapshot);
                      if (
                        (await confirmation.ask(
                          t(
                            "同时恢复备份中的本机凭证和偏好？这会替换本设备设置。",
                            "Also restore backed-up credentials and device preferences? This replaces this device’s settings.",
                          ),
                        )) === true
                      ) {
                        const { defaultDevice } =
                          await import("../core/defaults");
                        await store.saveDevice({
                          ...defaultDevice,
                          ...(data.device as DeviceConfig),
                        });
                      }
                    }
                    setArchive(null);
                    setPassword("");
                    notify(t("备份操作完成", "Backup operation complete"));
                  },
                )
              }
            >
              {archive.mode === "export"
                ? t("加密并导出", "Encrypt and export")
                : t("解密验证并合并", "Decrypt, verify and merge")}
            </button>
          </Modal>
        )}
      </div>
      {confirmation.dialog}
    </SettingsContext.Provider>
  );
}
