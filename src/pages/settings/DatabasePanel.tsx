/** Database configuration panel with explicit persistence and verification. */
import { auditAndRepair } from "../../services/integrity";
import { SynchronizationPanel } from "./SynchronizationPanel";
import { StorageLocationPanel } from "./StorageLocationPanel";
import { ConflictManager } from "../../components/ConflictManager";
import { Database, Download, ShieldCheck, Upload } from "lucide-react";
import { store } from "../../core/store";
import { useSettings } from "./context";
/** DatabasePanel exposes one focused settings workflow. */
export function DatabasePanel() {
  const {
    t,
    size,
    s,
    busy,
    act,
    setReport,
    setBusy,
    setSize,
    notify,
    setPassword,
    setArchive,
  } = useSettings();
  return (
    <>
      <h2>{t("数据库与云同步", "Database & cloud sync")}</h2>
      <div className="database-stats">
        <strong>
          {(size / 1024 / 1024).toFixed(2)} <small>MiB</small>
        </strong>
        <span>
          SQLite · {s.events.length} {t("条操作", "operations")} ·{" "}
          {s.entries.length} {t("个词条", "entries")}
        </span>
      </div>
      <div className="actions">
        <button
          disabled={!!busy}
          onClick={() =>
            void act(
              t("校验本地与云端…", "Verifying local and cloud…"),
              async () => {
                const report = await auditAndRepair(undefined, setBusy);
                setReport("SQLite: ok\n" + JSON.stringify(report, null, 2));
              },
            )
          }
        >
          <ShieldCheck size={16} />
          {t("校验、修复并清理", "Verify, repair & clean up")}
        </button>
        <button
          disabled={!!busy}
          onClick={() =>
            void act(t("整理 SQLite…", "Compacting SQLite…"), async () => {
              await store.db.vacuum();
              setSize(await store.db.size());
              notify(
                t(
                  "已整理，保留所有历史记录",
                  "Compacted; all history preserved",
                ),
              );
            })
          }
        >
          <Database size={16} />
          {t("压缩整理", "Compact")}
        </button>
        <button
          disabled={!!busy}
          onClick={() =>
            void act(t("整理云端日志…", "Compacting cloud logs…"), async () =>
              setReport(
                JSON.stringify(
                  await auditAndRepair(undefined, setBusy, { compact: true }),
                  null,
                  2,
                ),
              ),
            )
          }
        >
          <Upload size={16} />
          {t("整理云端日志", "Compact cloud logs")}
        </button>
      </div>
      <p className="muted">
        {t(
          "同步使用压缩日志批次和可校验检查点，分批自动清理已被完整覆盖的旧文件。整理云端日志会重新读取校验并合并尚未上传的修改；缺少可信副本时保留原文件并报错。WebDAV 配置自动保存。",
          "Sync uses compressed batches and verified checkpoints, automatically retiring fully covered old files in batches. Cloud compaction re-reads data and merges unpublished edits. Missing repair sources retain originals and report an error. WebDAV settings save automatically.",
        )}
      </p>
      <SynchronizationPanel />
      <h3>{t("加密文件备份", "Encrypted file backup")}</h3>
      <p className="muted">
        {t(
          "包含全部日志、图片和本机配置。AES-256-GCM + PBKDF2。导入以合并方式恢复，不抹去本地变更；不会自动覆盖当前凭证。请妥善保管密码。",
          "Includes logs, attachments and device configuration. AES-256-GCM + PBKDF2. Restore merges data, retaining local edits and current credentials. Keep the passphrase safe.",
        )}
      </p>
      <div className="actions">
        <button
          onClick={() => {
            setPassword("");
            setArchive({ mode: "export", text: "" });
          }}
        >
          <Download size={16} />
          {t("备份到文件", "Back up to file")}
        </button>
        <label className="button">
          <Upload size={16} />
          {t("从文件恢复", "Restore from file")}
          <input
            type="file"
            accept=".znb,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                if (f.size > 256 * 1024 * 1024) {
                  notify("备份文件超过 256 MiB");
                  return;
                }
                void f.text().then((text) => {
                  setPassword("");
                  setArchive({ mode: "import", text });
                });
              }
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <StorageLocationPanel />
      <ConflictManager />
      <h3>{t("回收站", "Recycle bin")}</h3>
      {s.docs
        .filter((d) => d.collection === "entry" && d.fields.deleted)
        .map((d) => (
          <div className="deleted-row" key={d.id}>
            {String(d.fields.title)}
            <button
              onClick={() =>
                void store.patch("entry", d.id, { deleted: false }, "restore")
              }
            >
              {t("恢复", "Restore")}
            </button>
          </div>
        ))}
      <p className="muted">
        {t(
          "自动清理三份已验证恢复点均覆盖的恢复日志副本和超过 24 小时的临时写入文件。同步日志、历史附件、回收站、冲突和损坏原件会保留，避免离线设备丢失数据。",
          "Cleanup removes recovery journal copies covered by all three verified checkpoints and pending files older than 24 hours. Sync history, historical assets, trash, conflicts and damaged originals are retained to protect offline devices.",
        )}
      </p>
    </>
  );
}
