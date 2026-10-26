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
  category: string;
  tags: string[];
  prerequisites: string[];
  createdAt: string;
  updatedAt: string;
  card: Card;
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
  messages: Message[];
  updatedAt: string;
}
export type Task =
  | "explain"
  | "question"
  | "grade"
  | "classify"
  | "relations"
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
  models: Model[];
  tasks: Record<Task, TaskConfig>;
}
/** Local credentials and device-specific scheduling and notification preferences. */
export interface DeviceConfig {
  apiKey: string;
  apiKeyEndpoint?: string;
  apiKeySyncKey?: string;
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
/** Explicitly enabled HTTPS MCP endpoint with a device-local token. */
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
  phase: "question" | "answer" | "graded" | "done";
  question: Question;
  answer: string;
  grade: Grade | null;
  startedAt: string;
}
