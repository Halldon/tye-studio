import { ApiFailure } from "./errors";
import type { EngineMode } from "./contracts";

export interface EngineConfig { baseUrl: string; mode: EngineMode; apiKey: string | null; local: boolean }
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function isLoopbackHost(host: string): boolean { return LOOPBACK.has(host.toLowerCase()); }
export function localPreviewAllowed(flag: string | undefined, requestUrl: string): boolean {
  return flag === "true" && isLoopbackHost(new URL(requestUrl).hostname);
}
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (isLoopbackHost(host) || h === "::1" || h === "0.0.0.0" || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return true;
  if (h.includes(":")) return true; // Arbitrary IPv6 literals are not remote engine endpoints.
  const octets = h.split(".").map(Number);
  if (octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) || octets[0] >= 224;
  }
  return false;
}
export function engineConfig(bindings: { COMFY_BASE_URL?: string; COMFY_API_KEY?: string }): EngineConfig {
  let url: URL;
  try { url = new URL(bindings.COMFY_BASE_URL?.trim() || "https://cloud.comfy.org"); }
  catch { throw new ApiFailure(503, "engine_configuration", "COMFY_BASE_URL must be a valid engine URL."); }
  if (url.username || url.password || url.search || url.hash) throw new ApiFailure(503, "engine_configuration", "Engine URLs cannot contain credentials, query strings or fragments.");
  const local = isLoopbackHost(url.hostname);
  if (!local && (url.protocol !== "https:" || isPrivateHost(url.hostname))) throw new ApiFailure(503, "engine_configuration", "Remote engine endpoints must use HTTPS and a public hostname.");
  if (local && !["http:", "https:"].includes(url.protocol)) throw new ApiFailure(503, "engine_configuration", "The local engine must use HTTP or HTTPS.");
  const mode: EngineMode = url.hostname === "cloud.comfy.org" ? "cloud-v2" : local && url.port === "8188" ? "local-raw" : local ? "proxy-v2" : "remote-v2";
  return { baseUrl: url.toString().replace(/\/$/, ""), mode, apiKey: bindings.COMFY_API_KEY?.trim() || null, local };
}
/** Only configured engine or known Comfy storage hosts may supply media. No user-supplied remote URLs. */
export function allowedUpstreamUrl(value: string, config: EngineConfig): URL {
  let url: URL;
  try { url = new URL(value, config.baseUrl + "/"); } catch { throw new ApiFailure(502, "unsafe_engine_url", "The engine returned an invalid media URL."); }
  const base = new URL(config.baseUrl);
  if (url.username || url.password || url.hash) throw new ApiFailure(502, "unsafe_engine_url", "The engine returned an unsafe media URL.");
  if (url.origin === base.origin && url.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/")) return url;
  const trusted = url.hostname === "storage.googleapis.com" || url.hostname.endsWith(".storage.googleapis.com") ||
    url.hostname.endsWith(".comfy.org") || url.hostname.endsWith(".comfy.app");
  if (url.protocol !== "https:" || isPrivateHost(url.hostname) || !trusted) throw new ApiFailure(502, "unsafe_engine_url", "The engine returned a media host that is not allowed.");
  return url;
}
export function ownerWhere(ownerId: string, id: string): { sql: string; values: [string, string] } {
  return { sql: "owner_id = ? AND id = ?", values: [ownerId, id] };
}
export function safeFileName(value: string): string {
  return value.replace(/[\u0000-\u001f/\\]/g, "_").replace(/^\.+/, "").slice(0, 180) || "untitled";
}
