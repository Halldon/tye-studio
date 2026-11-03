import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Native Node type stripping requires the source extension.
import { addShot, attachShotTake, blankShotsDocument, jobsForShot, parseShotsDocument, removeShot, shotGenerationIssue, shotGenerationRequest, shotReferences, syncShotTakes, takesForShot, updateShot } from '../app/components/editors/shots-model.ts';
import type { Job, Recipe } from '../app/lib/server/contracts';
import type { EditorAsset } from '../app/components/editors/editor-model';
import type { ShotGenerationRequest, ShotsDocument } from '../app/components/editors/shots-model';

const recipe: Recipe = { id: 'wan', name: 'Wan', description: '', kind: 'video', capabilities: ['text-to-video', 'image-to-video', 'dimensions', 'duration', 'fps'], availability: 'available', missingModels: [], requiresInput: false, maxInputs: 1, defaults: { width: 832, height: 480, steps: 20, duration: 2, fps: 24 }, license: 'Apache-2.0', sourceUrl: 'https://docs.comfy.org/' };
const assets: EditorAsset[] = [{ id: 'ref-a', name: 'A', type: 'image', url: '/a' }, { id: 'ref-b', name: 'B', type: 'image', url: '/b' }, { id: 'take-a', name: 'Take A', type: 'video', url: '/take-a', duration: 2 }, { id: 'take-b', name: 'Take B', type: 'video', url: '/take-b', duration: 2 }];
const planned = (): ShotsDocument => {
  const document = addShot(blankShotsDocument(), recipe);
  return updateShot(document, document.activeShotId!, { title: 'Opening shot', prompt: 'A slow push toward the product.' });
};
function job(shotId: string, outputs: string[], overrides: Partial<Job> = {}): Job {
  return { id: 'job-a', projectId: 'project-a', recipeId: recipe.id, status: 'succeeded', prompt: 'Prompt', parameters: { recipeId: recipe.id, prompt: 'Prompt', shotId } as ShotGenerationRequest,
    engineJobId: 'engine-a', progress: 1, stage: null, outputAssetIds: outputs, error: null, createdAt: '2026-11-02T12:00:00.000Z', updatedAt: '2026-11-02T12:01:00.000Z', completedAt: '2026-11-02T12:01:00.000Z', ...overrides };
}

test('shot settings, selected takes, references and source video survive document reload', () => {
  let document = planned(); const id = document.activeShotId!;
  document = updateShot(document, id, { referenceAssetIds: ['ref-b'], duration: 4, fps: 16 });
  document = attachShotTake(document, id, 'take-a');
  document = { ...document, sceneReferenceAssetIds: ['ref-a'], frameSourceAssetId: 'take-b' };
  const reloaded = parseShotsDocument(JSON.parse(JSON.stringify(document)));
  assert.deepEqual(reloaded, document);
  assert.equal(reloaded.shots[0].selectedTakeAssetId, 'take-a'); assert.equal(reloaded.shots[0].duration, 4);
});

test('scene and shot references are deduplicated without silently dropping a capacity conflict', () => {
  const document = planned(); const shot = { ...document.shots[0], referenceAssetIds: ['ref-a', 'ref-b'] };
  document.sceneReferenceAssetIds = ['ref-a'];
  assert.deepEqual(shotReferences(document, shot), ['ref-a', 'ref-b']);
  assert.match(shotGenerationIssue(document, shot, recipe, assets)!, /accepts 1 reference image; 2/);
  assert.throws(() => shotGenerationRequest(document, shot, recipe, assets, 'project-a'), /Remove references/);
  assert.deepEqual(shot.referenceAssetIds, ['ref-a', 'ref-b']); assert.deepEqual(document.sceneReferenceAssetIds, ['ref-a']);
});

test('generation uses an immutable per-shot snapshot and real reference IDs', () => {
  const document = planned(); const shot = { ...document.shots[0], referenceAssetIds: ['ref-a'] }; const original = structuredClone(document);
  const request = shotGenerationRequest(document, shot, recipe, assets, 'project-a');
  assert.equal(request.shotId, shot.id); assert.equal(request.projectId, 'project-a'); assert.equal(request.duration, 2); assert.equal(request.fps, 24);
  assert.deepEqual(request.inputAssetIds, ['ref-a']); assert.equal(request.parentAssetId, 'ref-a');
  assert.deepEqual(document, original); assert.equal('endFrameAssetId' in request, false);
});

test('model changes preserve references and unsupported dimensions/frame rates block generation', () => {
  const document = planned(); const shot = { ...document.shots[0], referenceAssetIds: ['ref-a'] };
  const unsupported = { ...recipe, id: 'text-only', maxInputs: 0, capabilities: ['text-to-video'] };
  assert.match(shotGenerationIssue(document, shot, unsupported, assets)!, /accepts 0 reference images/);
  assert.deepEqual(shot.referenceAssetIds, ['ref-a']);
  assert.match(shotGenerationIssue(document, { ...shot, width: 833 }, recipe, assets)!, /multiples of 32/);
  assert.match(shotGenerationIssue(document, { ...shot, fps: 30 }, recipe, assets)!, /16 or 24 fps/);
  assert.match(shotGenerationIssue(document, { ...shot, referenceAssetIds: ['deleted'] }, recipe, assets)!, /missing/);
});

