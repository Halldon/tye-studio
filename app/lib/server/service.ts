import type { Asset, Bootstrap, EngineStatus, GenerationRequest, Job, StudioUser } from "./contracts";
import { adapterFor, ComfyAdapter, type Discovery, type EngineOutput } from "./comfy";
import { requireStorage, type Runtime } from "./context";
import { ApiFailure } from "./errors";
import { boundedBytes, byteRange, inspectMedia, MAX_OUTPUT_BYTES, MAX_UPLOAD_BYTES } from "./media";
import { buildWorkflow, publicRecipe, RECIPES, validateGeneration } from "./recipes";
import { engineConfig, safeFileName } from "./security";
import { assetView, jobView, Store, type AssetRow, type JobRow } from "./store";
import { credentialStorageReady } from "./credentials";
import { credentialFingerprint } from "./eligibility";

export async function discoverEngine(bindings: Runtime): Promise<Discovery> {
  const storageReady = !!bindings.DB && !!bindings.BUCKET;
  try {
    const discovery = await adapterFor(bindings).discover(storageReady);
    discovery.status.credentialStorageReady = !!bindings.DB && credentialStorageReady(bindings.STUDIO_CREDENTIAL_KEY);
    discovery.status.connectionSaved = !!bindings.connectionSaved;
    discovery.status.eligibility = bindings.DB && bindings.ownerId ? await new Store(bindings.DB, bindings.ownerId).engineEligibility(engineConfig(bindings).baseUrl, await credentialFingerprint(bindings.COMFY_API_KEY)) : { state: "unknown", message: "Connection checks do not verify generation access. No relevant completed run is recorded for this connection.", checkedAt: new Date().toISOString() };
    if (bindings.credentialError && !bindings.COMFY_API_KEY) discovery.status.message = bindings.credentialError;
    return discovery;
  }
  catch (error) {
    const status: EngineStatus = { configured: false, connected: false, mode: "remote-v2", baseUrl: "", apiKeyConfigured: !!bindings.COMFY_API_KEY, storageReady, message: error instanceof ApiFailure ? error.message : "The engine configuration is invalid.", checkedAt: new Date().toISOString(), capabilities: { generation: false, uploads: storageReady, cancellation: false, liveProgress: false }, recipes: RECIPES.map((r) => ({ ...publicRecipe(r), availability: "not-configured" })) };
    return { status, chosen: {} };
  }
}
export async function bootstrap(bindings: Runtime, user: StudioUser): Promise<Bootstrap> {
  const engine = await discoverEngine({ ...bindings, ownerId: user.id });
  if (!bindings.DB || !bindings.BUCKET) return { user, projects: [], assets: [], jobs: [], recipes: engine.status.recipes, engine: engine.status };
  const store = new Store(bindings.DB, user.id);
  const [projects, assets, jobs] = await Promise.all([store.projects(), store.assets(), store.jobs()]);
  return { user, projects, assets, jobs, recipes: engine.status.recipes, engine: engine.status };
}

