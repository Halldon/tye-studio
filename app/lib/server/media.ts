import type { MediaType } from "./contracts";
import { ApiFailure } from "./errors";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 40 * 1024 * 1024;
/** Normalize the single range browsers use for video seeking, including suffix ranges. */
export function byteRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (header === null) return null;
  const invalid = () => new ApiFailure(416, "invalid_range", "This byte range is not available.", false, undefined, { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" });
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(size) || size <= 0) throw invalid();
  if (!match[1]) {
    const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) throw invalid();
    const length = Math.min(suffix, size); return { offset: size - length, length };
  }
  const offset = Number(match[1]); const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(end) || offset >= size || end < offset) throw invalid();
  return { offset, length: Math.min(end, size - 1) - offset + 1 };
}
export async function boundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("Content-Length") || 0);
  if (declared > maxBytes) { await response.body?.cancel(); throw new ApiFailure(413, "media_too_large", `Media exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`); }
  if (!response.body) throw new ApiFailure(502, "empty_media", "No media bytes were returned.");
  // Known-length storage responses need one allocation rather than retaining chunks plus a second full copy.
  const buffer = Number.isSafeInteger(declared) && declared > 0 ? new Uint8Array(declared) : null;
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new ApiFailure(413, "media_too_large", `Media exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`); }
    if (buffer) {
      if (size > buffer.byteLength) { await reader.cancel(); throw new ApiFailure(502, "invalid_media_length", "The media server returned more bytes than it declared."); }
      buffer.set(value, size - value.byteLength);
    } else chunks.push(value);
  }
  if (!size) throw new ApiFailure(400, "empty_media", "This file is empty.");
  if (buffer) return buffer.subarray(0, size);
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export function inspectMedia(bytes: Uint8Array): { type: MediaType; mimeType: string; width: number | null; height: number | null } {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, 4) === "PNG" && ascii(12, 16) === "IHDR") return { type: "image", mimeType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length > 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let at = 2;
    while (at + 8 < bytes.length) {
      if (bytes[at] !== 255) break;
      const marker = bytes[at + 1]; if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return { type: "image", mimeType: "image/jpeg", width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
      const length = view.getUint16(at + 2); if (length < 2) break; at += length + 2;
    }
    return { type: "image", mimeType: "image/jpeg", width: null, height: null };
  }
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { type: "image", mimeType: "image/webp", width: null, height: null };
  if (bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) return { type: "image", mimeType: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") return { type: "video", mimeType: "video/mp4", width: null, height: null };
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { type: "video", mimeType: "video/webm", width: null, height: null };
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return { type: "audio", mimeType: "audio/wav", width: null, height: null };
  if (ascii(0, 3) === "ID3" || (bytes.length > 2 && bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)) return { type: "audio", mimeType: "audio/mpeg", width: null, height: null };
  if (ascii(0, 4) === "OggS") return { type: "audio", mimeType: "audio/ogg", width: null, height: null };
  throw new ApiFailure(415, "unsupported_media", "Use a PNG, JPEG, WebP, GIF, MP4, WebM, MP3, WAV or OGG file. SVG and executable files are not accepted.");
}