test('reference-sized image editors use validated defaults rather than advertising an ignored dimension control', () => {
  const document = planned(); const shot = { ...document.shots[0], referenceAssetIds: ['ref-a'], width: 833, height: 505 };
  const editor: Recipe = { ...recipe, id: 'image-edit', kind: 'image', capabilities: ['image-edit'], requiresInput: true, defaults: { width: 1024, height: 1024, steps: 20 } };
  assert.equal(shotGenerationIssue(document, shot, editor, assets), null);
  const request = shotGenerationRequest(document, shot, editor, assets, 'project-a');
  assert.equal(request.width, 1024); assert.equal(request.height, 1024); assert.equal(shot.width, 833);
});

test('take synchronization uses only actual matching job outputs and persists alternatives independently of job pagination', () => {
  const document = planned(); const id = document.activeShotId!;
  const jobs = [job(id, [], { id: 'waiting', status: 'queued' }), job(id, ['take-a']), job(id, ['take-b'], { id: 'job-b', createdAt: '2026-11-02T13:00:00.000Z' }), job('other-shot', ['unrelated'])];
  const synced = syncShotTakes(document, jobs, assets, 'project-a');
  assert.deepEqual(synced.shots[0].takeAssetIds, ['take-a', 'take-b']);
  assert.equal(synced.shots[0].selectedTakeAssetId, 'take-b'); assert.equal(document.shots[0].takeAssetIds.length, 0);
  const withoutJobs = takesForShot(parseShotsDocument(JSON.parse(JSON.stringify(synced))).shots[0], [], assets, 'project-a');
  assert.deepEqual(withoutJobs.map(take => take.assetId), ['take-b', 'take-a']);
  assert.equal(syncShotTakes(synced, jobs, assets, 'project-a'), synced, 'Repeated refreshes should not produce new document writes');
});

test('background completion preserves an explicitly selected take and filters other project/audio output', () => {
  const initial = planned(); const id = initial.activeShotId!; const selected = attachShotTake(initial, id, 'take-a');
  const moreAssets: EditorAsset[] = [...assets, { id: 'sound', name: 'Sound', type: 'audio', url: '/sound' }];
  const jobs = [job(id, ['take-b', 'sound']), job(id, ['wrong-project'], { id: 'foreign', projectId: 'project-b' })];
  const next = syncShotTakes(selected, jobs, moreAssets, 'project-a');
  assert.equal(next.shots[0].selectedTakeAssetId, 'take-a'); assert.deepEqual(next.shots[0].takeAssetIds, ['take-a', 'take-b']);
  assert.equal(jobsForShot(jobs, id, 'project-a').length, 1);
});

test('library takes remain deduplicated and missing media does not erase saved selection', () => {
  let document = planned(); const id = document.activeShotId!;
  document = attachShotTake(attachShotTake(document, id, 'take-a'), id, 'take-a');
  assert.deepEqual(document.shots[0].manualTakeAssetIds, ['take-a']);
  const takes = takesForShot(document.shots[0], [], []);
  assert.equal(takes.length, 1); assert.equal(takes[0].assetId, 'take-a'); assert.equal(takes[0].asset, undefined);
  assert.equal(document.shots[0].selectedTakeAssetId, 'take-a');
});

test('deleting a shot is an immutable document operation and keeps assets/jobs recoverable', () => {
  const first = planned(); const withSecond = addShot(first, recipe); const id = withSecond.activeShotId!; const jobs = [job(id, ['take-a'])];
  const deleted = removeShot(withSecond, id);
  assert.equal(deleted.shots.length, 1); assert.equal(withSecond.shots.length, 2); assert.equal(deleted.activeShotId, first.shots[0].id);
  assert.equal(jobs[0].outputAssetIds[0], 'take-a'); assert.equal(takesForShot(withSecond.shots[1], jobs, assets)[0].assetId, 'take-a');
});

test('invalid imported shots are rejected rather than clamped, silently truncated or reassigned', () => {
  const document = planned();
  assert.throws(() => parseShotsDocument({ ...document, version: 2 }), /Unsupported/);
  assert.throws(() => parseShotsDocument({ ...document, activeShotId: 'missing' }), /active shot is missing/);
  assert.throws(() => parseShotsDocument({ ...document, shots: [document.shots[0], document.shots[0]] }), /unique/);
  assert.throws(() => parseShotsDocument({ ...document, sceneReferenceAssetIds: ['ref-a', 'ref-a'] }), /duplicate/);
  assert.throws(() => parseShotsDocument({ ...document, shots: [{ ...document.shots[0], duration: Infinity }] }), /duration/);
  assert.throws(() => parseShotsDocument({ ...document, shots: [{ ...document.shots[0], width: 99999 }] }), /width/);
  assert.throws(() => parseShotsDocument({ ...document, sceneReferenceAssetIds: Array.from({ length: 33 }, (_, index) => `asset-${index}`) }), /at most 32/);
});
