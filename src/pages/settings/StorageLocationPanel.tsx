/** Storage-root management is a secondary, explicit operation beneath database backup and cloud controls. */
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "../../components/common";
import {
  desktopAvailable,
  migrateStorage,
  type MigrationPlan,
} from "../../services/desktop";
import { store } from "../../core/store";
import { useSettings } from "./context";
/** Preview a portable/system migration without competing with routine verification controls. */
export function StorageLocationPanel() {
  const { t, busy, act } = useSettings();
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  return (
    <details data-storage-location>
      <summary>
        {t("存储位置与便携模式迁移", "Storage location & portable migration")}
      </summary>
      {store.db.storageLocation && (
        <div className="notice">
          {store.db.storageLocation.portable
            ? t(
                "便携模式：数据随程序目录保存",
                "Portable mode: data stays with this executable",
              )
            : t(
                "系统用户应用数据目录",
                "System user application-data directory",
              )}
          <code style={{ overflowWrap: "anywhere" }}>
            {store.db.storageLocation.root}
          </code>
        </div>
      )}
      {store.db.storageLocation?.migrationNotice && (
        <p role="status">
          {store.db.storageLocation.migrationNotice.success
            ? t(
                "数据迁移已完成，源数据与旧目标备份均已保留。",
                "Storage migration completed; source and previous target retained.",
              )
            : store.db.storageLocation.migrationNotice.message}
        </p>
      )}
      {desktopAvailable && (
        <button
          disabled={!!busy}
          onClick={() =>
            void act(
              t("检查迁移目录", "Checking storage locations"),
              async () =>
                setPlan(
                  await invoke<MigrationPlan>("storage_migration_plan", {
                    portable: !store.db.storageLocation?.portable,
                  }),
                ),
            )
          }
        >
          {store.db.storageLocation?.portable
            ? t("迁移到系统应用数据目录", "Move to system application data")
            : t(
                "迁移为 protable（程序目录 _data）",
                "Move to protable (executable _data)",
              )}
        </button>
      )}
      {plan && (
        <Modal
          title={t("确认迁移并重启", "Confirm storage migration and restart")}
          onClose={() => {
            if (!busy) setPlan(null);
          }}
        >
          <p>
            {t(
              "程序将关闭数据库并重启，逐文件校验后切换目录。源目录保留；目标已有数据会整体备份，不会自动混合两套数据库。",
              "The app will close storage, verify copied files and restart. The source is retained. Existing target data is backed up separately, without merging databases.",
            )}
          </p>
          <p>
            {t("来源：", "From: ")}
            <code>{plan.source}</code>
          </p>
          <p>
            {t("目标：", "To: ")}
            <code>{plan.target}</code>
          </p>
          <p>
            {plan.files} {t("个文件", "files")} ·{" "}
            {(plan.bytes / 1024 / 1024).toFixed(2)} MiB
          </p>
          {plan.targetExists && (
            <p>
              {t(
                "目标目录已存在，将保留带日期标识的独立备份。",
                "The existing target will be retained in a uniquely named backup.",
              )}
            </p>
          )}
          <button
            className="primary"
            disabled={!!busy}
            onClick={() =>
              void act(t("正在迁移并重启…", "Migrating and restarting…"), () =>
                migrateStorage(plan),
              )
            }
          >
            {t("迁移并重启", "Migrate and restart")}
          </button>
        </Modal>
      )}
    </details>
  );
}
