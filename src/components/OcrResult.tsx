/** Editable OCR review with offline recognition first and an explicit vision-model upload action. */
import { diagnostics } from "../services/diagnostics";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal, useT } from "./common";
import { store } from "../core/store";
import { submitAIJob } from "../services/ai-jobs";
import { unbase64 } from "../core/crypto";
import { notifyCompletion } from "../services/notifications";
/** Review text and image provenance before starting the standard duplicate-aware entry capture flow. */
export function OcrResult({
  image,
  source,
  onClose,
  onUse,
}: {
  image: string;
  source: string;
  onClose: () => void;
  onUse: (text: string, image: string) => void;
}) {
  const t = useT(),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [keepImage, setKeepImage] = useState(true);
  const recognize = async (ai: boolean) => {
    setBusy(true);
    setError("");
    try {
      let result: string;
      if (ai) {
        const hash = await store.db.putBlob(
          unbase64(image.split(",")[1]),
          "image/png",
        );
        await submitAIJob(
          "ocr",
          { page: "tasks" },
          { imageHash: hash, source },
        );
        onClose();
        return;
      } else result = await invoke<string>("recognize_ocr", { image });
      setText(result);
      if (!result.trim())
        setError(
          t(
            "未识别出文字，可重试或手动输入",
            "No text recognized. Retry or enter text manually.",
          ),
        );
      void notifyCompletion("ocr", result).catch(() => {});
    } catch (e) {
      diagnostics.error("ai", "AI 任务失败 / AI task failed", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void recognize(false);
  }, []);
  return (
    <Modal
      title={t("检查识别结果", "Review recognized text")}
      onClose={onClose}
    >
      <img
        className="ocr-preview"
        src={image}
        alt={t("已框选的截图", "Selected screenshot")}
      />
      <p className="muted">{source}</p>
      <label>
        {t("识别文字（可编辑）", "Recognized text (editable)")}
        <textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <label className="toggle">
        <input
          type="checkbox"
          checked={keepImage}
          onChange={(e) => setKeepImage(e.target.checked)}
        />
        {t("创建词条时保留截图", "Keep the screenshot with the entry")}
      </label>
      <div className="actions">
        <button disabled={busy} onClick={() => void recognize(false)}>
          {busy ? t("正在识别…", "Recognizing…") : t("本地识别", "Local OCR")}
        </button>
        <button disabled={busy} onClick={() => void recognize(true)}>
          {t("AI 识别（上传截图）", "AI OCR (uploads screenshot)")}
        </button>
        <button
          className="primary"
          disabled={busy || !text.trim()}
          onClick={() => onUse(text, keepImage ? image : "")}
        >
          {t("作为词条继续", "Continue as an entry")}
        </button>
      </div>
    </Modal>
  );
}
