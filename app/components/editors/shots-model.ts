import type { GenerationRequest, Job, Recipe } from '../../lib/server/contracts';
import type { EditorAsset } from './editor-model';

export interface Shot {
  id: string; title: string; prompt: string; recipeId: string; referenceAssetIds: string[];
  width: number; height: number; duration: number; fps: number;
  manualTakeAssetIds: string[]; takeAssetIds: string[]; selectedTakeAssetId?: string; createdAt: string;
}
export interface ShotsDocument {
  version: 1; shots: Shot[]; activeShotId: string | null; sceneReferenceAssetIds: string[];
  frameSourceAssetId?: string;
}
export interface ShotTake { assetId: string; asset?: EditorAsset; source: 'generation' | 'manual' | 'saved'; jobId?: string }
export type ShotGenerationRequest = GenerationRequest & { shotId: string; batchId?: string; parentAssetId?: string };
const unique = (ids: string[]) => [...new Set(ids)];
const id = () => `shot-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export const blankShotsDocument = (): ShotsDocument => ({ version: 1, shots: [], activeShotId: null, sceneReferenceAssetIds: [] });

export function addShot(document: ShotsDocument, recipe?: Recipe): ShotsDocument {
  if (document.shots.length >= 100) throw new Error('A project supports up to 100 shots.');
  const shot: Shot = { id: id(), title: `Shot ${document.shots.length + 1}`, prompt: '', recipeId: recipe?.id || '',
    referenceAssetIds: [], manualTakeAssetIds: [], takeAssetIds: [], width: recipe?.defaults.width || 832, height: recipe?.defaults.height || 480,
    duration: recipe?.defaults.duration || 2, fps: recipe?.defaults.fps || 24, createdAt: new Date().toISOString() };
  return { ...document, shots: [...document.shots, shot], activeShotId: shot.id };
}
export function updateShot(document: ShotsDocument, shotId: string, patch: Partial<Omit<Shot, 'id' | 'createdAt'>>): ShotsDocument {
  return { ...document, shots: document.shots.map(shot => shot.id === shotId ? { ...shot, ...patch, id: shot.id, createdAt: shot.createdAt } : shot) };
}
export function removeShot(document: ShotsDocument, shotId: string): ShotsDocument {
  const at = document.shots.findIndex(shot => shot.id === shotId); if (at < 0) return document;
  const shots = document.shots.filter(shot => shot.id !== shotId);
  return { ...document, shots, activeShotId: document.activeShotId === shotId ? shots[Math.min(at, shots.length - 1)]?.id || null : document.activeShotId };
}
export function attachShotTake(document: ShotsDocument, shotId: string, assetId: string): ShotsDocument {
  const shot = document.shots.find(item => item.id === shotId); if (!shot) return document;
  if (!shot.manualTakeAssetIds.includes(assetId) && shot.manualTakeAssetIds.length >= 256) throw new Error('This shot has reached its limit of 256 library takes. Create another shot to add more.');
  if (!shot.takeAssetIds.includes(assetId) && shot.takeAssetIds.length >= 1000) throw new Error('This shot has reached its limit of 1,000 saved takes. Create another shot to add more.');
  return updateShot(document, shotId, { manualTakeAssetIds: unique([...shot.manualTakeAssetIds, assetId]), takeAssetIds: unique([...shot.takeAssetIds, assetId]), selectedTakeAssetId: assetId });
}
export function shotReferences(document: ShotsDocument, shot: Shot): string[] { return unique([...document.sceneReferenceAssetIds, ...shot.referenceAssetIds]); }
export function jobsForShot(jobs: Job[], shotId: string, projectId?: string | null): Job[] {
  return jobs.filter(job => (job.parameters as GenerationRequest & { shotId?: string }).shotId === shotId && (!projectId || job.projectId === projectId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function takesForShot(shot: Shot, jobs: Job[], assets: EditorAsset[], projectId?: string | null): ShotTake[] {
  const result: ShotTake[] = []; const seen = new Set<string>();
  for (const job of jobsForShot(jobs, shot.id, projectId)) {
    for (const assetId of job.outputAssetIds) {
      if (seen.has(assetId)) continue;
      const asset = assets.find(item => item.id === assetId);
      if (asset?.type === 'audio') continue;
      result.push({ assetId, asset, source: 'generation', jobId: job.id }); seen.add(assetId);
    }
  }
  for (const assetId of unique([...(shot.selectedTakeAssetId ? [shot.selectedTakeAssetId] : []), ...[...shot.takeAssetIds].reverse(), ...[...shot.manualTakeAssetIds].reverse()])) {
    if (seen.has(assetId)) continue;
    const asset = assets.find(item => item.id === assetId); if (asset?.type === 'audio') continue;
    result.push({ assetId, asset, source: shot.manualTakeAssetIds.includes(assetId) ? 'manual' : 'saved' }); seen.add(assetId);
  }
  return result;
}
export function observeShotOutputs(document: ShotsDocument, jobs: Job[], projectId?: string | null, assets?: Pick<EditorAsset, 'id' | 'type'>[]): ShotsDocument {
  let changed = false;
  const shots = document.shots.map(shot => {
    const outputs = unique(jobsForShot(jobs, shot.id, projectId).reverse().flatMap(job => job.outputAssetIds))
      .filter(id => !assets?.some(asset => asset.id === id && asset.type === 'audio'));
    const takes = unique([...shot.takeAssetIds, ...outputs]);
    if (takes.length > 1000) throw new Error(`“${shot.title}” has more than 1,000 takes. Its existing saved takes have been preserved.`);
    if (takes.length === shot.takeAssetIds.length) return shot;
    changed = true;
    return { ...shot, takeAssetIds: takes, ...(!shot.selectedTakeAssetId && outputs.at(-1) ? { selectedTakeAssetId: outputs.at(-1) } : {}) };
  });
  return changed ? { ...document, shots } : document;
}
export function syncShotTakes(document: ShotsDocument, jobs: Job[], assets?: Pick<EditorAsset, 'id' | 'type'>[], projectId?: string | null): ShotsDocument {
  return observeShotOutputs(document, jobs, projectId, assets);
}
export function shotGenerationIssue(document: ShotsDocument, shot: Shot, recipe: Recipe | undefined, assets: EditorAsset[]): string | null {
  if (!recipe) return 'Choose a model for this shot.';
  if (!shot.prompt.trim()) return 'Describe this shot before generating a take.';
  if (shot.prompt.length > 12000) return 'The prompt must be 12,000 characters or fewer.';
  if (recipe.availability === 'missing-models') return `Install the missing dependencies for ${recipe.name}.`;
  if (recipe.availability === 'not-configured') return `Configure ${recipe.name} before generating.`;
  const refs = shotReferences(document, shot);
  const missing = refs.find(ref => !assets.some(asset => asset.id === ref && asset.type === 'image'));
  if (missing) return 'A pinned or assigned reference image is missing. Relink it or remove it before generating.';
  if (refs.length > recipe.maxInputs) return `${recipe.name} accepts ${recipe.maxInputs} reference image${recipe.maxInputs === 1 ? '' : 's'}; ${refs.length} are pinned or assigned. Remove references or choose a compatible model.`;
  if (recipe.requiresInput && !refs.length) return 'Add a reference image for this model.';
  const multiple = recipe.kind === 'video' ? 32 : 16; const max = recipe.kind === 'video' ? 1280 : 2048;
  if (recipe.capabilities.includes('dimensions') && (![shot.width, shot.height].every(value => Number.isInteger(value) && value >= 256 && value <= max && value % multiple === 0) || shot.width * shot.height > (recipe.kind === 'video' ? 1_000_000 : 4_194_304))) return `Use dimensions in multiples of ${multiple}, within this model’s limits.`;
  if (recipe.kind === 'video' && (shot.duration < 1 || shot.duration > 5 || !Number.isFinite(shot.duration) || ![16, 24].includes(shot.fps))) return 'Use a 1–5 second duration and 16 or 24 fps for this video model.';
  return null;
}
export function shotGenerationRequest(document: ShotsDocument, shot: Shot, recipe: Recipe, assets: EditorAsset[], projectId: string | null): ShotGenerationRequest {
  const issue = shotGenerationIssue(document, shot, recipe, assets); if (issue) throw new Error(issue);
  const refs = shotReferences(document, shot);
  return { projectId, shotId: shot.id, recipeId: recipe.id, prompt: shot.prompt.trim(), inputAssetIds: refs,
    width: recipe.capabilities.includes('dimensions') ? shot.width : recipe.defaults.width,
    height: recipe.capabilities.includes('dimensions') ? shot.height : recipe.defaults.height, steps: recipe.defaults.steps,
    ...(recipe.kind === 'video' ? { duration: shot.duration, fps: shot.fps } : {}),
    ...(refs[0] ? { parentAssetId: refs[0] } : {}) };
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function text(value: unknown, label: string, max: number, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) throw new Error(`Invalid ${label}.`);
  return value;
}
function references(value: unknown, label: string, max = 32): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must contain at most ${max} asset IDs.`);
  const ids = value.map(item => text(item, label, 128)); if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate asset IDs.`);
  return ids;
}
function bounded(value: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
export function parseShotsDocument(value: unknown): ShotsDocument {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.shots) || value.shots.length > 100) throw new Error('Unsupported shots document or more than 100 shots.');
  const shots: Shot[] = value.shots.map(item => {
    if (!record(item)) throw new Error('Invalid shot.');
    const createdAt = text(item.createdAt, 'shot date', 64); if (!Number.isFinite(Date.parse(createdAt))) throw new Error('Invalid shot date.');
    return { id: text(item.id, 'shot ID', 100), title: text(item.title, 'shot title', 120), prompt: text(item.prompt, 'shot prompt', 12000, true), recipeId: text(item.recipeId, 'shot model', 128, true),
      referenceAssetIds: references(item.referenceAssetIds, 'Shot references'), manualTakeAssetIds: references(item.manualTakeAssetIds ?? [], 'Manual takes', 256), takeAssetIds: references(item.takeAssetIds ?? item.manualTakeAssetIds ?? [], 'Saved takes', 1000),
      width: bounded(item.width, 'shot width', 256, 2048, true), height: bounded(item.height, 'shot height', 256, 2048, true),
      duration: bounded(item.duration, 'shot duration', 1, 5), fps: bounded(item.fps, 'shot frame rate', 1, 60, true), createdAt,
      ...(item.selectedTakeAssetId === undefined ? {} : { selectedTakeAssetId: text(item.selectedTakeAssetId, 'selected take', 128) }) };
  });
  const ids = shots.map(shot => shot.id); if (new Set(ids).size !== ids.length) throw new Error('Shot IDs must be unique.');
  const activeShotId = value.activeShotId === null ? null : text(value.activeShotId, 'active shot', 128);
  if (activeShotId && !ids.includes(activeShotId)) throw new Error('The active shot is missing.');
  return { version: 1, shots, activeShotId, sceneReferenceAssetIds: references(value.sceneReferenceAssetIds, 'Scene references'),
    ...(value.frameSourceAssetId === undefined ? {} : { frameSourceAssetId: text(value.frameSourceAssetId, 'frame source', 128) }) };
}
