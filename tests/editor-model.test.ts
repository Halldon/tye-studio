import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Node's built-in type stripping requires the source extension.
import { addImageLayer, blankImageDocument, blankSequenceDocument, blankWorkflowDocument, clipAtTime, cropImageDocument, exportComfyGraph, importWorkflowJson, moveSequenceClip, resizeImageCanvas, resolveWorkflowOperation, sequenceDuration, splitSequenceClip, workflowConnectionError } from '../app/components/editors/editor-model.ts';
import type { EditorAsset, ImageDocument, WorkflowDocument } from '../app/components/editors/editor-model';

test('cropping translates layers and the edit mask while preserving original source references', () => {
  const asset: EditorAsset = { id: 'original', name: 'Source photo', type: 'image', url: '/api/assets/original', width: 1200, height: 800 };
  const document = addImageLayer(blankImageDocument(), asset) as ImageDocument;
  document.mask.push({ id: 'stroke', mode: 'paint', width: 20, points: [{ x: 300, y: 200 }] });
  const snapshot = structuredClone(document);
  const cropped = cropImageDocument(document, { x: 200, y: 100, width: 600, height: 400 });
  assert.equal(cropped.width, 600); assert.equal(cropped.height, 400);
  assert.equal(cropped.sourceAssetId, 'original'); assert.equal(cropped.layers[0].assetId, 'original');
  assert.equal(cropped.layers[0].x, -200); assert.deepEqual(cropped.mask[0].points, [{ x: 100, y: 100 }]);
  assert.deepEqual(document, snapshot, 'Undo and source preservation require immutable document edits');
});

test('adding a second image fits it to the canvas without replacing its first source', () => {
  const first = addImageLayer(blankImageDocument(), { id: 'a', name: 'A', type: 'image', url: '/a', width: 800, height: 600 });
  const next = addImageLayer(first, { id: 'b', name: 'B', type: 'image', url: '/b', width: 1600, height: 400 });
  assert.equal(next.width, 800); assert.equal(next.height, 600); assert.equal(next.sourceAssetId, 'a');
  assert.equal(next.layers[1].width, 800); assert.equal(next.layers[1].height, 200); assert.equal(next.layers[1].y, 200);
  assert.equal(first.layers.length, 1);
});

test('canvas expansion preserves layer geometry and shifts mask coordinates with the source', () => {
  const document = addImageLayer(blankImageDocument(), { id: 'source', name: 'Source', type: 'image', url: '/source', width: 800, height: 600 });
  document.mask = [{ id: 'mask', width: 24, mode: 'paint', points: [{ x: 10, y: 20 }] }];
  const expanded = resizeImageCanvas(document, 1000, 1000);
  assert.equal(expanded.layers[0].width, 800); assert.equal(expanded.layers[0].height, 600);
  assert.equal(expanded.layers[0].x, 100); assert.equal(expanded.layers[0].y, 200);
  assert.deepEqual(expanded.mask[0].points, [{ x: 110, y: 220 }]); assert.equal(expanded.layers[0].assetId, 'source');
  assert.equal(document.layers[0].x, 0); assert.equal(document.width, 800);
});

test('splitting a trimmed video preserves source in/out ranges and total sequence duration', () => {
  const document = { ...blankSequenceDocument(), clips: [{ id: 'shot', assetId: 'video', in: 3, out: 9, caption: 'A caption', muted: false }] };
  const split = splitSequenceClip(document, 'shot', 2.5);
  assert.equal(sequenceDuration(split), 6); assert.equal(split.clips.length, 2);
  assert.equal(split.clips[0].in, 3); assert.equal(split.clips[0].out, 5.5);
  assert.equal(split.clips[1].in, 5.5); assert.equal(split.clips[1].out, 9);
  assert.equal(split.clips[1].caption, 'A caption'); assert.equal(split.clips[1].assetId, 'video');
  assert.notEqual(split.clips[0].id, split.clips[1].id);
  assert.equal(document.clips[0].out, 9);
});

test('playhead boundaries choose the next shot and reordering keeps clip identity intact', () => {
  const document = { ...blankSequenceDocument(), clips: [{ id: 'one', assetId: 'a', in: 0, out: 4, caption: '', muted: false }, { id: 'two', assetId: 'b', in: 2, out: 5, caption: '', muted: false }] };
  assert.equal(clipAtTime(document, 3.99)?.clip.id, 'one');
  assert.equal(clipAtTime(document, 4)?.clip.id, 'two'); assert.equal(clipAtTime(document, 4)?.localTime, 0);
  assert.deepEqual(moveSequenceClip(document, 'two', -1).clips.map((clip: { id: string }) => clip.id), ['two', 'one']);
  assert.equal(splitSequenceClip(document, 'one', 0), document);
  assert.equal(splitSequenceClip(document, 'one', 4), document);
});

const graph = (): WorkflowDocument => ({ ...blankWorkflowDocument(), nodes: [
  { id: 'image', position: { x: 0, y: 0 }, data: { kind: 'asset', label: 'Image', output: 'image' } },
  { id: 'text', position: { x: 0, y: 200 }, data: { kind: 'text', label: 'Prompt', output: 'text' } },
  { id: 'edit', position: { x: 300, y: 0 }, data: { kind: 'operation', label: 'Edit', output: 'image', operation: 'image-edit' } },
  { id: 'upscale', position: { x: 600, y: 0 }, data: { kind: 'operation', label: 'Upscale', output: 'image', operation: 'upscale' } }
] });

