/** Role-aligned messages, rendered Markdown, collapsible tool details and copy controls. */
import { memo } from "react";
import { Copy, Pencil } from "lucide-react";
import { native } from "../../core/database";
import type { Message } from "../../core/types";
import { Markdown } from "../Markdown";
import { useT } from "../common";

/** Copy plain message content through the platform clipboard, reporting useful action feedback. */
async function copyText(text: string) {
  if (native && !/Android/i.test(navigator.userAgent)) {
    const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
    await writeText(text);
  } else await navigator.clipboard.writeText(text);
}

/** Completed tool results remain available in context without an additional review dialog. */
export const ChatMessage = memo(function ChatMessage({
  message,
  results = [],
  streaming = false,
  notify,
  onReuse,
}: {
  message: Message;
  results?: Message[];
  streaming?: boolean;
  notify: (message: string) => void;
  onReuse?: (text: string) => void;
}) {
  const t = useT();
  return (
    <article
      className={
        "message " + message.role + (streaming ? " ai-live-message" : "")
      }
      aria-label={
        message.role === "user"
          ? t("用户消息", "User message")
          : t("助手回复", "Assistant response")
      }
    >
      {message.content &&
        (message.role === "user" ? (
          <div className="markdown chat-user-text">{message.content}</div>
        ) : (
          <Markdown>{message.content}</Markdown>
        ))}
      {message.tool_calls?.map((call) => {
        const result = results.find((r) => r.tool_call_id === call.id);
        return (
          <details className="chat-tool-call" key={call.id}>
            <summary>
              <code>{call.function.name}</code>
              <span>
                {result ? t("已完成", "Done") : t("处理中", "Running")}
              </span>
            </summary>
            <pre>{call.function.arguments}</pre>
            {result && <pre>{result.content}</pre>}
          </details>
        );
      })}
      {message.role === "user" && onReuse && (
        <div className="message-actions">
          <button
            className="icon"
            aria-label={t("再次提问", "Ask again")}
            onClick={() => onReuse(message.content)}
          >
            <Pencil size={15} />
          </button>
        </div>
      )}
      {message.role === "assistant" && message.content && (
        <div className="message-actions">
          {streaming && (
            <span className="streaming-indicator">
              {t("生成中", "Generating")}
            </span>
          )}
          <button
            type="button"
            className="icon"
            aria-label={t("复制回复", "Copy response")}
            title={t("复制回复", "Copy response")}
            onClick={() =>
              void copyText(message.content).then(
                () => notify(t("已复制", "Copied")),
                () =>
                  notify(
                    t(
                      "复制失败，请检查剪贴板权限",
                      "Copy failed; check clipboard permissions",
                    ),
                  ),
              )
            }
          >
            <Copy size={15} />
          </button>
        </div>
      )}
    </article>
  );
});
