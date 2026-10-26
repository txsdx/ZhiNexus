/** Database configuration panel with explicit persistence and verification. */
import {
  auditAndRepair,
  recoverCloudSnapshots,
} from "../../services/integrity";
import { SynchronizationPanel } from "./SynchronizationPanel";
import { StorageLocationPanel } from "./StorageLocationPanel";
import { ConflictManager } from "../../components/ConflictManager";
import { Database, Download, ShieldCheck, Upload } from "lucide-react";
import { store } from "../../core/store";
import { uploadSnapshot } from "../../services/sync";
import { useSettings } from "./context";
import { useConfirmation } from "../../hooks/useConfirmation";
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
  const confirmation = useConfirmation(notify, {
    title: t("确认恢复云端快照", "Confirm cloud snapshot recovery"),
    confirmLabel: t("确认恢复", "Recover snapshots"),
  });
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
            void act(t("上传完整快照…", "Uploading snapshot…"), async () =>
              setReport("Snapshot: " + (await uploadSnapshot())),
            )
          }
        >
          <Upload size={16} />
          {t("上传完整快照", "Upload full snapshot")}
        </button>
      </div>
      <p className="muted">
        {t(
          "校验将联网读取云端日志、附件与快照，合并本地尚未上传的修改，双向修复后重新读取并比较摘要，再安全清理恢复冗余。无法连接、缺少可信副本或云端持续变更时不清理。请先在下方配置 WebDAV，配置会自动保存。",
          "Verification reads cloud operations, attachments and snapshots, merges unpublished local edits, repairs both replicas and compares fresh digests before cleaning recovery redundancy. Cleanup is skipped on connection failures, missing repair sources or ongoing cloud changes. Configure WebDAV below; settings save automatically.",
        )}
      </p>
      <SynchronizationPanel />
      <h3>{t("云端快照恢复", "Cloud snapshot recovery")}</h3>
      <div className="actions">
        <button
          disabled={!!busy}
          onClick={() => {
            void confirmation.request(
              t(
                "验证并合并云端全部完整快照？本地修改会保留。",
                "Verify and merge cloud snapshots? Local edits will be retained.",
              ),
              async () => {
                await act(
                  t("恢复云快照…", "Recovering cloud snapshots…"),
                  async () =>
                    setReport(
                      JSON.stringify(await recoverCloudSnapshots(), null, 2),
                    ),
                );
              },
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
      {confirmation.dialog}
    </>
  );
}
