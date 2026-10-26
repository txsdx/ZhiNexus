/** Official MCP SDK transports sharing the application network policy and an owned native stdio bridge. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  JSONRPCMessageSchema,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { invoke } from "@tauri-apps/api/core";
import { native } from "../core/database";
import type { McpConfig } from "../core/types";
import { request, serviceUrl } from "./network";
import { version } from "../../package.json";
/** Adapt the official public Transport interface to bounded Rust process sessions, without shell execution. */
class NativeStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private id = "";
  private closed = false;
  constructor(private config: McpConfig) {}
  /** Start only a locally enabled desktop executable configuration. */
  async start() {
    if (!native || /Android/i.test(navigator.userAgent))
      throw Error("stdio MCP 仅支持桌面客户端 / Desktop only");
    if (!this.config.enabled) throw Error("MCP 尚未启用 / MCP is disabled");
    this.id = await invoke<string>("mcp_start", {
      config: {
        command: this.config.command ?? "",
        args: this.config.args ?? [],
        env: this.config.env ?? {},
        cwd: this.config.cwd || null,
      },
    });
    void this.read();
  }
  /** Poll until EOF or closure; malformed protocol data terminates only this connection. */
  private async read() {
    try {
      while (!this.closed) {
        const frame = await invoke<{
          idle?: boolean;
          closed?: boolean;
          message?: string;
        }>("mcp_next", { id: this.id });
        if (this.closed) return;
        if (frame.closed) {
          await this.close();
          return;
        }
        if (frame.message)
          this.onmessage?.(
            JSONRPCMessageSchema.parse(JSON.parse(frame.message)),
          );
      }
    } catch (error) {
      if (!this.closed)
        this.onerror?.(error instanceof Error ? error : Error(String(error)));
      await this.close();
    }
  }
  /** Send serialized JSON-RPC through the directly owned child's stdin. */
  async send(message: JSONRPCMessage) {
    if (this.closed || !this.id) throw Error("MCP session is closed");
    await invoke("mcp_send", { id: this.id, message: JSON.stringify(message) });
  }
  /** Close is idempotent, releases the native process and wakes pending reads. */
  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.id) await invoke("mcp_close", { id: this.id });
    } finally {
      this.onclose?.();
    }
  }
}
/** Connect HTTP, legacy SSE or desktop stdio with the maintained SDK's public APIs. */
export async function connectMcp(config: McpConfig) {
  const client = new Client({ name: "ZhiNexus", version });
  let transport: Transport;
  if (config.transport === "stdio")
    transport = new NativeStdioTransport(config);
  else {
    const url = serviceUrl(config.url);
    const headers: Record<string, string> = config.token
      ? { Authorization: `Bearer ${config.token}` }
      : {};
    const options = {
      requestInit: { headers },
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        request(input, init, 0),
    };
    transport =
      config.transport === "sse"
        ? new SSEClientTransport(url, {
            ...options,
            eventSourceInit: { fetch: options.fetch },
          })
        : new StreamableHTTPClientTransport(url, options);
  }
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await transport.close().catch(() => {});
    throw error;
  }
}
