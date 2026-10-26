/** Bounded device-local diagnostic records; sanitization happens before records enter memory or storage. */

/** One request or application event, safe to render as plain text and export locally. */
export interface DiagnosticRecord {
  id: string;
  at: string;
  kind: "ai" | "models" | "settings" | "app";
  level: "pending" | "info" | "error";
  task?: string;
  model?: string;
  message: string;
  request?: string;
  response?: string;
  error?: string;
  status?: number;
  durationMs?: number;
}

/** Never store credentials, signed URL queries or large binary payloads in diagnostics. */
export function diagnosticText(value: unknown, secrets: string[] = []): string {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null) value = parsed;
    } catch {
      /* Non-JSON provider text remains visible. */
    }
  }
  let text: string;
  try {
    text =
      value instanceof Error
        ? `${value.name}: ${value.message}${value.stack ? "\n" + value.stack : ""}`
        : typeof value === "string"
          ? value
          : (JSON.stringify(
              value,
              (key, item: unknown) => {
                if (
                  /^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|password|secret|cookie|env|b64_json)$/i.test(
                    key,
                  )
                )
                  return "[redacted]";
                return item;
              },
              2,
            ) ?? String(value));
  } catch {
    text = "[unserializable diagnostic value]";
  }
  for (const secret of [
    ...new Set(
      secrets
        .filter(Boolean)
        .flatMap((s) => [
          s,
          s.trim().replace(/^Bearer\s+/i, ""),
          JSON.stringify(s).slice(1, -1),
          encodeURIComponent(s),
        ]),
    ),
  ]
    .filter((s) => s.length >= 3)
    .sort((a, b) => b.length - a.length))
    text = text.split(secret).join("[redacted]");
  text = text
    .replace(/Bearer\s+[^\s"',;]+/gi, "Bearer [redacted]")
    .replace(
      /data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/g,
      "[image data omitted]",
    )
    .replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
      try {
        const url = new URL(raw);
        return (
          url.origin + url.pathname + (url.search ? "?[query redacted]" : "")
        );
      } catch {
        return "[URL]";
      }
    });
  return text.length > 96000
    ? text.slice(0, 96000) + "\n[truncated after 96000 characters]"
    : text;
}

/** Persistent, capped local journal; logging failures remain visible without breaking completed AI work. */
export class DiagnosticJournal {
  private rows: DiagnosticRecord[] = [];
  private listeners = new Set<() => void>();
  private tail = Promise.resolve();
  private write?: (rows: DiagnosticRecord[]) => Promise<void>;
  storageError = "";
  constructor(private secrets: () => string[] = () => []) {}
  /** Observe immutable snapshots, including pending requests and storage failures. */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  /** Return the last published local record array. */
  getSnapshot = () => this.rows;
  /** Load local records once; historical persisted data is sanitized again with current credentials. */
  async init(
    read: () => Promise<DiagnosticRecord[]>,
    write: (rows: DiagnosticRecord[]) => Promise<void>,
  ) {
    const saved = await read();
    this.write = write;
    this.rows = [
      ...this.rows,
      ...saved.map((row) =>
        this.clean(
          row.level === "pending"
            ? {
                ...row,
                level: "error",
                error:
                  "上次运行已中断，结果未知 / Previous process interrupted; result unknown",
              }
            : row,
        ),
      ),
    ].slice(0, 100);
    this.emit();
  }
  /** Create a local record immediately; a pending request remains visible if the app is interrupted. */
  start(input: Omit<DiagnosticRecord, "id" | "at" | "level">): string {
    const id = crypto.randomUUID();
    this.rows = [
      this.clean({
        ...input,
        id,
        at: new Date().toISOString(),
        level: "pending",
      }),
      ...this.rows,
    ];
    this.changed();
    return id;
  }
  /** Amend one request while retaining its correlation ID and start time. */
  update(id: string, patch: Partial<DiagnosticRecord>) {
    this.rows = this.rows.map((row) =>
      row.id === id ? this.clean({ ...row, ...patch }) : row,
    );
    this.changed();
  }
  /** Record a standalone failure, including configuration and structured-output errors. */
  error(kind: DiagnosticRecord["kind"], message: string, error: unknown) {
    const id = this.start({ kind, message });
    this.update(id, {
      level: "error",
      error: diagnosticText(error, this.secrets()),
    });
  }
  /** Wait for queued local writes; no diagnostic records are replicated. */
  flush = async () => {
    await this.tail;
    if (this.storageError) throw Error(this.storageError);
  };
  /** Clear only after the caller has received confirmation and persistence succeeds. */
  async clear() {
    await this.tail;
    await this.write?.([]);
    this.rows = [];
    this.storageError = "";
    this.emit();
  }
  private clean(row: DiagnosticRecord): DiagnosticRecord {
    return Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        typeof v === "string" ? diagnosticText(v, this.secrets()) : v,
      ]),
    ) as unknown as DiagnosticRecord;
  }
  private emit() {
    this.rows = [...this.rows];
    for (const fn of this.listeners) fn();
  }
  private changed() {
    let size = 0;
    this.rows = this.rows.filter((row, i) => {
      size += new TextEncoder().encode(JSON.stringify(row)).byteLength;
      return i < 100 && size <= 4 * 1024 * 1024;
    });
    this.emit();
    if (!this.write) return;
    const rows = this.rows;
    this.tail = this.tail
      .then(() => this.write!(rows))
      .then(
        () => {
          const hadError = !!this.storageError;
          this.storageError = "";
          if (hadError) this.emit();
        },
        (e) => {
          this.storageError = diagnosticText(e, this.secrets());
          this.emit();
        },
      );
  }
}
