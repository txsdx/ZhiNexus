/** Durable AI queue state, interrupted-run recovery and review approvals independent of React pages. */
import type { AIJob, AIJobContext, AIStage, NewAIJob } from "./ai-jobs";
import type { Json, Task } from "./types";
import { AIConcurrency } from "./concurrency";
/** Storage receives the current device-only queue; implementations must commit before acknowledging removal. */
export interface AIQueueStorage {
  load(): Promise<AIJob[]>;
  save(jobs: AIJob[]): Promise<void>;
}
/** Work implementations are registered by the application service and reconstructed explicitly for retry. */
export type AIExecutor = (job: AIJob, context: AIJobContext) => Promise<Json>;
/** Pending results survive navigation/restart; restarting never silently replays unknown external actions. */
export class AIQueue {
  readonly limiter = new AIConcurrency();
  private rows: AIJob[] = [];
  private snapshot = {
    jobs: [] as AIJob[],
    storageError: "",
    ready: false,
    readOnly: false,
  };
  private listeners = new Set<() => void>();
  private controllers = new Map<string, AbortController>();
  private approvals = new Map<string, (yes: boolean) => void>();
  private removing = new Set<string>();
  private tail: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private emitTimer?: ReturnType<typeof setTimeout>;
  private initialized = false;
  private blocked = false;
  private lanes = new Map<string, Promise<void>>();
  constructor(
    private storage: AIQueueStorage,
    private execute: AIExecutor,
    private errorText: (error: unknown) => string = String,
    private autoClear: (job: AIJob) => boolean = () => false,
  ) {}
  /** Stable snapshots allow subscriptions without rerender loops. */
  getSnapshot = () => this.snapshot;
  /** Subscribe to queue states and streamed response snapshots. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  /** Load validated rows; interrupted work remains visible and requires explicit retry. */
  async init(readOnly = false) {
    if (this.initialized) return;
    try {
      this.rows = (await this.storage.load()).map((job) =>
        !readOnly && ["queued", "running", "approval"].includes(job.state)
          ? {
              ...job,
              state: "error" as const,
              approval: undefined,
              error:
                "任务在上次退出时中断；请检查结果后重试 / Interrupted on exit; inspect before retry",
            }
          : job,
      );
      this.initialized = true;
      this.snapshot = {
        ...this.snapshot,
        readOnly,
        storageError: readOnly
          ? "AI 任务由另一个窗口处理；请到该窗口操作，或关闭后重新加载 / AI tasks belong to another window; switch to it or close it and reload"
          : "",
      };
      this.emit();
      if (!readOnly) {
        await this.flush();
        for (const job of [...this.rows])
          if (job.state === "review" && this.autoClear(job))
            await this.remove(job.id).catch(() => {});
      }
    } catch (error) {
      this.blocked = true;
      this.initialized = true;
      this.snapshot = {
        ...this.snapshot,
        jobs: this.rows,
        ready: true,
        storageError: this.errorText(error),
      };
      this.listeners.forEach((fn) => fn());
    }
  }
  /** Save queued input before starting a provider request. */
  async submit(input: NewAIJob) {
    this.assertWritable();
    if (this.rows.length >= 100)
      throw Error(
        "AI 队列已有 100 项，请先审阅或清理 / Review queued work before adding more",
      );
    const now = new Date().toISOString();
    const job: AIJob = {
      ...structuredClone(input),
      id: crypto.randomUUID(),
      state: "queued",
      stages: [],
      error: "",
      createdAt: now,
      updatedAt: now,
    };
    this.rows = [...this.rows, job];
    this.emit();
    try {
      await this.flush();
      this.launch(job.id);
    } catch (error) {
      this.change(job.id, {
        state: "error",
        error:
          "任务尚未启动，队列保存失败 / Queue was not saved; request not started",
      });
      throw error;
    }
    return job.id;
  }
  /** Retry only on explicit action; already-applied receipts are handled by the workflow service. */
  async retry(id: string) {
    this.assertWritable();
    const job = this.find(id);
    if (!["error", "cancelled"].includes(job.state) || this.controllers.has(id))
      return;
    this.change(id, {
      state: "queued",
      error: "",
      approval: undefined,
      result: undefined,
      stages: [],
    });
    await this.flush();
    this.launch(id);
  }
  /** Stop queued/active work and retain its partial output until reviewed or explicitly discarded. */
  async cancel(id: string) {
    this.assertWritable();
    if (!this.rows.some((j) => j.id === id)) return;
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    this.approvals.get(id)?.(false);
    this.approvals.delete(id);
    this.change(id, { state: "cancelled", approval: undefined, error: "" });
    await this.flush();
  }
  /** Persist an approval before releasing the corresponding external tool action. */
  async decide(id: string, yes: boolean) {
    this.assertWritable();
    const job = this.find(id);
    if (job.state !== "approval") return;
    const description = job.approval;
    this.change(id, { state: "running", approval: undefined });
    try {
      await this.flush();
    } catch (error) {
      this.change(id, { state: "approval", approval: description });
      throw error;
    }
    this.approvals.get(id)?.(yes);
    this.approvals.delete(id);
  }
  /** Remove only after a successful metadata write; failures keep the task available for recovery. */
  async remove(id: string) {
    this.assertWritable();
    if (this.controllers.has(id))
      throw Error("请先停止正在执行的任务 / Stop the active task first");
    this.removing.add(id);
    try {
      await this.flush();
      this.rows = this.rows.filter((j) => j.id !== id);
      this.emit();
    } finally {
      this.removing.delete(id);
    }
  }
  /** Persist each accepted snapshot in order while taking current rows at execution, avoiding stale reinsertion. */
  flush = async () => {
    if (this.snapshot.readOnly) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.blocked) throw Error(this.snapshot.storageError);
    const task = this.tail.then(() =>
      this.storage.save(
        structuredClone(this.rows.filter((j) => !this.removing.has(j.id))),
      ),
    );
    this.tail = task.catch(() => {});
    try {
      await task;
      if (this.snapshot.storageError) {
        this.snapshot = { ...this.snapshot, storageError: "" };
        this.emit();
      }
    } catch (error) {
      this.snapshot = { ...this.snapshot, storageError: this.errorText(error) };
      this.listeners.forEach((fn) => fn());
      throw error;
    }
  };
  /** Read a committed queue item or reject a deleted/stale control. */
  find(id: string) {
    const row = this.rows.find((j) => j.id === id);
    if (!row) throw Error("任务已移除 / Task no longer exists");
    return row;
  }
  /** Persist user edits to a completed proposal without changing its original provider response. */
  editReview(id: string, value: Json) {
    this.assertWritable();
    if (this.find(id).state !== "review") return;
    this.change(id, { reviewData: value });
  }
  /** Prevent competing browser windows from overwriting work or exceeding the device's request limit. */
  assertWritable() {
    if (!this.initialized)
      throw Error("AI 队列尚未初始化 / AI queue not ready");
    if (this.blocked || this.snapshot.readOnly)
      throw Error(this.snapshot.storageError);
  }
  /** Mirror durable records in a follower window without restarting or acknowledging active work. */
  async refreshReadOnly() {
    if (!this.snapshot.readOnly) return;
    try {
      this.rows = await this.storage.load();
      this.emit();
    } catch (error) {
      this.snapshot = { ...this.snapshot, storageError: this.errorText(error) };
      this.listeners.forEach((fn) => fn());
    }
  }
  private change(id: string, patch: Partial<AIJob>, stream = false) {
    this.rows = this.rows.map((j) =>
      j.id === id ? { ...j, ...patch, updatedAt: new Date().toISOString() } : j,
    );
    if (stream) {
      if (!this.emitTimer)
        this.emitTimer = setTimeout(() => {
          this.emitTimer = undefined;
          this.emit();
        }, 50);
    } else this.emit();
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush().catch(() => {});
      }, 350);
  }
  private emit() {
    this.snapshot = {
      ...this.snapshot,
      jobs: this.rows,
      ready: this.initialized,
    };
    this.listeners.forEach((fn) => fn());
  }
  private launch(id: string) {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const initial = this.find(id);
    const lane = initial.kind === "chat" ? initial.target.topicId : undefined;
    const previous = lane ? this.lanes.get(lane) : undefined;
    let run!: Promise<void>;
    run = (async () => {
      try {
        if (previous)
          await Promise.race([
            previous.catch(() => {}),
            new Promise<never>((_, reject) =>
              controller.signal.addEventListener(
                "abort",
                () => reject(controller.signal.reason),
                { once: true },
              ),
            ),
          ]);
        controller.signal.throwIfAborted();
        const check = () => {
          controller.signal.throwIfAborted();
          if (this.controllers.get(id) !== controller)
            throw new DOMException("Aborted", "AbortError");
        };
        const context: AIJobContext = {
          signal: controller.signal,
          check,
          request: async <T>(
            task: Task,
            work: (progress: (stage: Partial<AIStage>) => void) => Promise<T>,
          ) => {
            check();
            const stage: AIStage = {
              task,
              model: "",
              content: "",
              reasoning: "",
              calls: [],
              streaming: true,
              finished: false,
            };
            const index = this.find(id).stages.length;
            this.change(id, {
              state: "queued",
              stages: [...this.find(id).stages, stage],
            });
            return this.limiter.run(
              controller.signal,
              () => {
                check();
                this.change(id, { state: "running" });
              },
              async () => {
                const progress = (patch: Partial<AIStage>) => {
                  check();
                  const stages = [...this.find(id).stages];
                  stages[index] = { ...stages[index], ...patch };
                  this.change(id, { stages }, true);
                };
                const result = await work(progress);
                check();
                progress({ finished: true });
                return result;
              },
            );
          },
          confirm: async (description: string) => {
            check();
            this.change(id, { state: "approval", approval: description });
            await this.flush();
            check();
            return new Promise<boolean>((resolve, reject) => {
              this.approvals.set(id, resolve);
              controller.signal.addEventListener(
                "abort",
                () => {
                  this.approvals.delete(id);
                  reject(controller.signal.reason);
                },
                { once: true },
              );
            });
          },
        };
        const result = await this.execute(this.find(id), context);
        check();
        this.change(id, {
          state: "review",
          result,
          approval: undefined,
          error: "",
        });
        this.controllers.delete(id);
        await this.flush().catch(() => {});
        if (this.autoClear(this.find(id)))
          await this.remove(id).catch(() => {});
      } catch (error) {
        if (this.controllers.get(id) === controller) {
          this.controllers.delete(id);
          this.approvals.delete(id);
          this.change(id, {
            state: controller.signal.aborted ? "cancelled" : "error",
            approval: undefined,
            error: controller.signal.aborted ? "" : this.errorText(error),
          });
          await this.flush().catch(() => {});
        }
      } finally {
        if (lane && this.lanes.get(lane) === run) this.lanes.delete(lane);
      }
    })();
    if (lane) this.lanes.set(lane, run);
  }
}
