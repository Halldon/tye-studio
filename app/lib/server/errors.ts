import type { ApiError } from "./contracts";

export class ApiFailure extends Error {
  status: number;
  code: string;
  retryable: boolean;
  details?: unknown;
  responseHeaders?: Record<string, string>;
  constructor(status: number, code: string, message: string, retryable = false, details?: unknown, responseHeaders?: Record<string, string>) {
    super(message); this.name = "ApiFailure"; this.status = status; this.code = code;
    this.retryable = retryable; this.details = details; this.responseHeaders = responseHeaders;
  }
  publicError(): ApiError { return { code: this.code, message: this.message, retryable: this.retryable, ...(this.details ? { details: this.details } : {}) }; }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiFailure) return Response.json({ error: error.publicError() }, { status: error.status, headers: { "Cache-Control": "no-store", ...error.responseHeaders } });
  const message = error instanceof Error ? error.message : "";
  if (message.includes("no such table")) return Response.json({ error: { code: "storage_not_migrated", message: "The database needs its schema migration. Apply the generated D1 migration, then reload." } }, { status: 503 });
  console.error("Tye Studio server failure", error instanceof Error ? error.name : "unknown");
  return Response.json({ error: { code: "internal_error", message: "The request could not be completed. Please try again." } }, { status: 500 });
}

export async function route(work: () => Promise<Response>): Promise<Response> {
  try { const response = await work(); response.headers.set("Cache-Control", "no-store"); return response; }
  catch (error) { return errorResponse(error); }
}

export async function readJson<T>(request: Request): Promise<T> {
  if (Number(request.headers.get("content-length") || 0) > 1_000_000) throw new ApiFailure(413, "request_too_large", "This document is too large.");
  const reader = request.body?.getReader(); const decoder = new TextDecoder(); const chunks: string[] = []; let size = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 1_000_000) { await reader.cancel(); throw new ApiFailure(413, "request_too_large", "This document is too large."); }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode()); const text = chunks.join("");
  try { const value = JSON.parse(text); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value as T; }
  catch { throw new ApiFailure(400, "invalid_json", "Send a JSON object."); }
}
