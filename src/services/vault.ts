/** Explicit encrypted credential replication; vault passphrases never enter SQLite, logs or network requests. */
import { z } from "zod";
import { store, json } from "../core/store";
import { encryptBackup, decryptBackup } from "../core/crypto";
import { secureUrl, serviceUrl } from "./network";
const credentialsSchema = z.object({
  apiKey: z.string(),
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
/** Publish a versioned ciphertext as a normal replicated CRDT document. */
export async function sealCredentials(passphrase: string) {
  const { device } = store.getSnapshot();
  const credentials = {
    apiKey: device.apiKey,
    davUrl: device.davUrl,
    davUser: device.davUser,
    davPassword: device.davPassword,
    mcp: device.mcp,
  };
  const cipher = await encryptBackup(json(credentials), passphrase);
  await store.patch(
    "setting",
    "credential-vault",
    { cipher, updatedAt: new Date().toISOString() },
    "encrypted-vault",
  );
}
/** Authenticate and validate before replacing only credential fields, preserving device reminder preferences. */
export async function unlockCredentials(passphrase: string) {
  const vault = store
    .getSnapshot()
    .docs.find(
      (d) => d.collection === "setting" && d.id === "credential-vault",
    );
  if (typeof vault?.fields.cipher !== "string")
    throw Error("尚未下载凭证保险箱，请先同步 / Sync a credential vault first");
  const credentials = credentialsSchema.parse(
    await decryptBackup(vault.fields.cipher, passphrase),
  );
  if (credentials.davUrl) secureUrl(credentials.davUrl);
  for (const m of credentials.mcp) {
    if (m.transport !== "stdio" && m.url) serviceUrl(m.url);
    if (m.transport === "stdio") {
      const local = store
        .getSnapshot()
        .device.mcp.find((x) => x.id === m.id && x.transport === "stdio");
      m.enabled = Boolean(
        local?.enabled &&
        JSON.stringify([local.command, local.args, local.env, local.cwd]) ===
          JSON.stringify([m.command, m.args, m.env, m.cwd]),
      );
    }
  }
  await store.saveDevice({ ...store.getSnapshot().device, ...credentials });
}
