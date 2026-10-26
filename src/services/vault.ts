/** Explicit encrypted credential replication; vault passphrases never enter SQLite, logs or network requests. */
import { z } from "zod";
import { store, json } from "../core/store";
import { encryptBackup, decryptBackup } from "../core/crypto";
import { secureUrl } from "./network";
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
  for (const m of credentials.mcp) if (m.url) secureUrl(m.url);
  await store.saveDevice({ ...store.getSnapshot().device, ...credentials });
}
