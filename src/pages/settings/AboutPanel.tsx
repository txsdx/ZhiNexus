/** Platform-specific version and update controls backed by the shared GitHub Release manifest. */
import { useState, useEffect } from "react";
import { RefreshCw, Download } from "lucide-react";
import { native } from "../../core/database";
import {
  checkUpdates,
  applyUpdate,
  type UpdateInfo,
} from "../../services/updates";
import { Markdown } from "../../components/Markdown";
import { useSettings } from "./context";
import versions from "../../../versions.json";
import { useConfirmation } from "../../hooks/useConfirmation";
/** Show only the running platform's patch changes; installers retain normal operating-system consent prompts. */
export function AboutPanel() {
  const { t, busy, act, notify } = useSettings(),
    [update, setUpdate] = useState<UpdateInfo | null>(null),
    [updateError, setUpdateError] = useState(""),
    [current, setCurrent] = useState(versions.platforms.windows);
  const confirmation = useConfirmation(notify, {
    title: t("确认更新", "Confirm update"),
    confirmLabel: t("下载并安装", "Download and install"),
  });
  useEffect(() => {
    if (native)
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke<{ version: string }>("update_identity"))
        .then((r) => setCurrent(r.version));
  }, []);
  return (
    <>
      <img className="about-icon" src="/app-icon.png" alt="ZhiNexus" />
      <h2>知枢 · ZhiNexus</h2>
      <p>{current} · Local-first learning workspace</p>
      <p>
        {t(
          "让零散的知识，生长为自己的理解。",
          "Turn scattered knowledge into your own understanding.",
        )}
      </p>
      <div className="actions">
        <button
          disabled={!!busy}
          onClick={() =>
            void act(t("读取更新信息…", "Checking updates…"), async () => {
              setUpdateError("");
              let info: UpdateInfo | null;
              try {
                info = await checkUpdates();
              } catch (error) {
                setUpdateError(
                  error instanceof Error ? error.message : String(error),
                );
                throw error;
              }
              setUpdate(info);
              notify(
                info?.available
                  ? t(
                      "发现此平台的新版本",
                      "A new version is available for this platform",
                    )
                  : t(
                      "此平台已是最新版本，或尚无可用产物",
                      "Already current, or no artifact is published for this platform",
                    ),
              );
            })
          }
        >
          <RefreshCw size={16} />
          {t("检查更新", "Check for updates")}
        </button>
        <button
          className="primary"
          disabled={!!busy || !native || !update?.available}
          onClick={() => {
            if (!update) return;
            void confirmation.request(
              t(
                "下载并校验更新，然后打开安装程序？系统可能要求确认权限。",
                "Download and verify the update, then open its installer? The OS may require consent.",
              ),
              async () => {
                await act(
                  t("下载并校验…", "Downloading and verifying…"),
                  async () => {
                    await applyUpdate(update);
                    notify(t("已启动更新安装程序", "Update installer started"));
                  },
                );
              },
            );
          }}
        >
          <Download size={16} />
          {t("一键更新", "Update now")}
        </button>
      </div>
      {updateError && (
        <p role="alert" className="warning">
          {updateError}
        </p>
      )}
      {update && (
        <section>
          <h3>
            {update.current} → {update.version}
          </h3>
          <Markdown>{update.notes}</Markdown>
        </section>
      )}
      <p className="muted">
        {t(
          "所有产物必须通过 HTTPS 来源与 SHA-256 校验；配置发布者公钥时还强制验证签名。安装版 Windows、Android 和 Ubuntu 会打开系统安装程序，便携版 Windows 会安全替换自身并重启。",
          "All artifacts require trusted HTTPS and SHA-256 verification; publisher signatures are enforced when a key is configured. Installed Windows, Android and Ubuntu builds open their OS installer. Windows portable builds replace themselves and restart.",
        )}
      </p>
      <a
        href="https://github.com/txsdx/ZhiNexus"
        target="_blank"
        rel="noreferrer"
      >
        GitHub ↗
      </a>
      {confirmation.dialog}
    </>
  );
}