test('workflow connections reject wrong types, occupied inputs, self links and cycles', () => {
  const document = graph();
  assert.equal(workflowConnectionError(document, 'image', 'edit', 'image'), null);
  assert.match(workflowConnectionError(document, 'text', 'edit', 'image')!, /expects image/);
  assert.match(workflowConnectionError(document, 'edit', 'edit', 'image')!, /itself/);
  document.edges.push({ id: 'a', source: 'image', target: 'edit', targetHandle: 'image' });
  assert.match(workflowConnectionError(document, 'image', 'edit', 'image')!, /already/);
  document.edges.push({ id: 'b', source: 'edit', target: 'upscale', targetHandle: 'image' });
  document.edges = document.edges.filter(edge => edge.id !== 'a');
  assert.match(workflowConnectionError(document, 'upscale', 'edit', 'image')!, /cycle/);
});

test('selected operation resolves actual prompt and asset IDs through required typed ports', () => {
  const document = graph();
  document.nodes[0].data.assetId = 'saved-photo'; document.nodes[1].data.text = '  Relight the product at sunset  ';
  document.edges = [{ id: 'image', source: 'image', target: 'edit', targetHandle: 'image' }, { id: 'prompt', source: 'text', target: 'edit', targetHandle: 'text' }];
  assert.deepEqual(resolveWorkflowOperation(document, 'edit'), { operation: 'image-edit', prompt: 'Relight the product at sunset', inputAssetIds: ['saved-photo'] });
  document.nodes[2].data.width = 1280; document.nodes[2].data.height = 720;
  assert.equal(resolveWorkflowOperation(document, 'edit').width, 1280);
});

test('operation resolution blocks disconnected inputs, blank prompts and unresolved upstream operations', () => {
  const document = graph();
  assert.throws(() => resolveWorkflowOperation(document, 'edit'), /Connect one image asset/);
  document.nodes[0].data.assetId = 'saved-photo';
  document.edges = [{ id: 'image', source: 'image', target: 'edit', targetHandle: 'image' }, { id: 'prompt', source: 'text', target: 'edit', targetHandle: 'text' }];
  assert.throws(() => resolveWorkflowOperation(document, 'edit'), /Write instructions/);
  document.nodes[1].data.text = 'A prompt';
  document.edges.push({ id: 'upstream', source: 'edit', target: 'upscale', targetHandle: 'image' });
  assert.throws(() => resolveWorkflowOperation(document, 'upscale'), /no computed asset/);
  assert.throws(() => resolveWorkflowOperation(document, 'image'), /Select an operation/);
});

test('operation execution never interprets an imported Comfy graph as a native graph', () => {
  const document = importWorkflowJson('{"1":{"class_type":"Node","inputs":{"text":"Prompt"}}}');
  assert.throws(() => resolveWorkflowOperation(document, '1'), /Imported Comfy graphs are preserved/);
});

test('Comfy API import preserves unknown data and original JSON byte for byte', () => {
  const original = '{\n  "1": {"class_type":"CustomLoader","inputs":{"path":"model.safetensors","hidden":{"a":[1,2]}},"customMetadata":{"keep":true}},\n  "2": {"class_type":"CustomSampler","inputs":{"model":["1",0],"steps":20,"prompt":"Before","enabled":true},"_meta":{"title":"A sampler"}}\n}';
  const document = importWorkflowJson(original) as WorkflowDocument;
  assert.equal(document.importKind, 'comfy-api'); assert.equal(exportComfyGraph(document), original);
  assert.equal(document.edges[0].source, '1'); assert.equal(document.edges[0].target, '2');
  document.scalarOverrides = { '2': { steps: 28, prompt: 'After', enabled: false } };
  const changed = JSON.parse(exportComfyGraph(document));
  assert.deepEqual(changed['1'], JSON.parse(original)['1']); assert.deepEqual(changed['2'].inputs.model, ['1', 0]);
  assert.equal(changed['2'].inputs.steps, 28); assert.equal(changed['2'].inputs.enabled, false);
  assert.equal(document.originalComfyJson, original);
  assert.match(workflowConnectionError(document, '1', '2', 'model')!, /preserved/);
});

test('Comfy scalar export rejects topology and type mutations', () => {
  const document = importWorkflowJson('{"1":{"class_type":"Node","inputs":{"count":10,"model":["0",0]}}}') as WorkflowDocument;
  document.scalarOverrides = { '1': { count: 'wrong type' } }; assert.throws(() => exportComfyGraph(document), /same type/);
  document.scalarOverrides = { '1': { model: 'replace link' } }; assert.throws(() => exportComfyGraph(document), /scalar/);
});

test('Comfy UI workflows retain custom widgets and subgraphs without claiming recompilation', () => {
  const text = JSON.stringify({ nodes: [{ id: 11, type: 'UnknownCustomNode', widgets_values: ['custom', { nested: true }] }], links: [], definitions: { subgraphs: [{ anything: true }] }, extra: { renderer: 'custom' } });
  const document = importWorkflowJson(text) as WorkflowDocument;
  assert.equal(document.importKind, 'comfy-ui'); assert.equal(exportComfyGraph(document), text);
  assert.equal(document.nodes[0].data.classType, 'UnknownCustomNode');
  const restored = importWorkflowJson(JSON.stringify(document)); assert.equal(exportComfyGraph(restored), text);
});

test('native workflow import rejects dangling edges and duplicate node IDs', () => {
  const document = graph(); document.edges.push({ id: 'bad', source: 'missing', target: 'edit' });
  assert.throws(() => importWorkflowJson(JSON.stringify(document)), /missing node/);
  document.edges = []; document.nodes.push(document.nodes[0]);
  assert.throws(() => importWorkflowJson(JSON.stringify(document)), /duplicate/);
  assert.throws(() => importWorkflowJson('{"unrelated":"object"}'), /Tye workflow/);
});