export async function uploadAsset(bindings: Runtime, ownerId: string, request: Request): Promise<Asset> {
  const { db, bucket } = requireStorage(bindings); const store = new Store(db, ownerId);
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.startsWith("multipart/form-data")) throw new ApiFailure(400, "multipart_required", "Upload a file with multipart form data.");
  // Bound the multipart body before parsing, including when content-length is absent.
  const body = await boundedBytes(new Response(request.body, { headers: request.headers }), MAX_UPLOAD_BYTES + 1024 * 1024);
  const form = await new Response(body as BodyInit, { headers: { "Content-Type": contentType } }).formData();
  const file = form.get("file");
  if (!file || typeof file === "string" || !(file instanceof Blob)) throw new ApiFailure(400, "file_required", "Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) throw new ApiFailure(413, "media_too_large", "Uploads are limited to 20 MB per file.");
  const projectId = typeof form.get("projectId") === "string" ? String(form.get("projectId")) || null : null;
  if (projectId) await store.project(projectId);
  const parent = form.get("parentAssetId");
  if (parent !== null && (typeof parent !== "string" || parent.length > 100 || !parent.trim())) throw new ApiFailure(400, "invalid_parent_asset", "Choose a valid source asset.");
  const parentAssetId = typeof parent === "string" ? parent : null;
  if (parentAssetId) await store.parentLineage(parentAssetId);
  const bytes = new Uint8Array(await file.arrayBuffer()); const media = inspectMedia(bytes);
  const fallback = (field: string, min: number, max: number, integer: boolean): number | null => {
    const raw = form.get(field); if (raw === null || raw === "") return null;
    const value = typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new ApiFailure(400, "invalid_media_metadata", `The file's ${field} metadata is invalid.`);
    return value;
  };
  const width = fallback("width", 16, 16384, true); const height = fallback("height", 16, 16384, true); const duration = fallback("duration", 0, 3600, false);
  const id = crypto.randomUUID(); const name = safeFileName("name" in file && typeof file.name === "string" ? file.name : "Uploaded file"); const key = `uploads/${id}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: media.mimeType }, customMetadata: { ownerId, assetId: id } });
  const row: AssetRow = { id, owner_id: ownerId, project_id: projectId, job_id: null, parent_asset_id: parentAssetId, name, type: media.type, mime_type: media.mimeType, size: bytes.byteLength, r2_key: key, width: media.width ?? width, height: media.height ?? height, duration: media.type === "image" ? null : duration, starred: 0, source: "upload", source_output_id: null, created_at: new Date().toISOString() };
  try { return assetView(await store.insertAsset(row)); } catch (error) { await bucket.delete(key); throw error; }
}

export async function submitGeneration(bindings: Runtime, ownerId: string, input: GenerationRequest): Promise<Job> {
  const { db, bucket } = requireStorage(bindings); const store = new Store(db, ownerId);
  const p = validateGeneration(input);
  // Replay the immutable original result before rechecking mutable source files or credentials.
  if (p.requestId) { const previous = await store.requestJob(p.requestId); if (previous) return jobView(previous); }
  if (p.projectId) await store.project(p.projectId);
  if (p.parentAssetId) await store.parentLineage(p.parentAssetId);
  const config = engineConfig(bindings);
  if (config.mode === "cloud-v2" && !config.apiKey) throw new ApiFailure(503, "engine_not_configured", "Connect your Comfy API key before generating. API access may require a paid Comfy plan even when browser free runs remain.");
  const adapter = new ComfyAdapter(config); const discovery = await adapter.discover(true);
  const recipe = discovery.status.recipes.find((r) => r.id === p.recipeId);
  if (recipe?.availability === "missing-models") throw new ApiFailure(409, "recipe_unavailable", "This workflow needs models or nodes that are not installed on the connected engine.", false, { missingModels: recipe.missingModels });
  const inputs: AssetRow[] = [];
  for (const id of p.inputAssetIds || []) {
    const row = await store.asset(id);
    if (row.type !== "image") throw new ApiFailure(400, "image_reference_required", "This workflow accepts image references.");
    inputs.push(row);
  }
  const mask = p.maskAssetId ? await store.asset(p.maskAssetId) : null;
  if (mask && mask.type !== "image") throw new ApiFailure(400, "image_mask_required", "The mask must be an image.");
  if (mask && mask.mime_type !== "image/png") throw new ApiFailure(400, "alpha_mask_required", "Use a PNG alpha mask with transparent selected pixels.");
  if ([...inputs, ...(mask ? [mask] : [])].reduce((n, a) => n + a.size, 0) > 25 * 1024 * 1024) throw new ApiFailure(413, "references_too_large", "Reference images and masks may total up to 25 MB per generation.");
  const saved = await store.createJob(p, config.mode, config.baseUrl, await credentialFingerprint(config.apiKey));
  if (!saved.created) return jobView(saved.row); // App-level duplicate replay never resubmits GPU work.
  let submissionStarted = false;
  try {
    const references: unknown[] = [];
    for (const asset of inputs) {
      const object = await bucket.get(asset.r2_key); if (!object) throw new ApiFailure(404, "source_media_missing", "A reference file is no longer available.");
      references.push(await adapter.upload(new Uint8Array(await object.arrayBuffer()), asset.name, asset.mime_type));
    }
    let maskRef: unknown;
    if (mask) {
      const object = await bucket.get(mask.r2_key); if (!object) throw new ApiFailure(404, "source_media_missing", "The mask file is no longer available.");
      maskRef = await adapter.upload(new Uint8Array(await object.arrayBuffer()), mask.name, mask.mime_type);
    }
    if ((await store.job(saved.row.id)).status === "canceling") return store.updateJob(saved.row.id, { status: "canceled", stage: "Canceled before submission", error: null });
    const graph = buildWorkflow(p, references, discovery.chosen[p.recipeId], maskRef);
    await store.updateJob(saved.row.id, { stage: "Submitting to Comfy" });
    submissionStarted = true;
    // No automatic retries here. An uncertain submit may already have consumed GPU work.
    const upstream = await adapter.submit(graph, saved.row.id);
    const current = await store.job(saved.row.id);
    if (current.status === "canceling") {
      await store.updateJob(saved.row.id, { engineJobId: upstream.id });
      const canceled = await adapter.cancel(upstream.id);
      return store.updateJob(saved.row.id, { status: canceled.status === "canceled" ? "canceled" : "canceling", stage: "Cancel requested", error: null });
    }
    return store.updateJob(saved.row.id, { engineJobId: upstream.id, status: upstream.status === "succeeded" ? "running" : upstream.status, progress: upstream.progress, stage: upstream.status === "succeeded" ? "Saving output" : upstream.stage, error: upstream.error });
  } catch (error) {
    const definitive = !submissionStarted || (error instanceof ApiFailure && error.status < 500 && error.code !== "idempotency_key_reuse" && error.code !== "invalid_engine_response");
    const failure = error instanceof ApiFailure ? error.publicError() : { code: "engine_connection_failed", message: "The connection to Comfy was interrupted." };
    return store.updateJob(saved.row.id, { status: definitive ? "failed" : "submission_unknown", stage: definitive ? "Could not start workflow" : "Submission needs reconciliation", error: definitive ? failure : { code: "submission_unknown", message: "Comfy may have accepted this run, but its job ID was not confirmed. Check your Comfy history before starting another generation. This app will not resubmit automatically." } });
  }
}

async function importOutput(store: Store, bucket: R2Bucket, adapter: ComfyAdapter, row: JobRow, output: EngineOutput): Promise<string> {
  const existing = await store.outputAsset(row.id, output.id); if (existing) return existing.id;
  const bytes = await boundedBytes(await adapter.output(output.url), MAX_OUTPUT_BYTES);
  const media = inspectMedia(bytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(output.id));
  const token = Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("").slice(0, 24);
  const id = `${row.id}-${token}`; const key = `outputs/${row.id}/${token}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: media.mimeType }, customMetadata: { ownerId: store.ownerId, assetId: id } });
  const p = JSON.parse(row.parameters_json) as GenerationRequest;
  const asset: AssetRow = { id, owner_id: store.ownerId, project_id: row.project_id, job_id: row.id, parent_asset_id: p.parentAssetId || null, name: safeFileName(output.name), type: media.type, mime_type: media.mimeType, size: bytes.byteLength, r2_key: key, width: media.width ?? (media.type === "video" ? p.width || null : null), height: media.height ?? (media.type === "video" ? p.height || null : null), duration: media.type === "video" ? p.duration || null : null, starred: 0, source: "generation", source_output_id: output.id, created_at: new Date().toISOString() };
  await store.insertAsset(asset); return id;
}

