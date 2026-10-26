/** About configuration panel with explicit persistence and verification. */
import { RefreshCw } from "lucide-react";
import { native } from "../../core/database";
import { installUpdate, latestRelease } from "../../services/device";
import { useSettings } from "./context";
/** AboutPanel exposes one focused settings workflow. */
export function AboutPanel() {
  const { t, busy, act, setReport, notify } = useSettings();
  return (
    <>
      <div className="about-mark">知</div>
      <h2>知枢 · ZhiNexus</h2>
      <p>0.1.0 · Local-first learning workspace</p>
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
            void act(t("读取 Release…", "Checking releases…"), async () => {
              const r = await latestRelease();
              setReport(r.version + "\n" + r.url);
            })
          }
        >
          <RefreshCw size={16} />
          {t("检查 GitHub Release", "Check GitHub release")}
        </button>
        <button
          disabled={!!busy || !native}
          onClick={() => {
            if (
              window.confirm(
                t(
                  "下载并安装签名更新？安装后将重启。",
                  "Download and install a signed update? The app will restart.",
                ),
              )
            )
              void act(
                t("检查签名更新…", "Checking signed updates…"),
                async () =>
                  notify(
                    (await installUpdate())
                      ? t("正在重启", "Restarting")
                      : t("暂无更新", "No updates available"),
                  ),
              );
          }}
        >
          {t("一键安装签名更新", "Install signed update")}
        </button>
      </div>
      <p className="muted">
        {t(
          "一键更新需发布者配置签名公钥及 Release 更新清单，Android 使用签名 APK。当前版本尚未发布。",
          "Desktop updates require a publisher signing key and release manifest. Android uses signed APKs. This version has not been released.",
        )}
      </p>
      <a
        href="https://github.com/txsdx/ZhiNexus"
        target="_blank"
        rel="noreferrer"
      >
        GitHub ↗
      </a>
    </>
  );
}
