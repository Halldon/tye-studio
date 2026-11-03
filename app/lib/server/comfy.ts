import { ComfyLow } from "@comfyorg/sdk/low";
import type { ApiError, EngineStatus, JobStatus, Recipe } from "./contracts";
import { ApiFailure } from "./errors";
import type { Graph } from "./recipes";
import { publicRecipe, RECIPES } from "./recipes";
import { allowedUpstreamUrl, engineConfig, type EngineConfig } from "./security";
import { eligibilityBlock } from "./eligibility";

type Json = Record<string, unknown>;
export interface EngineOutput { id: string; name: string; url: string; mimeType?: string }
export interface EngineJob { id: string; status: JobStatus; progress: number | null; stage: string | null; outputs: EngineOutput[]; error: ApiError | null }
export interface Discovery { status: EngineStatus; chosen: Record<string, Record<string, string>> }

/** Redirects and cross-origin credentials are controlled even inside the SDK transport. */
export async function guardedFetch(config: EngineConfig, input: RequestInfo | URL, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<Response> {
  let url = allowedUpstreamUrl(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, config);
  for (let redirects = 0; redirects < 5; redirects++) {
    const headers = new Headers(init.headers);
    if (url.origin !== new URL(config.baseUrl).origin) { headers.delete("Authorization"); headers.delete("X-API-Key"); }
    const response = await fetcher(url.toString(), { ...init, headers, redirect: "manual", signal: init.signal || AbortSignal.timeout(25000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("Location");
    if (!location || !["GET", "HEAD"].includes((init.method || "GET").toUpperCase())) return response;
    await response.body?.cancel(); url = allowedUpstreamUrl(new URL(location, url).href, config);
  }
  throw new ApiFailure(502, "engine_redirect_loop", "The media server redirected too many times.");
}

async function parseResponse(response: Response, config: EngineConfig): Promise<Json> {
  let json: Json = {};
  try { json = await response.json() as Json; } catch { /* Non-JSON upstream errors are handled without forwarding HTML. */ }
  if (!response.ok) {
    const upstream = json.error && typeof json.error === "object" ? json.error as Json : json;
    const raw = upstream.message || upstream.detail || json.message || json.detail || (typeof json.error === "string" ? json.error : "");
    const message = (typeof raw === "string" ? raw : JSON.stringify(raw)).split(config.apiKey || "\u0000").join("[redacted]").slice(0, 700);
    const code = String(upstream.code || upstream.error_type || json.error_type || "engine_" + response.status).split(config.apiKey || "\u0000").join("[redacted]").slice(0, 100);
    const block = eligibilityBlock(response.status, code, message);
    const messages: Record<number, string> = {
      401: "Comfy rejected the API key. Reconnect with a valid key.",
      402: "Comfy reports insufficient API credits. Browser free runs do not establish API eligibility.",
      403: message || (block === "api-access" ? "Comfy denied API access for this account or key." : "Comfy refused this workflow (403)."),
      404: "The engine endpoint or job was not found.",
      429: "The engine queue or request limit is full. Wait before submitting another run.",
    };
    const details = { provider: { status: response.status, code, ...(block ? { eligibilityReason: block } : {}) }, ...(json.node_errors ? { nodeErrors: JSON.stringify(json.node_errors).split(config.apiKey || "\u0000").join("[redacted]").slice(0, 6000) } : {}) };
    throw new ApiFailure(response.status >= 500 ? 502 : response.status, code, messages[response.status] || message || "The engine could not process this workflow.", false, details);
  }
  return json;
}

export class ComfyAdapter {
  config: EngineConfig;
  private low: ComfyLow;
  constructor(config: EngineConfig) {
    this.config = config;
    // The low SDK is Fetch-based and retry-free. The top-level SDK's Node file factories are not used in Workers.
    this.low = new ComfyLow(config.baseUrl, config.apiKey || undefined, { fetch: ((input, init) => guardedFetch(config, input, init)) as typeof fetch, timeoutMs: 25000, clientInfo: "tye-studio" });
  }
  private async request(path: string, method = "GET", data?: unknown, form?: FormData): Promise<Json> {
    const response = this.config.mode === "local-raw"
      ? await guardedFetch(this.config, this.config.baseUrl + path, { method, headers: { ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}), ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : form ? { body: form } : {}) })
      : await this.low.request(method, path, { ...(data ? { json: data } : {}), ...(form ? { body: form } : {}), redirect: "manual" });
    return parseResponse(response, this.config);
  }
  async upload(bytes: Uint8Array, name: string, mimeType: string): Promise<unknown> {
    const form = new FormData();
    if (this.config.mode === "local-raw") {
      form.append("image", new Blob([bytes as BlobPart], { type: mimeType }), name); form.append("type", "input"); form.append("overwrite", "false");
      const result = await this.request("/upload/image", "POST", undefined, form);
      if (typeof result.name !== "string") throw new ApiFailure(502, "invalid_engine_response", "The engine did not return an uploaded filename.");
      return [result.subfolder, result.name].filter(Boolean).join("/");
    }
    // Comfy v2 requires metadata before file in multipart order.
    form.append("content_type", mimeType); form.append("file_path", name); form.append("file", new Blob([bytes as BlobPart], { type: mimeType }), name);
    const result = await this.request("/assets", "POST", undefined, form);
    if (typeof result.id !== "string") throw new ApiFailure(502, "invalid_engine_response", "The engine did not return an uploaded asset.");
    return { __type: "core/ASSET", info: { id: result.id } };
  }
  async submit(graph: Graph, idempotencyKey: string): Promise<EngineJob> {
    if (this.config.mode === "local-raw") {
      const result = await this.request("/prompt", "POST", { prompt: graph, client_id: idempotencyKey, extra_data: { tye_job_id: idempotencyKey } });
      if (typeof result.prompt_id !== "string") throw new ApiFailure(502, "invalid_engine_response", "The engine did not confirm a job ID.");
      return { id: result.prompt_id, status: "queued", progress: null, stage: "Queued", outputs: [], error: null };
    }
    const response = await this.low.request("POST", "/jobs", { json: { workflow: graph }, headers: { "Idempotency-Key": idempotencyKey }, redirect: "manual" });
    return normalizeV2Job(await parseResponse(response, this.config), this.config.apiKey);
  }
  async reconcile(id: string): Promise<EngineJob> {
    if (this.config.mode !== "local-raw") return normalizeV2Job(await this.request(`/jobs/${encodeURIComponent(id)}`), this.config.apiKey);
    const history = await this.request(`/history/${encodeURIComponent(id)}`);
    const found = history[id] as Json | undefined;
    if (found) return normalizeRawJob(id, found, this.config.baseUrl);
    const queue = await this.request("/queue");
    const running = Array.isArray(queue.queue_running) && queue.queue_running.some((entry) => Array.isArray(entry) && entry[1] === id);
    const pending = Array.isArray(queue.queue_pending) && queue.queue_pending.some((entry) => Array.isArray(entry) && entry[1] === id);
    if (!running && !pending) throw new ApiFailure(404, "engine_job_missing", "This job is no longer in the engine queue or history. Its outcome is not confirmed.");
    return { id, status: running ? "running" : "queued", progress: null, stage: running ? "Generating" : "Queued", outputs: [], error: null };
  }
  async cancel(id: string): Promise<EngineJob> {
    if (this.config.mode !== "local-raw") return normalizeV2Job(await this.request(`/jobs/${encodeURIComponent(id)}/cancel`, "POST"), this.config.apiKey);
    // Native atomic cancellation scopes the operation to this prompt. Never send an unscoped /interrupt.
    await this.request(`/api/jobs/${encodeURIComponent(id)}/cancel`, "POST");
    return { id, status: "canceling", progress: null, stage: "Cancel requested", outputs: [], error: null };
  }
  async output(url: string): Promise<Response> {
    const target = allowedUpstreamUrl(url, this.config);
    const headers = new Headers(); if (this.config.apiKey && target.origin === new URL(this.config.baseUrl).origin) headers.set("Authorization", `Bearer ${this.config.apiKey}`);
    const response = await guardedFetch(this.config, target, { headers });
    if (!response.ok) await parseResponse(response, this.config);
    return response;
  }
  async discover(storageReady: boolean): Promise<Discovery> {
    const configured = this.config.mode !== "cloud-v2" || !!this.config.apiKey;
    const status: EngineStatus = { configured, connected: false, mode: this.config.mode, baseUrl: this.config.baseUrl, apiKeyConfigured: !!this.config.apiKey, storageReady, message: configured ? "Checking engine access…" : "Connect a Comfy API key or configure COMFY_API_KEY. Browser free runs may not include API access.", checkedAt: new Date().toISOString(), capabilities: { generation: false, uploads: storageReady, cancellation: true, liveProgress: this.config.mode !== "local-raw" }, recipes: RECIPES.map((r) => ({ ...publicRecipe(r), availability: configured ? "unverified" : "not-configured" })) };
    const chosen: Discovery["chosen"] = {};
    if (!configured) return { status, chosen };
    try {
      if (this.config.mode === "cloud-v2") {
        // /object_info can be public. Probe a documented authenticated resource without creating work.
        const probe = await this.low.request("GET", "/assets/00000000-0000-4000-8000-000000000000", { redirect: "manual" });
        if (probe.status === 404) {
          const missing = await probe.json().catch(() => ({})) as { error?: { code?: string }; code?: string };
          const code = missing.error?.code || missing.code;
          if (!code || !["not_found", "asset_not_found"].includes(code)) throw new ApiFailure(502, "api_probe_unconfirmed", "The engine did not confirm authenticated API access. Check the Comfy API endpoint and plan.");
        } else await parseResponse(probe, this.config);
      }
      const path = this.config.mode === "local-raw" ? "/object_info" : this.config.mode === "cloud-v2" ? this.config.baseUrl + "/api/object_info" : "/health";
      const info = await this.request(path);
      status.connected = true; status.capabilities.generation = storageReady;
      status.message = this.config.mode === "cloud-v2" ? "Connected to Comfy. Workflow API credits and plan eligibility are checked when you submit a run." : "Engine connected. Generation uses your configured models.";
      if (this.config.mode === "local-raw" || this.config.mode === "cloud-v2") {
        status.recipes = RECIPES.map((r) => {
          const missing: string[] = []; const resolved: Record<string, string> = {};
          for (const [key, alternatives] of Object.entries(r.models)) {
            const loader = key === "unet" ? "UNETLoader" : key === "clip" ? "CLIPLoader" : "VAELoader";
            const field = key === "unet" ? "unet_name" : key === "clip" ? "clip_name" : "vae_name";
            const node = info[loader] as { input?: { required?: Record<string, unknown[]> } } | undefined;
            const options = node?.input?.required?.[field]?.[0];
            if (Array.isArray(options)) {
              const actual = options.find((name) => typeof name === "string" && alternatives.some((alt) => name === alt || name.endsWith("/" + alt)));
              if (actual) resolved[key] = actual as string; else missing.push(alternatives.join(" or "));
            }
          }
          for (const node of r.nodes) if (!info[node]) missing.push(`Node: ${node}`);
          chosen[r.id] = resolved;
          return { ...publicRecipe(r), missingModels: missing, availability: missing.length ? "missing-models" : "available" } as Recipe;
        });
      }
    } catch (error) {
      status.message = error instanceof ApiFailure ? error.message : "Could not reach the Comfy engine. Check its URL, credentials and network access.";
    }
    return { status, chosen };
  }
}

export function normalizeV2Job(value: Json, redactedSecret?: string | null): EngineJob {
  if (typeof value.id !== "string") throw new ApiFailure(502, "invalid_engine_response", "The engine response did not contain a job ID.");
  const known: JobStatus[] = ["queued", "running", "canceling", "succeeded", "failed", "canceled"];
  const status = known.includes(value.status as JobStatus) ? value.status as JobStatus : value.status === "expired" ? "failed" : "submission_unknown";
  const progress = value.progress as { value?: number; max?: number; current_node?: string; step?: number; steps?: number } | null;
  // v2's normalized value is 0..1. A value/max pair is only a legacy compatibility shape.
  const percent = typeof progress?.value === "number" && Number.isFinite(progress.value)
    ? typeof progress.max === "number" && progress.max > 0 ? Math.round(100 * progress.value / progress.max) : progress.value >= 0 && progress.value <= 1 ? Math.round(100 * progress.value) : null
    : null;
  const outputs = Array.isArray(value.outputs) ? value.outputs.filter((o): o is Json => !!o && typeof o === "object").filter((o) => ["image", "video", "audio"].includes(String(o.type)) && typeof o.id === "string" && typeof o.url === "string").map((o) => ({ id: String(o.id), name: String(o.name || o.id), url: String(o.url), mimeType: typeof o.content_type === "string" ? o.content_type : undefined })) : [];
  const error = value.error && typeof value.error === "object" ? value.error as Json : null;
  const code = String(error?.code || "execution_failed").split(redactedSecret || "\u0000").join("[redacted]").slice(0, 100); const message = String(error?.message || "The workflow failed.").split(redactedSecret || "\u0000").join("[redacted]").slice(0, 700);
  const block = error ? eligibilityBlock(Number(error.http_status || error.status || 0), code, message) : null;
  return { id: value.id, status, progress: percent === null ? null : Math.max(0, Math.min(100, percent)), stage: status === "running" ? "Generating" : status, outputs, error: error ? { code, message, ...(block ? { details: { provider: { code, eligibilityReason: block } } } : {}) } : status === "failed" ? { code: "job_expired", message: "The engine job has expired." } : null };
}
export function normalizeRawJob(id: string, value: Json, baseUrl: string): EngineJob {
  const info = value.status as { status_str?: string; completed?: boolean; messages?: unknown[][] } | undefined;
  const messages = info?.messages || [];
  const interrupted = messages.some((m) => m[0] === "execution_interrupted");
  const failed = info?.status_str === "error" || messages.some((m) => m[0] === "execution_error");
  const outputs: EngineOutput[] = [];
  const records = value.outputs && typeof value.outputs === "object" ? Object.entries(value.outputs as Json) : [];
  for (const [node, data] of records) {
    if (!data || typeof data !== "object") continue;
    for (const [kind, files] of Object.entries(data as Json)) {
      if (!["images", "videos", "gifs", "audio"].includes(kind) || !Array.isArray(files)) continue;
      for (const file of files) {
        if (!file || typeof file !== "object" || typeof file.filename !== "string" || file.type === "temp") continue;
        const query = new URLSearchParams({ filename: file.filename, subfolder: String(file.subfolder || ""), type: String(file.type || "output") });
        outputs.push({ id: `${node}:${file.subfolder || ""}/${file.filename}`, name: file.filename, url: baseUrl + "/view?" + query });
      }
    }
  }
  return { id, status: interrupted ? "canceled" : failed ? "failed" : info?.completed ? "succeeded" : "running", progress: null, stage: interrupted ? "Canceled" : failed ? "Execution failed" : info?.completed ? "Complete" : "Generating", outputs, error: failed ? { code: "execution_failed", message: "Comfy could not execute this workflow. Check the engine's node/model requirements." } : null };
}
export function adapterFor(bindings: { COMFY_API_KEY?: string; COMFY_BASE_URL?: string }): ComfyAdapter { return new ComfyAdapter(engineConfig(bindings)); }
