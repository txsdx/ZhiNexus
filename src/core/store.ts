/** Application repository, serialized operation creation and reactive projections of SQLite state. */
import { assertCausalClosure, validateDocuments } from "./validation";
import { Database } from "./database";
import { joinVectors, materialize, validateEnvelope } from "./crdt";
import { sha256 } from "./crypto";
import { defaultAI, defaultDevice, entryTemplate } from "./defaults";
import { newCard, reviveCard } from "./review";
import type {
  AIConfig,
  Category,
  Collection,
  DeviceConfig,
  Doc,
  Entry,
  Envelope,
  Json,
  Operation,
  Topic,
  ReviewSession,
} from "./types";
/** Convert serializable domain objects to the JSON event boundary. */
export function json(value: unknown): Json {
  return JSON.parse(JSON.stringify(value));
}
export interface Snapshot {
  docs: Doc[];
  events: Envelope[];
  entries: Entry[];
  categories: Category[];
  topics: Topic[];
  reviews: ReviewSession[];
  ai: AIConfig;
  device: DeviceConfig;
  ready: boolean;
  revision: number;
}
/** Project all collections consistently and preserve deleted documents in the event history. */
function projection(
  events: Envelope[],
  device: DeviceConfig,
  revision: number,
): Snapshot {
  const docs = materialize(events);
  const rows = <T>(collection: Collection) =>
    docs
      .filter((d) => d.collection === collection && !d.fields.deleted)
      .map((d) => ({ id: d.id, ...d.fields }) as T);
  const ai = {
    ...defaultAI(),
    ...docs.find((d) => d.collection === "setting" && d.id === "ai")?.fields,
  } as AIConfig;
  const entries = rows<Entry>("entry").map((e) => ({
    ...e,
    tags: e.tags ?? [],
    prerequisites: e.prerequisites ?? [],
    card: e.card ? reviveCard(e.card) : newCard(),
  }));
  return {
    docs,
    events,
    entries,
    categories: rows<Category>("category"),
    topics: rows<Topic>("topic"),
    reviews: rows<ReviewSession>("review"),
    ai,
    device,
    ready: true,
    revision,
  };
}
/** Own local durability and make every user mutation an auditable CRDT operation. */
export class KnowledgeStore {
  readonly db = new Database();
  private listeners = new Set<() => void>();
  private deviceId = "";
  private queue: Promise<unknown> = Promise.resolve();
  private channel?: BroadcastChannel;
  private state: Snapshot = {
    docs: [],
    events: [],
    entries: [],
    categories: [],
    topics: [],
    reviews: [],
    ai: defaultAI(),
    device: { ...defaultDevice },
    ready: false,
    revision: 0,
  };
  /** Return the stable snapshot required by React's external-store subscription API. */
  getSnapshot = () => this.state;
  /** Subscribe to committed changes only. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  /** Open storage; a fresh writer identity prevents cross-tab counter reuse. */
  async init() {
    await this.db.open();
    const validate = async () => {
      if ((await this.db.integrity()) !== "ok")
        throw Error("SQLite integrity_check failed");
      const persisted = await this.db.events();
      for (const event of persisted) await validateEnvelope(event);
      assertCausalClosure(persisted);
      validateDocuments(materialize(persisted));
    };
    try {
      await this.db.replayJournal();
      await validate();
    } catch {
      await this.db.recover();
      await this.db.replayJournal();
      await validate();
    }
    await this.db.checkpoint();
    this.deviceId = crypto.randomUUID();
    const device = await this.db.local("device", defaultDevice);
    await this.reload(device);
    this.channel = new BroadcastChannel("zhinexus");
    this.channel.onmessage = () => {
      void this.reload().catch(console.error);
    };
  }
  /** Rebuild the entire projection after importing or committing operations. */
  private async reload(device = this.state.device) {
    this.state = projection(
      await this.db.events(),
      device,
      this.state.revision + 1,
    );
    this.listeners.forEach((fn) => fn());
  }
  /** Serialize commands so a session cannot accidentally reuse its causal counter. */
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const task = this.queue.then(action, action);
    this.queue = task.catch(() => {});
    return task;
  }
  /** Commit one or several patches as a single user action. */
  async batch(
    patches: {
      collection: Collection;
      id: string;
      patch: Record<string, Json>;
    }[],
    source = "manual",
  ) {
    return this.serial(async () => {
      if (!this.deviceId)
        throw Error("数据库尚未初始化 / Storage initialization incomplete");
      const events = await this.db.events(),
        vector = joinVectors(events),
        added: Envelope[] = [];
      for (const p of patches) {
        const seq = (vector[this.deviceId] ?? 0) + 1;
        vector[this.deviceId] = seq;
        const op: Operation = {
          schema: 1,
          device: this.deviceId,
          seq,
          vector: { ...vector },
          collection: p.collection,
          entity: p.id,
          patch: p.patch,
          at: new Date().toISOString(),
          source,
        };
        added.push(await validateEnvelope({ op, hash: await sha256(op) }));
      }
      validateDocuments(materialize([...events, ...added]));
      await this.db.append(added);
      await this.reload();
      this.channel?.postMessage("commit");
    });
  }
  /** Patch an entity; unmentioned fields remain untouched and merge independently. */
  async patch(
    collection: Collection,
    id: string,
    patch: Record<string, Json>,
    source = "manual",
  ) {
    return this.batch([{ collection, id, patch }], source);
  }
  /** Validate an entire incoming batch before persisting its first operation. */
  async ingest(input: unknown[]) {
    const valid: Envelope[] = [];
    for (const e of input) valid.push(await validateEnvelope(e));
    await this.serial(async () => {
      const all = [...(await this.db.events()), ...valid],
        dots = new Map<string, string>();
      for (const e of all) {
        const dot = e.op.device + ":" + e.op.seq;
        const old = dots.get(dot);
        if (old && old !== e.hash) throw Error("设备计数器冲突，已拒绝导入");
        dots.set(dot, e.hash);
      }
      assertCausalClosure(all);
      validateDocuments(materialize(all));
      await this.db.append(valid);
      await this.reload();
      this.channel?.postMessage("commit");
    });
  }
  /** Create a knowledge entry with a due card and explicit capture provenance. */
  async createEntry(
    title: string,
    content = entryTemplate,
    source = "manual",
    category = "",
  ): Promise<string> {
    if (!title.trim()) throw Error("请输入词条名称");
    const id = crypto.randomUUID(),
      now = new Date().toISOString();
    await this.patch(
      "entry",
      id,
      json({
        title: title.trim(),
        content,
        category,
        tags: [],
        prerequisites: [],
        createdAt: now,
        updatedAt: now,
        card: newCard(),
      }) as Record<string, Json>,
      source,
    );
    return id;
  }
  /** Persist provider settings without replicating authentication secrets. */
  async saveAI(ai: AIConfig) {
    await this.patch("setting", "ai", json(ai) as Record<string, Json>);
  }
  /** Persist local credentials and notification preferences separately from syncable data. */
  async saveDevice(device: DeviceConfig) {
    await this.db.setLocal("device", device);
    await this.reload(device);
  }
  /** Load curated examples only when explicitly requested by the user. */
  async seed() {
    if (this.state.entries.length) return;
    const categories = [
      { id: "thinking", name: "思维与认知", parent: "" },
      { id: "technology", name: "技术与科学", parent: "" },
      { id: "language", name: "语言与表达", parent: "" },
    ];
    await this.batch(
      categories.map((c) => ({
        collection: "category",
        id: c.id,
        patch: json(c) as Record<string, Json>,
      })),
    );
    for (const e of [
      {
        title: "费曼学习法",
        category: "thinking",
        content:
          "# 费曼学习法\n\n> 如果不能用简单的语言解释，你可能还没有真正理解。\n\n## 一句话理解\n通过向他人讲解，发现并补齐自己理解中的空白。\n\n## 英文与音标\n**Feynman technique** /ˈfaɪnmən tekˈniːk/\n\n## 四个步骤\n1. 选择一个概念\n2. 用自己的话向初学者解释\n3. 找出卡壳的地方，回到资料补足\n4. 简化语言，加入类比\n\n## 使用案例\n解释“递归”时，不只背定义，试着描述一组套娃如何逐层打开。\n\n## 常见误区\n把流畅复述当成理解。应加入新情境和反例检验。\n\n## 自测\n你能在不使用术语的情况下，向中学生解释一个刚学会的概念吗？",
      },
      {
        title: "间隔重复",
        category: "thinking",
        content:
          "# 间隔重复\n\n## 一句话理解\n在即将遗忘时主动回忆，比集中重复阅读更有助于长期记忆。\n\n## 英文\nSpaced repetition /speɪst ˌrepəˈtɪʃən/\n\n## 标准模型\n记忆保留率可用简化指数模型描述：\n\n$$R(t)=e^{-t/S}$$\n\n这里的 $S$ 表示记忆稳定性。实际排程采用 FSRS，并非固定的“第1、3、7天”。\n\n## 适用边界\n记忆排程不能替代理解；先理解，再练习提取。\n\n## 自测\n为什么“看起来熟悉”不等于“能独立回忆”？",
      },
      {
        title: "Local-first 架构",
        category: "technology",
        content:
          "# Local-first 架构\n\n## 一句话理解\n本地数据是日常读写的中心，网络用于设备之间交换变更。\n\n## 核心原则\n- 离线可用\n- 用户掌握数据\n- 多设备最终一致\n- 并发冲突可追溯\n\n```mermaid\nflowchart LR\n  A[电脑 SQLite] <--> C[WebDAV 日志]\n  B[手机 SQLite] <--> C\n```\n\n## 常见误区\n直接同步整个 SQLite 文件可能覆盖另一台设备的改动。更稳妥的方法是同步不可变操作日志，并在本地合并。\n\n## 前置知识\nSQLite、版本向量、CRDT",
      },
    ])
      await this.createEntry(e.title, e.content, "sample", e.category);
  }
}
export const store = new KnowledgeStore();
