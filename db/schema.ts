import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("studio_projects", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), name: text("name").notNull(),
  documentJson: text("document_json"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [index("projects_owner_updated").on(t.ownerId, t.updatedAt)]);

export const jobs = sqliteTable("studio_jobs", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  projectId: text("project_id").references(() => projects.id), recipeId: text("recipe_id").notNull(),
  status: text("status").notNull(), prompt: text("prompt").notNull(), parametersJson: text("parameters_json").notNull(),
  clientRequestId: text("client_request_id").notNull(), engineJobId: text("engine_job_id"),
  engineMode: text("engine_mode").notNull(), engineBaseUrl: text("engine_base_url").notNull(),
  credentialFingerprint: text("credential_fingerprint"),
  progress: integer("progress"), stage: text("stage"), outputAssetIdsJson: text("output_asset_ids_json").notNull().default("[]"),
  errorJson: text("error_json"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
}, (t) => [index("jobs_owner_created").on(t.ownerId, t.createdAt), uniqueIndex("jobs_owner_request").on(t.ownerId, t.clientRequestId)]);

export const assets = sqliteTable("studio_assets", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  projectId: text("project_id").references(() => projects.id), jobId: text("job_id").references(() => jobs.id),
  parentAssetId: text("parent_asset_id").references((): AnySQLiteColumn => assets.id),
  versionRootId: text("version_root_id").references((): AnySQLiteColumn => assets.id),
  name: text("name").notNull(), type: text("type").notNull(), mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(), r2Key: text("r2_key").notNull(),
  width: integer("width"), height: integer("height"), duration: integer("duration"),
  starred: integer("starred", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull(), sourceOutputId: text("source_output_id"), createdAt: text("created_at").notNull(),
}, (t) => [index("assets_owner_created").on(t.ownerId, t.createdAt), uniqueIndex("assets_output_once").on(t.ownerId, t.jobId, t.sourceOutputId)]);

export const credentials = sqliteTable("studio_credentials", {
  userId: text("user_id").primaryKey(), ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(), updatedAt: text("updated_at").notNull(),
});

export const engineChecks = sqliteTable("studio_engine_checks", {
  ownerId: text("owner_id").notNull(), engineBaseUrl: text("engine_base_url").notNull(),
  credentialFingerprint: text("credential_fingerprint").notNull(),
  afterJobRowid: integer("after_job_rowid").notNull().default(0), checkedAt: text("checked_at").notNull(),
}, (t) => [uniqueIndex("engine_checks_owner_engine_credential").on(t.ownerId, t.engineBaseUrl, t.credentialFingerprint)]);
