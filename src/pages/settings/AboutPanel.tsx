/** Shared automatic-update status and device-local preferences; downloads survive route changes and restart. */
import { useState, useEffect, useSyncExternalStore } from "react";
import { RefreshCw, Download } from "lucide-react";
import { native } from "../../core/database";
import { autoUpdates, installReadyUpdate } from "../../services/auto-updates";
import { Markdown } from "../../components/Markdown";
import { useSettings } from "./context";
import versions from "../../../versions.json";
/** Show the same background task as the shell; system-required installation consent is preserved. */
export function AboutPanel() {
  const { t, act, notify, device, setDevice } = useSettings();
  const state = useSyncExternalStore(
    autoUpdates.subscribe,
    autoUpdates.getSnapshot,
  );
  const [current, setCurrent] = useState(versions.platforms.windows);
  const working = ["checking", "downloading", "installing"].includes(
    state.phase,
  );
  useEffect(() => {
    if (native)
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke<{ version: string }>("update_identity"))
        .then((r) => setCurrent(r.version))
        .catch((error) => notify(String(error)));
  }, []);
  const labels = {
    idle: t("等待检查", "Waiting to check"),
    checking: t("正在后台检查更新…", "Checking in the background…"),
    downloading: t(
      "正在后台下载并校验…",
      "Downloading and verifying in the background…",
    ),
    ready:
      state.update?.kind === "setup" || state.update?.kind === "portable"
        ? t(
            "更新已就绪，正常退出时自动安装",
            "Update ready; installs on normal exit",
          )
        : t(
            "更新已就绪，等待系统安装授权",
            "Update ready; OS installation approval required",
          ),
    installing: t("正在启动安装…", "Starting installation…"),
    current: t(
      "此平台已是最新版本，或尚无可用产物",
      "Already current, or no artifact is published",
    ),
    error: t("更新未完成，可重试", "Update incomplete; retry available"),
  };
  return (
    <>
      <img className="about-icon" src="/app-icon.png" alt="ZhiNexus" />
      <h2>知枢 · ZhiNexus</h2>
      <p>{current}</p>
      <label className="check">
        <input
          type="checkbox"
          checked={device.autoUpdate !== false}
          onChange={(e) =>
            setDevice({ ...device, autoUpdate: e.target.checked })
          }
        />
        {t(
          "自动检查并后台下载更新",
          "Automatically check and download updates",
        )}
      </label>
      <p role="status" data-update-phase={state.phase}>
        {state.phase === "ready" && device.autoUpdate === false
          ? t(
              "更新已就绪，可手动安装",
              "Update ready; manual installation available",
            )
          : labels[state.phase]}
      </p>
      <div className="actions">
        <button
          disabled={working}
          onClick={() =>
            void act(t("读取更新信息…", "Checking updates…"), () =>
              autoUpdates.check().then(() => {}),
            )
          }
        >
          <RefreshCw size={16} />
          {t("检查更新", "Check for updates")}
        </button>
        <button
          className="primary"
          disabled={!native || state.phase !== "ready"}
          onClick={() =>
            void act(t("安装更新…", "Installing update…"), installReadyUpdate)
          }
        >
          <Download size={16} />
          {t("立即安装更新", "Install update now")}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="warning">
          {state.error}
        </p>
      )}
      {state.update && (
        <section>
          <h3>
            {state.update.current} → {state.update.version}
          </h3>
          <Markdown>{state.update.notes}</Markdown>
        </section>
      )}
      <p className="muted">
        {t(
          "启动后自动检查，联网后重试；后台下载经过摘要和已配置的发布者签名校验。Windows 正常退出时安装，不打断编辑；Android 和 Ubuntu 安装仍需系统授权。",
          "Checks after startup and retries when online. Background downloads require digest and configured publisher-signature verification. Windows installs on normal exit without interrupting editing; Android and Ubuntu require OS installation approval.",
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
