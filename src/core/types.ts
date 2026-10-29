/** Domain contracts for knowledge, review sessions, model discovery and replicated documents. */
import type { Card } from "ts-fsrs";
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Collection =
  "entry" | "category" | "topic" | "review" | "setting" | "edge";
export type Vector = Record<string, number>;
/** One immutable field patch with its writer dot and complete observed causal context. */
export interface Operation {
  schema: 1;
  device: string;
  seq: number;
  vector: Vector;
  collection: Collection;
  entity: string;
  patch: Record<string, Json>;
  at: string;
  source: string;
}
/** A canonical operation authenticated by its content hash. */
export interface Envelope {
  hash: string;
  op: Operation;
}
/** One surviving field candidate and the operation that introduced it. */
export interface Register {
  value: Json;
  event: Envelope;
}
/** Materialized replicated document with preserved concurrent alternatives and audit history. */
export interface Doc {
  id: string;
  collection: Collection;
  fields: Record<string, Json>;
  conflicts: Record<string, Register[]>;
  history: Envelope[];
}
/** Knowledge content, taxonomy references and its FSRS memory state. */
export interface Entry {
  id: string;
  title: string;
  content: string;
  summary?: string;
  /** A synchronized bookmark, independent of the card schedule and taxonomy. */
  starred?: boolean;
  /** Soft row/document background chosen from the built-in palette. */
  color?: import("./entry-colors").EntryColor;
  editorDocument?: { schema: 1; markdown: string; json: Json };
  category: string;
  tags: string[];
  prerequisites: string[];
  createdAt: string;
  updatedAt: string;
  card: Card;
  /** Completed review sessions, excluding the implicit initial learning event at creation. */
  reviewCount?: number;
  deleted?: boolean;
}
/** User-controlled taxonomy node; an empty parent denotes a top-level category. */
export interface Category {
  id: string;
  name: string;
  parent: string;
}
/** Serializable OpenAI chat message including complete tool protocol metadata. */
export interface Message {
  /** Matches a streamed provider stage to its durable assistant response. */
  responseId?: string;
  /** Namespaces tool receipts per assistant response while preserving earlier committed receipts. */
  toolReceiptVersion?: 2;
  /** Local orchestration metadata, stripped before requests are sent to the provider. */
  jobId?: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}
/** A provider-requested function invocation requiring validated arguments. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
/** Independent global or entry-scoped conversation history. */
export interface Topic {
  id: string;
  entryId: string;
  title: string;
  titleMode?: "auto" | "manual";
  titleGenerated?: boolean;
  messages: Message[];
  updatedAt: string;
}
export type Task =
  | "explain"
  | "question"
  | "grade"
  | "classify"
  | "relations"
  | "graph"
  | "agent"
  | "ocr"
  | "image";
/** Per-device proxy policy shared by every native network client. */
export interface ProxySettings {
  mode: "system" | "http" | "socks5";
  url: string;
  username: string;
  password: string;
  bypass: string;
}
/** Native desktop preferences mirrored into encrypted backups, with OS integration applied explicitly. */
export interface DesktopPreferences {
  background: boolean;
  autostart: boolean;
  captureShortcut: string;
  ocrShortcut: string;
  showShortcut: string;
}
/** Only server-declared capabilities; null denotes unknown support. */
export interface Model {
  id: string;
  name: string;
  efforts: string[];
  thinking: boolean | null;
  tools: boolean | null;
  vision: boolean | null;
  image: boolean | null;
  context?: number;
}
/** Per-feature model, reasoning preference and editable prompt template. */
export interface TaskConfig {
  model: string;
  effort: string;
  prompt: string;
}
/** Replicated provider metadata and task configuration without API credentials. */
export interface AIConfig {
  baseUrl: string;
  /** Raw model ID inherited by selections whose model is empty. */
  defaultModel: string;
  models: Model[];
  tasks: Record<Task, TaskConfig>;
}
/** Local credentials and device-specific scheduling and notification preferences. */
export interface DeviceConfig {
  /** Check and stage updates in the background; Windows installs on a normal safe exit. */
  autoUpdate?: boolean;
  /** Explicit review method; unset chooses offline practice when no AI provider is usable. */
  reviewMode?: "ai" | "self";
  /** Local curve display preferences; time panning remains transient. */
  curveView?: {
    limit: number;
    maxRecall: number;
    past: number;
    future: number;
  };
  /** Per-device limit for active AI HTTP generation requests; waiting reviews consume no slot. */
  aiConcurrency?: number;
  /** Remember the full/compact navigation rail on this device. */
  sidebarCollapsed?: boolean;
  apiKey: string;
  apiKeyEndpoint?: string;
  /** One optional key for all synchronized credentials; empty selects built-in encryption. */
  apiKeySyncKey?: string;
  /** Durable local outbox flags; encrypted synchronization must finish before these edits can be replaced. */
  credentialSyncPending?: { api: boolean; connections: boolean };
  proxy?: ProxySettings;
  desktop?: DesktopPreferences;
  davUrl: string;
  davUser: string;
  davPassword: string;
  syncMinutes: number;
  notifications: boolean;
  notificationOptions?: {
    aiWhenUnfocused: boolean;
    ocrWhenUnfocused: boolean;
    syncFailures: boolean;
    preview: boolean;
    cooldownSeconds: number;
  };
  lastSync: string;
  mcp: McpConfig[];
}
/** Explicit MCP configuration whose credentials synchronize encrypted; program execution consent stays local. */
export interface McpConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  token: string;
  transport?: "http" | "sse" | "stdio";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}
/** Structured review question, reference answer and grading rubric. */
export interface Question {
  question: string;
  type: "short" | "choice";
  choices: string[];
  answer: string;
  rubric: string;
}
/** Validated assessment and teaching material; the score is bounded to 0–100. */
export interface Grade {
  score: number;
  feedback: string;
  missing: string;
  lesson: string;
}
/** Persisted review state machine that survives navigation and process restarts. */
export interface ReviewSession {
  id: string;
  entryId: string;
  /** Offline self-rating is separate from AI grading. */
  mode?: "ai" | "self";
  referenceHash?: string;
  completedAt?: string;
  phase: "question" | "answer" | "graded" | "done" | "cancelled";
  question: Question;
  answer: string;
  grade: Grade | null;
  /** Learner-confirmed FSRS recall rating, separate from the AI assessment score. */
  rating?: 1 | 2 | 3 | 4;
  startedAt: string;
}
