import type { ApiError, Asset, EngineMode, EngineStatus, GenerationRequest, Job, JobStatus, MediaType, Project } from "./contracts";
import { ApiFailure } from "./errors";
import { ownerWhere } from "./security";
import { recordedEligibilityBlock } from "./eligibility";

export interface ProjectRow { id: string; owner_id: string; name: string; document_json: string | null; created_at: string; updated_at: string }
export interface AssetRow { id: string; owner_id: string; project_id: string | null; job_id: string | null; parent_asset_id?: string | null; version_root_id?: string | null; owned_parent_id?: string | null; owned_root_id?: string | null; name: string; type: MediaType; mime_type: string; size: number; r2_key: string; width: number | null; height: number | null; duration: number | null; starred: number; source: "upload" | "generation"; source_output_id: string | null; created_at: string }
export interface JobRow { id: string; owner_id: string; project_id: string | null; recipe_id: string; status: JobStatus; prompt: string; parameters_json: string; client_request_id: string; engine_job_id: string | null; engine_mode: EngineMode; engine_base_url: string; credential_fingerprint?: string | null; progress: number | null; stage: string | null; output_asset_ids_json: string; error_json: string | null; created_at: string; updated_at: string; completed_at: string | null }
export function projectView(row: ProjectRow): Project { return { id: row.id, name: row.name, document: row.document_json ? JSON.parse(row.document_json) : null, createdAt: row.created_at, updatedAt: row.updated_at }; }
// Only ownership-filtered joins may populate lineage in public responses. Legacy/unresolved roots map to self.
export function assetView(row: AssetRow): Asset { return { id: row.id, projectId: row.project_id, jobId: row.job_id, parentAssetId: row.owned_parent_id || null, versionRootId: row.owned_root_id || row.id, name: row.name, type: row.type, mimeType: row.mime_type, size: row.size, url: `/api/assets/${encodeURIComponent(row.id)}/content`, width: row.width, height: row.height, duration: row.duration, starred: !!row.starred, source: row.source, createdAt: row.created_at }; }
export function jobView(row: JobRow): Job { return { id: row.id, projectId: row.project_id, recipeId: row.recipe_id, status: row.status, prompt: row.prompt, parameters: JSON.parse(row.parameters_json), engineJobId: row.engine_job_id, progress: row.progress === null ? null : row.progress / 100, stage: row.stage, outputAssetIds: JSON.parse(row.output_asset_ids_json), error: row.error_json ? JSON.parse(row.error_json) : null, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at }; }

