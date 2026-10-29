/** Export human-readable chat only, excluding hidden prompts, raw tools and credentials/settings. */
import type { Topic } from "./types";
import type { AIJob } from "./ai-jobs";
/** Include received live text exactly once with an explicit incomplete-state label. */
export function conversationMarkdown(topic: Topic, jobs: AIJob[] = []) {
  const sections = ["# " + topic.title.replace(/[\r\n]/g, " ")];
  for (const message of topic.messages) {
    if (!["user", "assistant"].includes(message.role) || !message.content)
      continue;
    sections.push(
      (message.role === "user" ? "## You" : "## ZhiNexus") +
        "\n\n" +
        message.content,
    );
  }
  for (const job of jobs) {
    const stage = job.stages.at(-1);
    if (
      !stage?.content ||
      topic.messages.some(
        (message) =>
          message.jobId === job.id &&
          (stage.responseId
            ? message.responseId === stage.responseId
            : message.content === stage.content),
      )
    )
      continue;
    sections.push(
      "## ZhiNexus (" + job.state + "; partial output)\n\n" + stage.content,
    );
  }
  return sections.join("\n\n") + "\n";
}
