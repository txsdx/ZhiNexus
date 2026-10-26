/** Accessible shortcut recording with temporary native unregistration and lease-based crash recovery. */
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { shortcutFromStroke } from "../../core/shortcuts";
import { useSettings } from "./context";
/** Capture one complete physical key combination; Escape, blur and unmount always release native ownership. */
export function ShortcutCapture({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t, notify, busy } = useSettings();
  const [recording, setRecording] = useState(false),
    [starting, setStarting] = useState(false);
  const token = useRef<string | null>(null),
    mounted = useRef(true),
    button = useRef<HTMLButtonElement>(null);
  const release = async () => {
    const lease = token.current;
    token.current = null;
    if (mounted.current) setRecording(false);
    if (lease)
      await invoke("end_shortcut_capture", { token: lease }).catch((e) =>
        notify(String(e)),
      );
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void release();
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === "Escape") {
        void release();
        return;
      }
      const next = shortcutFromStroke(e);
      if (next) {
        onChange(next);
        void release();
      }
    };
    const blur = () => void release();
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", blur);
    const timeout = window.setTimeout(blur, 25000);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", blur);
      window.clearTimeout(timeout);
    };
  }, [recording, onChange]);
  return (
    <div className="shortcut-field">
      <span>{label}</span>
      <div className="actions">
        <button
          ref={button}
          type="button"
          className={recording ? "primary" : ""}
          data-shortcut-capture
          aria-label={label}
          aria-pressed={recording}
          disabled={!!busy}
          aria-busy={starting}
          onClick={(event) => {
            if (starting) return;
            event.currentTarget.focus();
            if (recording) {
              void release();
              return;
            }
            setStarting(true);
            void invoke<string>("begin_shortcut_capture")
              .then((lease) => {
                token.current = lease;
                if (
                  !mounted.current ||
                  document.activeElement !== button.current
                ) {
                  void release();
                  return;
                }
                setRecording(true);
              })
              .catch((e) => notify(String(e)))
              .finally(() => {
                if (mounted.current) setStarting(false);
              });
          }}
          onBlur={() => {
            if (recording) void release();
          }}
        >
          {recording
            ? t("请按组合键（Esc 取消）", "Press shortcut (Esc cancels)")
            : value || t("点击录制快捷键", "Click to record shortcut")}
        </button>
        <button
          type="button"
          disabled={recording || starting || !!busy || !value}
          onClick={() => onChange("")}
        >
          {t("禁用", "Disable")}
        </button>
      </div>
    </div>
  );
}
