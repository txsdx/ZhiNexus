/** Database configuration panel with explicit persistence and verification. */
import {
  auditAndRepair,
  auditLocal,
  recoverCloudSnapshots,
} from "../../services/integrity";
import { ConflictManager } from "../../components/ConflictManager";
import { Database, Download, ShieldCheck, Upload } from "lucide-react";
import { store } from "../../core/store";
import { uploadSnapshot } from "../../services/sync";
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
    setSize,
    notify,
    setPassword,
    setArchive,
  } = useSettings();
  return (
    <>
      <h2>{t("数据始终属于你", "Your data stays yours")}</h2>
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
            void act(t("校验日志与附件…", "Checking integrity…"), async () => {
              const report = await auditLocal();
              setReport("SQLite: ok\n" + JSON.stringify(report, null, 2));
            })
          }
        >
          <ShieldCheck size={16} />
          {t("全库完整性校验", "Verify database")}
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
            void act(t("上传完整快照…", "Uploading snapshot…"), async () =>
              setReport("Snapshot: " + (await uploadSnapshot())),
            )
          }
        >
          <Upload size={16} />
          {t("上传完整快照", "Upload full snapshot")}
        </button>
      </div>
      <h3>{t("同步修复与恢复", "Replica repair and recovery")}</h3>
      <div className="actions">
        <button
          disabled={!!busy}
          onClick={() =>
            void act(
              t("深度校验并修复…", "Deep auditing and repairing…"),
              async () =>
                setReport(JSON.stringify(await auditAndRepair(), null, 2)),
            )
          }
        >
          {t("校验并修复云端副本", "Audit and repair cloud replica")}
        </button>
        <button
          disabled={!!busy}
          onClick={() => {
            if (
              window.confirm(
                t(
                  "验证并合并云端全部完整快照？本地修改会保留。",
                  "Verify and merge cloud snapshots? Local edits will be retained.",
                ),
              )
            )
              void act(
                t("恢复云快照…", "Recovering cloud snapshots…"),
                async () =>
                  setReport(
                    JSON.stringify(await recoverCloudSnapshots(), null, 2),
                  ),
              );
          }}
        >
          {t("从云端快照恢复", "Recover cloud snapshots")}
        </button>
      </div>
      <p className="muted">
        {t(
          "修复前会保留远端损坏文件；只使用摘要完全匹配的副本，修复后重新读取验证。本机会自动保留已验证恢复点。",
          "Damaged remote files are quarantined before repair. Only matching verified copies are used, then read back. Verified local recovery points are retained automatically.",
        )}
      </p>
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
          "不会自动清理日志或附件，以避免离线设备丢失数据。存储空间会随历史增长。",
          "Logs and attachments are retained to protect offline devices. History grows over time.",
        )}
      </p>
    </>
  );
}
