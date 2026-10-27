/** Shared encrypted credential payloads and the local-program consent boundary. */
import { z } from "zod";
import type { DeviceConfig, McpConfig } from "./types";

/** Connection credentials synchronized together with the endpoint-bound AI key. */
export const connectionCredentials = z.object({
  davUrl: z.string(),
  davUser: z.string(),
  davPassword: z.string(),
  mcp: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      url: z.string(),
      enabled: z.boolean(),
      token: z.string(),
      transport: z.enum(["http", "sse", "stdio"]).optional(),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      env: z.record(z.string(), z.string()).optional(),
      cwd: z.string().optional(),
    }),
  ),
});

/** Preserve the original endpoint-bound API-key payload. */
export const synchronizedCredentials = z.object({
  apiKey: z.string(),
  baseUrl: z.string(),
});

/** Select only shared credentials; reminder, proxy and scheduling preferences stay on this device. */
export function connectionsFrom(
  device: DeviceConfig,
): z.infer<typeof connectionCredentials> {
  return {
    davUrl: device.davUrl,
    davUser: device.davUser,
    davPassword: device.davPassword,
    mcp: device.mcp,
  };
}

/** Downloading a program configuration never grants permission to execute it locally. */
export function importedConnections(
  value: z.infer<typeof connectionCredentials>,
  local: McpConfig[],
) {
  return {
    ...value,
    mcp: value.mcp.map((m) => {
      if (m.transport !== "stdio") return m;
      const existing = local.find(
        (x) => x.id === m.id && x.transport === "stdio",
      );
      return {
        ...m,
        enabled: Boolean(
          existing?.enabled &&
          JSON.stringify([
            existing.command,
            existing.args,
            existing.env,
            existing.cwd,
          ]) === JSON.stringify([m.command, m.args, m.env, m.cwd]),
        ),
      };
    }),
  };
}
