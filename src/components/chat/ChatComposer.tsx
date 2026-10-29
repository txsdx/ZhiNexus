/** A bottom-pinned composer with IME-safe keyboard submission and model controls below the prompt. */
import { useLayoutEffect, useRef } from "react";
import { ArrowUp, Bot, Square, X } from "lucide-react";
import type { AIConfig } from "../../core/types";
import { resolveModel } from "../../core/ai-config";
import { useT } from "../common";

/** Autosize the draft without moving the outer page; Shift+Enter keeps a newline. */
export function ChatComposer({
  text,
  onText,
  quote,
  onRemoveQuote,
  model,
  onModel,
  effort,
  onEffort,
  ai,
  busy,
  readOnly,
  active,
  onSend,
  onStop,
}: {
  text: string;
  onText: (text: string) => void;
  quote: string;
  onRemoveQuote: () => void;
  model: string;
  onModel: (model: string) => void;
  effort: string;
  onEffort: (effort: string) => void;
  ai: AIConfig;
  busy: boolean;
  readOnly: boolean;
  active: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  const t = useT(),
    field = useRef<HTMLTextAreaElement>(null),
    actual = resolveModel(ai, "agent", model);
  useLayoutEffect(() => {
    const input = field.current;
    if (input) {
      input.style.height = "0px";
      input.style.height =
        Math.min(180, Math.max(54, input.scrollHeight)) + "px";
    }
  }, [text]);
  return (
    <form
      className="chat-input"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      {quote && (
        <blockquote className="chat-selection-context">
          <p>{quote}</p>
          <button
            type="button"
            className="icon"
            aria-label={t("移除引用", "Remove quote")}
            onClick={onRemoveQuote}
          >
            <X size={15} />
          </button>
        </blockquote>
      )}
      <textarea
        ref={field}
        readOnly={readOnly}
        rows={2}
        aria-label={t("消息", "Message")}
        placeholder={t("输入消息…", "Message…")}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            e.keyCode !== 229
          ) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <div className="composer-footer">
        <div className="chat-model">
          <Bot size={16} />
          <select
            disabled={readOnly}
            aria-label="Chat model"
            value={model}
            onChange={(e) => onModel(e.target.value)}
          >
            <option value="">
              {t("默认模型", "Default model")}
              {ai.defaultModel ? ` (${ai.defaultModel})` : ""}
            </option>
            {model && !ai.models.some((m) => m.id === model) && (
              <option value={model}>{model}</option>
            )}
            {ai.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
          <select
            disabled={readOnly}
            aria-label="Reasoning effort"
            value={effort}
            onChange={(e) => onEffort(e.target.value)}
          >
            {[
              ...new Set([
                effort,
                ...(ai.models.find((m) => m.id === actual)?.efforts ?? []),
              ]),
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <div className="composer-actions">
          {active && (
            <button
              type="button"
              className="icon"
              aria-label={t("停止生成", "Stop generating")}
              onClick={onStop}
              disabled={readOnly}
            >
              <Square size={17} />
            </button>
          )}
          <button
            type="submit"
            className="primary icon"
            aria-label="Send"
            title={
              readOnly
                ? t(
                    "AI 任务由另一个窗口处理",
                    "AI tasks are owned by another window",
                  )
                : t("发送消息", "Send message")
            }
            disabled={busy || readOnly || !text.trim()}
          >
            <ArrowUp size={19} />
          </button>
        </div>
      </div>
    </form>
  );
}