/** A successful read-only check acknowledges old evidence; it never claims a paid generation succeeded. */
export async function acknowledgeEngineCheck(bindings: Runtime, ownerId: string, status: EngineStatus): Promise<void> {
  if (!status.connected) return;
  const checkedAt = bindings.DB ? await new Store(bindings.DB, ownerId).recordEngineCheck(engineConfig(bindings).baseUrl, await credentialFingerprint(bindings.COMFY_API_KEY)) : new Date().toISOString();
  status.eligibility = { state: "unknown", message: "The connection was checked without generating media. Generation access has not been verified since that check.", checkedAt };
}

export async function reconcileJob(bindings: Runtime, ownerId: string, id: string): Promise<Job> {
  const { db, bucket } = requireStorage(bindings); const store = new Store(db, ownerId); const row = await store.job(id);
  if (!row.engine_job_id || ["succeeded", "canceled"].includes(row.status)) return jobView(row);
  const config = engineConfig({ ...bindings, COMFY_BASE_URL: row.engine_base_url }); const adapter = new ComfyAdapter(config);
  const upstream = await adapter.reconcile(row.engine_job_id);
  const outputIds: string[] = [...JSON.parse(row.output_asset_ids_json)];
  try {
    for (const output of upstream.outputs) {
      const assetId = await importOutput(store, bucket, adapter, row, output); if (!outputIds.includes(assetId)) outputIds.push(assetId);
    }
  } catch (error) {
    const detail = error instanceof ApiFailure ? error.message : "The result could not be copied into your library.";
    return store.updateJob(id, { status: upstream.status === "succeeded" ? "running" : upstream.status, progress: upstream.progress, outputAssetIds: outputIds, stage: "Saving generated media", error: { code: "output_import_failed", message: detail + " Sync this run again to retry saving; generation will not be repeated.", retryable: true } });
  }
  const status = upstream.status === "succeeded" && !outputIds.length ? "failed" : upstream.status;
  return store.updateJob(id, { status, progress: upstream.progress, outputAssetIds: outputIds, stage: status === "succeeded" ? "Saved to library" : upstream.stage, error: status === "failed" && !upstream.error ? { code: "no_media_outputs", message: "Comfy completed without returning supported media files." } : upstream.error });
}
export async function cancelJob(bindings: Runtime, ownerId: string, id: string): Promise<Job> {
  const { db } = requireStorage(bindings); const store = new Store(db, ownerId); const row = await store.job(id);
  if (["succeeded", "failed", "canceled"].includes(row.status)) return jobView(row);
  if (row.status === "submission_unknown") throw new ApiFailure(409, "submission_unknown", "The engine job ID is unknown. Check and cancel the run in Comfy before starting another generation.");
  if (!row.engine_job_id) return store.updateJob(id, { status: "canceling", stage: "Cancel requested" });
  const adapter = adapterFor({ ...bindings, COMFY_BASE_URL: row.engine_base_url }); const upstream = await adapter.cancel(row.engine_job_id);
  return store.updateJob(id, { status: upstream.status === "canceled" ? "canceled" : "canceling", progress: upstream.progress, stage: "Cancel requested", error: upstream.error });
}

export async function assetContent(bindings: Runtime, ownerId: string, id: string, request: Request): Promise<Response> {
  const { db, bucket } = requireStorage(bindings); const row = await new Store(db, ownerId).asset(id);
  const range = byteRange(request.headers.get("Range"), row.size);
  const object = await bucket.get(row.r2_key, range ? { range } : undefined);
  if (!object) throw new ApiFailure(404, "media_missing", "The media file is no longer available.");
  const headers = new Headers({ "Content-Type": row.mime_type, "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" });
  if (range) {
    const start = range.offset; const length = range.length;
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${object.size}`); headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size)); return new Response(object.body, { headers });
}
