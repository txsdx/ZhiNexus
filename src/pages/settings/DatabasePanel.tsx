/** Database configuration panel with explicit persistence and verification. */
import { ConflictManager } from "../../components/ConflictManager";
import { Database, Download, ShieldCheck, Upload } from "lucide-react";
import { stateHash, validateEnvelope } from "../../core/crdt";
import { merkle } from "../../core/crypto";
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
              for (const e of s.events) await validateEnvelope(e);
              for (const h of await store.db.blobHashes())
                await store.db.blob(h);
              setReport(
                "SQLite: " +
                  (await store.db.integrity()) +
                  "\nMerkle: " +
                  (await merkle([
                    ...s.events.map((e) => e.hash),
                    ...(await store.db.blobHashes()),
                  ])) +
                  "\nState: " +
                  (await stateHash(s.events)),
              );
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
