import { ApiFailure } from "./errors";

function encode(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export function credentialStorageReady(value: string | undefined): boolean {
  try { return !!value && decode(value).byteLength === 32; } catch { return false; }
}
export function validateApiKey(value: unknown): string {
  if (typeof value !== "string") throw new ApiFailure(400, "invalid_api_key", "Enter a valid Comfy API key.");
  const key = value.trim();
  if (key.length < 8 || key.length > 512 || /[\s\u0000-\u001f]/.test(key)) throw new ApiFailure(400, "invalid_api_key", "Enter a valid Comfy API key.");
  return key;
}
async function cryptoKey(secret: string): Promise<CryptoKey> {
  if (!credentialStorageReady(secret)) throw new ApiFailure(503, "credential_storage_not_configured", "Secure credential storage is not configured. This connection can be used for this session only.");
  return crypto.subtle.importKey("raw", decode(secret) as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptCredential(apiKey: string, userId: string, secret: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await cryptoKey(secret);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(userId), tagLength: 128 }, key, new TextEncoder().encode(validateApiKey(apiKey)));
  return { ciphertext: encode(new Uint8Array(ciphertext)), iv: encode(iv) };
}
export async function decryptCredential(record: { ciphertext: string; iv: string }, userId: string, secret: string): Promise<string> {
  try {
    const key = await cryptoKey(secret); const iv = decode(record.iv); if (iv.byteLength !== 12) throw new Error("Invalid IV");
    const result = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(userId), tagLength: 128 }, key, decode(record.ciphertext) as BufferSource);
    return validateApiKey(new TextDecoder().decode(result));
  } catch { throw new ApiFailure(503, "saved_connection_unavailable", "Your saved connection could not be decrypted. Reconnect with your Comfy API key."); }
}
export async function savedCredential(db: D1Database, userId: string): Promise<{ ciphertext: string; iv: string } | null> {
  return db.prepare("SELECT ciphertext, iv FROM studio_credentials WHERE user_id = ?").bind(userId).first<{ ciphertext: string; iv: string }>();
}
export async function saveCredential(db: D1Database, userId: string, apiKey: string, secret: string): Promise<void> {
  const encrypted = await encryptCredential(apiKey, userId, secret);
  await db.prepare("INSERT INTO studio_credentials (user_id,ciphertext,iv,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,updated_at=excluded.updated_at").bind(userId, encrypted.ciphertext, encrypted.iv, new Date().toISOString()).run();
}
export async function forgetCredential(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM studio_credentials WHERE user_id = ?").bind(userId).run();
}