export class Store {
  constructor(readonly db: D1Database, readonly ownerId: string) {}
  async projects(): Promise<Project[]> { const rows = await this.db.prepare("SELECT * FROM studio_projects WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100").bind(this.ownerId).all<ProjectRow>(); return rows.results.map(projectView); }
  async assets(projectId?: string | null): Promise<Asset[]> {
    const select = "SELECT a.*, p.id AS owned_parent_id, r.id AS owned_root_id FROM studio_assets a LEFT JOIN studio_assets p ON p.id=a.parent_asset_id AND p.owner_id=a.owner_id LEFT JOIN studio_assets r ON r.id=a.version_root_id AND r.owner_id=a.owner_id";
    const statement = projectId ? this.db.prepare(select + " WHERE a.owner_id = ? AND a.project_id = ? ORDER BY a.created_at DESC LIMIT 300").bind(this.ownerId, projectId) : this.db.prepare(select + " WHERE a.owner_id = ? ORDER BY a.created_at DESC LIMIT 300").bind(this.ownerId);
    return (await statement.all<AssetRow>()).results.map(assetView);
  }
  async jobs(): Promise<Job[]> { return (await this.db.prepare("SELECT * FROM studio_jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100").bind(this.ownerId).all<JobRow>()).results.map(jobView); }
  async project(id: string): Promise<ProjectRow> { const filter = ownerWhere(this.ownerId, id); const row = await this.db.prepare(`SELECT * FROM studio_projects WHERE ${filter.sql}`).bind(...filter.values).first<ProjectRow>(); if (!row) throw new ApiFailure(404, "project_not_found", "This project was not found."); return row; }
  async asset(id: string): Promise<AssetRow> { const row = await this.db.prepare("SELECT a.*, p.id AS owned_parent_id, r.id AS owned_root_id FROM studio_assets a LEFT JOIN studio_assets p ON p.id=a.parent_asset_id AND p.owner_id=a.owner_id LEFT JOIN studio_assets r ON r.id=a.version_root_id AND r.owner_id=a.owner_id WHERE a.owner_id=? AND a.id=?").bind(this.ownerId, id).first<AssetRow>(); if (!row) throw new ApiFailure(404, "asset_not_found", "This asset was not found."); return row; }
  async job(id: string): Promise<JobRow> { const filter = ownerWhere(this.ownerId, id); const row = await this.db.prepare(`SELECT * FROM studio_jobs WHERE ${filter.sql}`).bind(...filter.values).first<JobRow>(); if (!row) throw new ApiFailure(404, "job_not_found", "This generation was not found."); return row; }
  async createProject(name: string): Promise<Project> {
    const now = new Date().toISOString(); const id = crypto.randomUUID();
    await this.db.prepare("INSERT INTO studio_projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(id, this.ownerId, name, now, now).run();
    return { id, name, document: null, createdAt: now, updatedAt: now };
  }
  async updateProject(id: string, patch: { name?: string; document?: Record<string, unknown> | null }): Promise<Project> {
    const current = await this.project(id);
    const documentJson = patch.document === undefined ? current.document_json : JSON.stringify(patch.document);
    await this.db.prepare("UPDATE studio_projects SET name = ?, document_json = ?, updated_at = ? WHERE owner_id = ? AND id = ?").bind(patch.name ?? current.name, documentJson, new Date().toISOString(), this.ownerId, id).run();
    return projectView(await this.project(id));
  }
  async insertAsset(row: AssetRow): Promise<AssetRow> {
    const lineage = await this.parentLineage(row.parent_asset_id || null, row.id);
    const insert = this.db.prepare("INSERT INTO studio_assets (id,owner_id,project_id,job_id,parent_asset_id,version_root_id,name,type,mime_type,size,r2_key,width,height,duration,starred,source,source_output_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,job_id,source_output_id) DO NOTHING").bind(row.id, this.ownerId, row.project_id, row.job_id, lineage.parentAssetId, lineage.versionRootId || row.id, row.name, row.type, row.mime_type, row.size, row.r2_key, row.width, row.height, row.duration, row.starred, row.source, row.source_output_id, row.created_at);
    if (lineage.parentAssetId) await this.db.batch([insert, this.refreshDescendantRoots(row.id)]); else await insert.run();
    return this.asset(row.id);
  }
  async outputAsset(jobId: string, outputId: string): Promise<AssetRow | null> { return this.db.prepare("SELECT * FROM studio_assets WHERE owner_id = ? AND job_id = ? AND source_output_id = ?").bind(this.ownerId, jobId, outputId).first<AssetRow>(); }
  async parentLineage(parentAssetId: string | null | undefined, childId?: string): Promise<{ parentAssetId: string | null; versionRootId: string | null }> {
    if (!parentAssetId) return { parentAssetId: null, versionRootId: childId || null };
    if (parentAssetId === childId) throw new ApiFailure(409, "asset_lineage_cycle", "An asset cannot be its own ancestor.");
    const chain = await this.db.prepare("WITH RECURSIVE ancestors(id,parent_asset_id) AS (SELECT id,parent_asset_id FROM studio_assets WHERE owner_id=? AND id=? UNION SELECT a.id,a.parent_asset_id FROM studio_assets a JOIN ancestors p ON a.id=p.parent_asset_id WHERE a.owner_id=?) SELECT id,parent_asset_id FROM ancestors").bind(this.ownerId, parentAssetId, this.ownerId).all<{ id: string; parent_asset_id: string | null }>();
    if (!chain.results.length) throw new ApiFailure(404, "parent_asset_not_found", "The source asset was not found.");
    if (childId && chain.results.some((a) => a.id === childId)) throw new ApiFailure(409, "asset_lineage_cycle", "An asset cannot be its own ancestor.");
    const root = chain.results.find((a) => !a.parent_asset_id);
    if (!root) throw new ApiFailure(409, "invalid_asset_lineage", "This source has an invalid version history.");
    return { parentAssetId, versionRootId: root.id };
  }
  private refreshDescendantRoots(id: string): D1PreparedStatement {
    return this.db.prepare("WITH RECURSIVE ancestors(id,parent_asset_id) AS (SELECT id,parent_asset_id FROM studio_assets WHERE owner_id=? AND id=? UNION SELECT a.id,a.parent_asset_id FROM studio_assets a JOIN ancestors p ON a.id=p.parent_asset_id WHERE a.owner_id=?), descendants(id) AS (SELECT id FROM studio_assets WHERE owner_id=? AND id=? UNION SELECT a.id FROM studio_assets a JOIN descendants d ON a.parent_asset_id=d.id WHERE a.owner_id=?) UPDATE studio_assets SET version_root_id=(SELECT id FROM ancestors WHERE parent_asset_id IS NULL LIMIT 1) WHERE owner_id=? AND id IN (SELECT id FROM descendants)").bind(this.ownerId, id, this.ownerId, this.ownerId, id, this.ownerId, this.ownerId);
  }
  async updateAsset(id: string, patch: { name?: string; starred?: boolean; projectId?: string | null; parentAssetId?: string | null }): Promise<Asset> {
    const current = await this.asset(id); if (patch.projectId) await this.project(patch.projectId);
    if (patch.parentAssetId !== undefined && patch.parentAssetId !== null) {
      if (current.parent_asset_id) throw new ApiFailure(409, "asset_parent_immutable", "This version already has a source asset.");
      await this.parentLineage(patch.parentAssetId, id);
      const attach = this.db.prepare("UPDATE studio_assets SET parent_asset_id=? WHERE owner_id=? AND id=? AND parent_asset_id IS NULL AND EXISTS (SELECT 1 FROM studio_assets WHERE owner_id=? AND id=?) AND NOT EXISTS (WITH RECURSIVE ancestors(id,parent_asset_id) AS (SELECT id,parent_asset_id FROM studio_assets WHERE owner_id=? AND id=? UNION SELECT a.id,a.parent_asset_id FROM studio_assets a JOIN ancestors p ON a.id=p.parent_asset_id WHERE a.owner_id=?) SELECT 1 FROM ancestors WHERE id=?)").bind(patch.parentAssetId, this.ownerId, id, this.ownerId, patch.parentAssetId, this.ownerId, patch.parentAssetId, this.ownerId, id);
      const results = await this.db.batch([attach, this.refreshDescendantRoots(id)]);
      if (!results[0].meta.changes) throw new ApiFailure(409, "asset_lineage_conflict", "The version history changed. Reload before restoring this source link.");
    } else if (patch.parentAssetId === null && current.parent_asset_id) throw new ApiFailure(409, "asset_parent_immutable", "A source link cannot be removed from an existing version.");
    await this.db.prepare("UPDATE studio_assets SET name = ?, starred = ?, project_id = ? WHERE owner_id = ? AND id = ?").bind(patch.name ?? current.name, patch.starred === undefined ? current.starred : Number(patch.starred), patch.projectId === undefined ? current.project_id : patch.projectId, this.ownerId, id).run();
    return assetView(await this.asset(id));
  }
  async deleteAsset(id: string): Promise<AssetRow> {
    const row = await this.asset(id);
    const derived = await this.db.prepare("SELECT id FROM studio_assets WHERE owner_id=? AND id<>? AND (parent_asset_id=? OR version_root_id=?) LIMIT 1").bind(this.ownerId, id, id, id).first<{ id: string }>();
    if (derived) throw new ApiFailure(409, "asset_has_versions", "This source has derived versions. Remove those versions before deleting their source.");
    const pending = await this.db.prepare("SELECT id FROM studio_jobs WHERE owner_id=? AND status IN ('queued','running','canceling') AND json_extract(parameters_json,'$.parentAssetId')=? LIMIT 1").bind(this.ownerId, id).first<{ id: string }>();
    if (pending) throw new ApiFailure(409, "asset_used_by_generation", "A generation still uses this source. Resolve that run before deleting the source.");
    try { await this.db.prepare("DELETE FROM studio_assets WHERE owner_id = ? AND id = ?").bind(this.ownerId, id).run(); }
    catch (error) { if (error instanceof Error && /foreign key/i.test(error.message)) throw new ApiFailure(409, "asset_has_versions", "A derived version still refers to this source."); throw error; }
    return row;
  }
  async requestJob(requestId: string): Promise<JobRow | null> { return this.db.prepare("SELECT * FROM studio_jobs WHERE owner_id = ? AND client_request_id = ?").bind(this.ownerId, requestId).first<JobRow>(); }
  async createJob(p: GenerationRequest, mode: EngineMode, baseUrl: string, credentialFingerprint: string | null = null): Promise<{ row: JobRow; created: boolean }> {
    const id = crypto.randomUUID(); const now = new Date().toISOString(); const requestId = p.requestId || id;
    const result = await this.db.prepare("INSERT INTO studio_jobs (id,owner_id,project_id,recipe_id,status,prompt,parameters_json,client_request_id,engine_mode,engine_base_url,credential_fingerprint,stage,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,client_request_id) DO NOTHING").bind(id, this.ownerId, p.projectId || null, p.recipeId, "queued", p.prompt, JSON.stringify(p), requestId, mode, baseUrl, credentialFingerprint, "Preparing workflow", now, now).run();
    const row = await this.requestJob(requestId); if (!row) throw new ApiFailure(500, "job_record_failed", "The generation could not be saved.");
    return { row, created: result.meta.changes > 0 };
  }
  async recordEngineCheck(baseUrl: string, fingerprint: string): Promise<string> {
    const checkedAt = new Date().toISOString();
    await this.db.prepare("INSERT INTO studio_engine_checks (owner_id,engine_base_url,credential_fingerprint,after_job_rowid,checked_at) VALUES (?,?,?,COALESCE((SELECT MAX(rowid) FROM studio_jobs WHERE owner_id=? AND engine_base_url=? AND credential_fingerprint=?),0),?) ON CONFLICT(owner_id,engine_base_url,credential_fingerprint) DO UPDATE SET after_job_rowid=excluded.after_job_rowid,checked_at=excluded.checked_at").bind(this.ownerId, baseUrl, fingerprint, this.ownerId, baseUrl, fingerprint, checkedAt).run();
    return checkedAt;
  }
  async engineEligibility(baseUrl: string, fingerprint: string): Promise<NonNullable<EngineStatus["eligibility"]>> {
    const checkpoint = await this.db.prepare("SELECT after_job_rowid,checked_at FROM studio_engine_checks WHERE owner_id=? AND engine_base_url=? AND credential_fingerprint=?").bind(this.ownerId, baseUrl, fingerprint).first<{ after_job_rowid: number; checked_at: string }>();
    const rows = await this.db.prepare("SELECT * FROM studio_jobs WHERE owner_id=? AND engine_base_url=? AND credential_fingerprint=? AND rowid>? ORDER BY created_at DESC,rowid DESC LIMIT 100").bind(this.ownerId, baseUrl, fingerprint, checkpoint?.after_job_rowid || 0).all<JobRow>();
    for (const row of rows.results) {
      if (row.status === "succeeded" && row.engine_job_id && JSON.parse(row.output_asset_ids_json).length) return { state: "verified", message: "A generation completed and its media was saved to your library with this connection.", jobId: row.id, checkedAt: row.completed_at || row.updated_at };
      const error = row.error_json ? JSON.parse(row.error_json) as ApiError : null;
      if (row.status === "failed" && recordedEligibilityBlock(error)) return { state: "blocked", message: error!.message, jobId: row.id, checkedAt: row.completed_at || row.updated_at };
    }
    return { state: "unknown", message: checkpoint ? "The connection was checked without generating media. Generation access has not been verified since that check." : "Authentication and model discovery do not verify generation access. No relevant completed run is recorded for this connection.", checkedAt: checkpoint?.checked_at || new Date().toISOString() };
  }
  async updateJob(id: string, patch: { status?: JobStatus; engineJobId?: string; progress?: number | null; stage?: string | null; outputAssetIds?: string[]; error?: ApiError | null }): Promise<Job> {
    const row = await this.job(id); const status = patch.status ?? row.status;
    const completedAt = ["succeeded", "failed", "canceled"].includes(status) ? row.completed_at || new Date().toISOString() : null;
    // Multiple tabs may reconcile/cancel concurrently. A late response must not regress a terminal/canceling state.
    await this.db.prepare("UPDATE studio_jobs SET status=CASE WHEN status IN ('succeeded','failed','canceled') THEN status WHEN status='canceling' AND ? IN ('queued','running') THEN status ELSE ? END,engine_job_id=COALESCE(?,engine_job_id),progress=CASE WHEN status IN ('succeeded','failed','canceled') THEN progress ELSE ? END,stage=CASE WHEN status IN ('succeeded','failed','canceled') THEN stage WHEN status='canceling' AND ? IN ('queued','running') THEN stage ELSE ? END,output_asset_ids_json=CASE WHEN status IN ('succeeded','failed','canceled') THEN output_asset_ids_json ELSE ? END,error_json=CASE WHEN status IN ('succeeded','failed','canceled') THEN error_json ELSE ? END,updated_at=?,completed_at=CASE WHEN status IN ('succeeded','failed','canceled') THEN completed_at ELSE ? END WHERE owner_id=? AND id=?").bind(status, status, patch.engineJobId ?? null, patch.progress === undefined ? row.progress : patch.progress, status, patch.stage === undefined ? row.stage : patch.stage, patch.outputAssetIds ? JSON.stringify(patch.outputAssetIds) : row.output_asset_ids_json, patch.error === undefined ? row.error_json : patch.error ? JSON.stringify(patch.error) : null, new Date().toISOString(), completedAt, this.ownerId, id).run();
    return jobView(await this.job(id));
  }
}
