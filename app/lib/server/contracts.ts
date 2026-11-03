/** Public API shapes only. Safe for `import type` from browser components. */
export type MediaType = "image" | "video" | "audio";
export type JobStatus = "queued" | "running" | "canceling" | "succeeded" | "failed" | "canceled" | "submission_unknown";
export type EngineMode = "cloud-v2" | "proxy-v2" | "remote-v2" | "local-raw";

export interface StudioUser { id: string; name: string; email: string; localPreview: boolean }
export interface Project {
  id: string; name: string; document: Record<string, unknown> | null; createdAt: string; updatedAt: string;
}
export interface Asset {
  id: string; projectId: string | null; jobId: string | null; name: string; type: MediaType;
  parentAssetId: string | null; versionRootId: string | null;
  mimeType: string; size: number; url: string; width: number | null; height: number | null;
  duration: number | null; starred: boolean; source: "upload" | "generation"; createdAt: string;
}
export interface Recipe {
  id: string; name: string; description: string; kind: "image" | "video";
  capabilities: string[]; availability: "available" | "unverified" | "missing-models" | "not-configured";
  missingModels: string[]; requiresInput: boolean; maxInputs: number;
  defaults: { width: number; height: number; steps: number; duration?: number; fps?: number };
  license: string; sourceUrl: string;
}
export interface GenerationRequest {
  projectId?: string | null; recipeId: string; prompt: string; negativePrompt?: string;
  width?: number; height?: number; seed?: number; steps?: number; duration?: number; fps?: number;
  inputAssetIds?: string[]; maskAssetId?: string; requestId?: string;
  /** Grouping/lineage metadata; never interpreted as engine node inputs. */
  batchId?: string; parentAssetId?: string; shotId?: string;
}
export interface Job {
  id: string; projectId: string | null; recipeId: string; status: JobStatus; prompt: string;
  /** progress is 0..1; null means the engine has no authoritative percentage. */
  parameters: GenerationRequest; engineJobId: string | null; progress: number | null;
  stage: string | null; outputAssetIds: string[]; error: ApiError | null;
  createdAt: string; updatedAt: string; completedAt: string | null;
}
export interface EngineStatus {
  configured: boolean; connected: boolean; mode: EngineMode; baseUrl: string;
  apiKeyConfigured: boolean; storageReady: boolean; message: string; checkedAt: string;
  credentialStorageReady?: boolean; connectionSaved?: boolean;
  eligibility?: { state: "unknown" | "verified" | "blocked"; message: string; jobId?: string; checkedAt: string };
  capabilities: { generation: boolean; uploads: boolean; cancellation: boolean; liveProgress: boolean };
  recipes: Recipe[];
}
export interface ApiError { code: string; message: string; retryable?: boolean; details?: unknown }
export interface Bootstrap {
  user: StudioUser; projects: Project[]; assets: Asset[]; jobs: Job[]; recipes: Recipe[]; engine: EngineStatus;
}
