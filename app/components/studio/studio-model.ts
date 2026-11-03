import type { Asset, Job, Recipe } from "../../lib/types";

export interface GenerationRun { id: string; jobs: Job[]; outputs: Asset[]; createdAt: string; recipe?: Recipe }
export const runMatches = (run: GenerationRun, query: string) => [run.recipe?.name ?? "", ...run.jobs.map(job => job.prompt), ...run.outputs.map(asset => asset.name)].join(" ").toLowerCase().includes(query.trim().toLowerCase());
export const isPendingJob = (job: Job) => ["queued", "running", "canceling"].includes(job.status);
export const jobStatusLabel: Record<Job["status"], string> = {
  queued: "Queued", running: "Generating", canceling: "Canceling", succeeded: "Completed",
  failed: "Failed", canceled: "Canceled", submission_unknown: "Check submission",
};

/** Build a feed from real jobs and persisted outputs, never inferred placeholders. */
export function generationRuns(jobs: Job[], assets: Asset[], recipes: Recipe[], projectId: string | null, kind: "image" | "video"): GenerationRun[] {
  const byId = new Map(assets.map(asset => [asset.id, asset]));
  const groups = new Map<string, GenerationRun>();
  for (const job of jobs) {
    if (job.projectId !== projectId) continue;
    const recipe = recipes.find(value => value.id === job.recipeId);
    const outputKind = job.outputAssetIds.map(id => byId.get(id)?.type).find(Boolean);
    if ((recipe?.kind ?? outputKind ?? (job.parameters.duration !== undefined ? "video" : "image")) !== kind) continue;
    const id = job.parameters.batchId || job.id;
    const group = groups.get(id) ?? { id, jobs: [], outputs: [], createdAt: job.createdAt, recipe };
    group.jobs.push(job);
    if (job.createdAt > group.createdAt) group.createdAt = job.createdAt;
    groups.set(id, group);
  }
  return [...groups.values()].map(group => ({ ...group,
    jobs: [...group.jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    outputs: [...new Set(group.jobs.flatMap(job => job.outputAssetIds))].map(id => byId.get(id))
      .filter((asset): asset is Asset => Boolean(asset && asset.projectId === projectId && asset.type === kind)),
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

/** Follow ancestry defensively: missing originals and cyclic imported metadata remain usable. */
export function lineageRoot(asset: Asset, assets: Asset[]): string {
  if (asset.versionRootId) return asset.versionRootId;
  const byId = new Map(assets.map(value => [value.id, value]));
  let current = asset;
  const visited = new Set<string>();
  while (current.parentAssetId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = byId.get(current.parentAssetId);
    if (!parent) return current.parentAssetId;
    if (parent.versionRootId) return parent.versionRootId;
    current = parent;
  }
  return current.id;
}

export function assetVersions(asset: Asset, assets: Asset[]): Asset[] {
  // The controller supplies only owner-authorized assets. Lineage can cross projects.
  const candidates = assets;
  const root = lineageRoot(asset, candidates);
  const family = new Set([asset.id, root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const value of candidates) {
      if (!family.has(value.id) && (value.versionRootId === root || Boolean(value.parentAssetId && family.has(value.parentAssetId)))) {
        family.add(value.id); changed = true;
      }
    }
  }
  // An imported descendant may omit its root field; include its available ancestors too.
  let current: Asset | undefined = asset;
  const visited = new Set<string>();
  while (current?.parentAssetId && !visited.has(current.id)) {
    visited.add(current.id); family.add(current.parentAssetId);
    current = candidates.find(value => value.id === current?.parentAssetId);
  }
  return candidates.filter(value => family.has(value.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function recipeInputIssue(recipe: Recipe, inputCount: number): string | null {
  if (inputCount > recipe.maxInputs) return recipe.maxInputs === 0 ? "Does not accept reference images" : `Accepts up to ${recipe.maxInputs} reference ${recipe.maxInputs === 1 ? "image" : "images"}`;
  if (recipe.requiresInput && inputCount === 0) return "Needs a source image";
  return null;
}
