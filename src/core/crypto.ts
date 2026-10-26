/** Canonical encoding, SHA-256 addressing, Merkle roots and authenticated encrypted backups. */
import type { Json } from "./types";
/** Produce a stable representation independent of property insertion order. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
/** Hash either immutable bytes or canonical JSON. */
export async function sha256(value: unknown): Promise<string> {
  const bytes =
    value instanceof Uint8Array
      ? value
      : new TextEncoder().encode(canonical(value));
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as BufferSource),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Reduce sorted leaf hashes into a deterministic binary Merkle tree. */
export async function merkle(hashes: string[]): Promise<string> {
  let level = [...new Set(hashes)].sort();
  if (!level.length) return sha256([]);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(await sha256([level[i], level[i + 1] ?? level[i]]));
    level = next;
  }
  return level[0];
}
/** Encode binary data without exceeding the JavaScript argument limit. */
export function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
/** Decode the portable binary representation used in backups. */
export function unbase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
/** Derive a non-exportable AES key from a user supplied backup passphrase. */
async function key(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 310000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
/** Encrypt an entire portable archive, including local credentials, before export. */
export async function encryptBackup(
  data: Json,
  password: string,
): Promise<string> {
  if (password.length < 12)
    throw Error("备份密码至少 12 位 / Minimum 12 characters");
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(password, salt),
    new TextEncoder().encode(canonical(data)),
  );
  return JSON.stringify({
    format: "zhinexus-encrypted-v1",
    salt: base64(salt),
    iv: base64(iv),
    data: base64(new Uint8Array(bytes)),
  });
}
/** Authenticate a backup before parsing any of its contents. */
export async function decryptBackup(
  text: string,
  password: string,
): Promise<unknown> {
  const v = JSON.parse(text);
  if (v.format !== "zhinexus-encrypted-v1") throw Error("不支持的备份格式");
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unbase64(v.iv) as BufferSource },
    await key(password, unbase64(v.salt)),
    unbase64(v.data) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(bytes));
}
