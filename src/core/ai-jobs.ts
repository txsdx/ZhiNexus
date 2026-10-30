/** Serializable, device-local AI work records; only explicit application changes replicated knowledge. */
import type { Json, Task, ToolCall } from "./types";
/** Queue destinations are application routes, never arbitrary URLs or executable model output. */
export interface AITarget {
  page: "entry" | "agent" | "review" | "settings" | "tasks" | "graph";
  entryId?: string;
  topicId?: string;
  sessionId?: string;
  tab?: string;
}
/** One genuine provider response, incrementally accumulated from SSE frames. */
export interface AIStage {
  /** Identifies the persisted assistant response even while the queue snapshot is throttled. */
  responseId?: string;
  task: Task;
  model: string;
  content: string;
  reasoning: string;
  calls: ToolCall[];
  streaming: boolean;
  finished: boolean;
}
/** Workflows with explicit, serializable input and a recoverable application destination. */
export type AIJobKind =
  | "explain"
  | "importance"
  | "relations"
  | "graph"
  | "classification"
  | "enrichment"
  | "image"
  | "ocr"
  | "chat"
  | "title"
  | "question"
  | "grade";
/** Waiting for review consumes no provider concurrency slot. */
export type AIJobState =
  "queued" | "running" | "approval" | "review" | "error" | "cancelled";
/** Durable queue item; credentials are resolved at execution time and never part of request configuration here. */
export interface AIJob {
  id: string;
  kind: AIJobKind;
  title: string;
  target: AITarget;
  input: Record<string, Json>;
  base: Record<string, Json>;
  state: AIJobState;
  stages: AIStage[];
  result?: Json;
  reviewData?: Json;
  approval?: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}
/** Runtime executor context; cancellation invalidates callbacks even if a transport delivers a late response. */
export interface AIJobContext {
  signal: AbortSignal;
  request<T>(
    task: Task,
    work: (progress: (stage: Partial<AIStage>) => void) => Promise<T>,
  ): Promise<T>;
  confirm(description: string): Promise<boolean>;
  check(): void;
}
/** Input supplied by application controls rather than provider content. */
export type NewAIJob = Pick<
  AIJob,
  "kind" | "title" | "target" | "input" | "base"
>;
