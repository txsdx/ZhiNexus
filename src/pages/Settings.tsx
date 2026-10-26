/** Modular settings shell and explicit confirmation dialogs. */
import { Busy, Modal } from "../components/common";
import { decryptBackup, encryptBackup } from "../core/crypto";
import { json, store } from "../core/store";
import type { DeviceConfig } from "../core/types";
import { applyClassification } from "../services/classification";
import { restoreSnapshot, snapshot } from "../services/sync";
import { AboutPanel } from "./settings/AboutPanel";
import { AppearancePanel } from "./settings/AppearancePanel";
import { CategoriesPanel } from "./settings/CategoriesPanel";
import { SettingsContext } from "./settings/context";
import { useSettingsState } from "./settings/controller";
import { DatabasePanel } from "./settings/DatabasePanel";
import { McpPanel } from "./settings/McpPanel";
import { ModelsPanel } from "./settings/ModelsPanel";
import { PromptsPanel } from "./settings/PromptsPanel";
import { CategoryTree, saveFile } from "./settings/shared";
import { SynchronizationPanel } from "./settings/SynchronizationPanel";
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
    proposal,
    setProposal,
    s,
    act,
    archive,
    setArchive,
    password,
    setPassword,
  } = context;
  return (
    <SettingsContext.Provider value={context}>
      (
      <div className="page settings-page">
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
        <div className="settings-shell">
          <aside className="settings-tabs">
            {tabs.map((x) => (
              <button
                key={x.id}
                className={tab === x.id ? "active" : ""}
                onClick={() => setTab(x.id)}
              >
                <x.icon size={17} />
                {x.label}
              </button>
            ))}
          </aside>
          <div className="settings-content">
            {<AppearancePanel />}
            {<ModelsPanel />}
            {<PromptsPanel />}
            {<CategoriesPanel />}
            {<SynchronizationPanel />}
            {<McpPanel />}
            {<DatabasePanel />}
            {<AboutPanel />}
            {report && <pre className="report">{report}</pre>}
          </div>
        </div>
        {proposal && (
          <Modal
            wide
            title={t("确认知识分类变更", "Confirm taxonomy changes")}
            onClose={() => setProposal(null)}
          >
            <div className="compare-trees">
              <section>
                <h3>{t("变更前", "Before")}</h3>
                <CategoryTree
                  categories={s.categories}
                  assignments={s.entries}
                />
              </section>
              <section>
                <h3>{t("变更后", "After")}</h3>
                <CategoryTree
                  categories={[...s.categories, ...proposal.categories]}
                  assignments={proposal.assignments}
                />
              </section>
            </div>
            <details>
              <summary>{t("逐条分配变化", "Entry-by-entry changes")}</summary>
              {proposal.assignments.map((a) => (
                <p key={a.entryId}>
                  {s.entries.find((e) => e.id === a.entryId)?.title} →{" "}
                  {
                    [...s.categories, ...proposal.categories].find(
                      (c) => c.id === a.category,
                    )?.name
                  }
                </p>
              ))}
            </details>
            <button
              className="primary"
              disabled={!!busy}
              onClick={() =>
                void act(
                  t("应用分类…", "Applying classification…"),
                  async () => {
                    await applyClassification(proposal);
                    setProposal(null);
                    notify(t("分类已更新", "Categories updated"));
                  },
                )
              }
            >
              {t("确认并应用", "Confirm and apply")}
            </button>
          </Modal>
        )}
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
                            device: s.device,
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
                        window.confirm(
                          t(
                            "同时恢复备份中的本机凭证和偏好？这会替换本设备设置。",
                            "Also restore backed-up credentials and device preferences? This replaces this device’s settings.",
                          ),
                        )
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
      )
    </SettingsContext.Provider>
  );
}
