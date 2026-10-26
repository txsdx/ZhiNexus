/** Convenient AES-GCM wrapping for local API credentials and shared encrypted API-key records. */
import { base64, unbase64 } from "./crypto";
import type { DeviceConfig } from "./types";
/** Public application key by user choice: obfuscation for a private sync directory, not a secret shipped separately. */
const BUILTIN_KEY =
  "ZhiNexus/private-webdav/convenience-key/v1/7ff612eb510345608bfc23af06d51bc6";
const keys = new Map<string, Promise<CryptoKey>>();
/** Derive a stable domain-separated key; IVs are freshly randomized on every encryption. */
function keyFor(purpose: string, customKey = ""): Promise<CryptoKey> {
  const material = `${purpose}\0${customKey || BUILTIN_KEY}`;
  if (!keys.has(material))
    keys.set(
      material,
      (async () => {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(material),
        );
        return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
          "encrypt",
          "decrypt",
        ]);
      })(),
    );
  return keys.get(material)!;
}
/** Encrypt a serializable credential value without persisting cleartext or deterministic ciphertext. */
export async function encryptSecret(
  value: unknown,
  purpose: string,
  customKey = "",
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await keyFor(purpose, customKey),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return JSON.stringify({
    v: 1,
    iv: base64(iv),
    data: base64(new Uint8Array(data)),
  });
}
/** Authenticate encrypted values and reject unsupported or damaged records without clearing the original. */
export async function decryptSecret<T>(
  cipher: string,
  purpose: string,
  customKey = "",
): Promise<T> {
  const record = JSON.parse(cipher);
  if (
    record.v !== 1 ||
    typeof record.iv !== "string" ||
    typeof record.data !== "string" ||
    cipher.length > 1024 * 1024
  )
    throw Error("密钥记录格式无效 / Invalid secret envelope");
  const iv = unbase64(record.iv),
    data = unbase64(record.data);
  if (iv.length !== 12) throw Error("密钥记录校验失败 / Invalid secret IV");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as Uint8Array<ArrayBuffer> },
    await keyFor(purpose, customKey),
    data as Uint8Array<ArrayBuffer>,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
/** Only runtime projections contain clear API keys; SQLite and its recovery journal receive this wrapped form. */
export async function encodeDevice(
  device: DeviceConfig | Record<string, unknown>,
) {
  const value =
    "secretsCipher" in device
      ? await decodeDevice(device)
      : (device as DeviceConfig);
  const { apiKey, apiKeySyncKey = "", ...publicFields } = value;
  return {
    ...publicFields,
    apiKey: "",
    secretsCipher: await encryptSecret(
      { apiKey, apiKeySyncKey },
      "local-device",
    ),
  };
}
/** Load either an existing development device record or its authenticated wrapped replacement. */
export async function decodeDevice(
  raw: Record<string, unknown>,
): Promise<DeviceConfig> {
  const { secretsCipher, ...fields } = raw;
  if (typeof secretsCipher !== "string")
    return fields as unknown as DeviceConfig;
  const secrets = await decryptSecret<{
    apiKey: string;
    apiKeySyncKey: string;
  }>(secretsCipher, "local-device");
  if (
    typeof secrets.apiKey !== "string" ||
    typeof secrets.apiKeySyncKey !== "string"
  )
    throw Error("本机密钥记录无效 / Invalid local credentials");
  return { ...fields, ...secrets } as unknown as DeviceConfig;
}
