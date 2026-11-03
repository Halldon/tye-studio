export type MediaKind = 'image' | 'video' | 'audio';
export interface EditorAsset {
  id: string; name: string; type: MediaKind; url: string; thumbnailUrl?: string;
  width?: number; height?: number; duration?: number;
}
export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export interface ImageLayer extends Rect {
  id: string; name: string; kind: 'image' | 'text'; assetId?: string;
  rotation: number; opacity: number; visible: boolean;
  text?: string; fontSize?: number; color?: string;
}
export interface MaskStroke { id: string; mode: 'paint' | 'erase'; width: number; points: Point[] }
export interface ImageDocument {
  version: 1; width: number; height: number; sourceAssetId?: string;
  layers: ImageLayer[]; mask: MaskStroke[];
}
export interface AIEditRequest {
  image: Blob; mask?: Blob; prompt: string; width: number; height: number;
  sourceAssetId?: string; operation: 'image-edit' | 'inpaint'; document: ImageDocument;
}
export interface SequenceClip {
  id: string; assetId: string; in: number; out: number; caption: string; muted: boolean;
}
export interface SequenceDocument {
  version: 1; width: number; height: number; fps: number; clips: SequenceClip[];
  audio?: { assetId: string; offset: number; volume: number };
}
export type PortKind = MediaKind | 'text' | 'any' | 'unknown';
export type WorkflowOperation = 'image-generate' | 'image-edit' | 'video-generate' | 'upscale' | 'export';
export interface WorkflowExecutionRequest {
  operation: WorkflowOperation; prompt: string; inputAssetIds: string[]; width?: number; height?: number;
}
export interface WorkflowNodeData extends Record<string, unknown> {
  label: string; kind: 'asset' | 'text' | 'operation' | 'comfy'; output: PortKind;
  assetId?: string; text?: string; operation?: WorkflowOperation; classType?: string;
}
export interface WorkflowNode { id: string; position: Point; data: WorkflowNodeData }
export interface WorkflowEdge { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
export interface WorkflowDocument {
  version: 1; kind: 'tye-workflow'; nodes: WorkflowNode[]; edges: WorkflowEdge[];
  importKind?: 'comfy-api' | 'comfy-ui'; originalComfyJson?: string;
  scalarOverrides?: Record<string, Record<string, string | number | boolean>>;
}

export function editorId(prefix = 'item'): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const blankImageDocument = (): ImageDocument => ({ version: 1, width: 1024, height: 1024, layers: [], mask: [] });
export const blankSequenceDocument = (): SequenceDocument => ({ version: 1, width: 1280, height: 720, fps: 30, clips: [] });
export const blankWorkflowDocument = (): WorkflowDocument => ({ version: 1, kind: 'tye-workflow', nodes: [], edges: [] });

export function addImageLayer(document: ImageDocument, asset: EditorAsset): ImageDocument {
  const first = document.layers.length === 0;
  const sourceWidth = asset.width || 1024; const sourceHeight = asset.height || 1024;
  const canvasScale = Math.min(1, 8192 / sourceWidth, 8192 / sourceHeight);
  const width = first ? Math.max(16, Math.round(sourceWidth * canvasScale)) : document.width;
  const height = first ? Math.max(16, Math.round(sourceHeight * canvasScale)) : document.height;
  const ratio = Math.min(width / (asset.width || width), height / (asset.height || height));
  const layerWidth = (asset.width || width) * ratio;
  const layerHeight = (asset.height || height) * ratio;
  return { ...document, width, height, sourceAssetId: document.sourceAssetId || asset.id,
    layers: [...document.layers, { id: editorId('layer'), name: asset.name, kind: 'image', assetId: asset.id,
      x: (width - layerWidth) / 2, y: (height - layerHeight) / 2, width: layerWidth, height: layerHeight,
      rotation: 0, opacity: 1, visible: true }] };
}

export function cropImageDocument(document: ImageDocument, selection: Rect): ImageDocument {
  const x = clamp(Math.round(selection.x), 0, document.width - 1);
  const y = clamp(Math.round(selection.y), 0, document.height - 1);
  const width = clamp(Math.round(selection.width), 1, document.width - x);
  const height = clamp(Math.round(selection.height), 1, document.height - y);
  return { ...document, width, height,
    layers: document.layers.map(layer => ({ ...layer, x: layer.x - x, y: layer.y - y })),
    mask: document.mask.map(stroke => ({ ...stroke, points: stroke.points.map(point => ({ x: point.x - x, y: point.y - y })) })) };
}
export function resizeImageCanvas(document: ImageDocument, targetWidth: number, targetHeight: number): ImageDocument {
  const width = clamp(Math.round(targetWidth), 16, 8192); const height = clamp(Math.round(targetHeight), 16, 8192);
  const x = (width - document.width) / 2; const y = (height - document.height) / 2;
  return { ...document, width, height, layers: document.layers.map(layer => ({ ...layer, x: layer.x + x, y: layer.y + y })),
    mask: document.mask.map(stroke => ({ ...stroke, points: stroke.points.map(point => ({ x: point.x + x, y: point.y + y })) })) };
}

export function clipDuration(clip: SequenceClip): number { return Math.max(0.1, clip.out - clip.in); }
export function sequenceDuration(document: SequenceDocument): number { return document.clips.reduce((sum, clip) => sum + clipDuration(clip), 0); }
export function clipAtTime(document: SequenceDocument, time: number): { clip: SequenceClip; index: number; start: number; localTime: number } | undefined {
  let start = 0;
  for (let index = 0; index < document.clips.length; index++) {
    const clip = document.clips[index];
    const end = start + clipDuration(clip);
    if (time < end || index === document.clips.length - 1) return { clip, index, start, localTime: clamp(time - start, 0, clipDuration(clip)) };
    start = end;
  }
  return undefined;
}
export function splitSequenceClip(document: SequenceDocument, clipId: string, localTime: number): SequenceDocument {
  const clip = document.clips.find(item => item.id === clipId);
  if (!clip || localTime < 0.1 || localTime > clipDuration(clip) - 0.1) return document;
  const split = clip.in + localTime;
  return { ...document, clips: document.clips.flatMap(item => item.id === clipId
    ? [{ ...item, out: split }, { ...item, id: editorId('clip'), in: split }] : [item]) };
}
export function moveSequenceClip(document: SequenceDocument, clipId: string, direction: -1 | 1): SequenceDocument {
  const index = document.clips.findIndex(item => item.id === clipId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= document.clips.length) return document;
  const clips = [...document.clips];
  [clips[index], clips[target]] = [clips[target], clips[index]];
  return { ...document, clips };
}
export function timecode(seconds: number): string {
  const value = Math.max(0, seconds);
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}.${Math.floor((value % 1) * 100).toString().padStart(2, '0')}`;
}

export function workflowInputs(node: WorkflowNode): { id: string; type: PortKind; label: string }[] {
  if (node.data.kind !== 'operation') return [];
  switch (node.data.operation) {
    case 'image-generate': return [{ id: 'text', type: 'text', label: 'Prompt' }];
    case 'image-edit': return [{ id: 'image', type: 'image', label: 'Image' }, { id: 'text', type: 'text', label: 'Prompt' }];
    case 'video-generate': return [{ id: 'image', type: 'image', label: 'Start frame' }, { id: 'text', type: 'text', label: 'Motion' }];
    case 'upscale': return [{ id: 'image', type: 'image', label: 'Image' }];
    case 'export': return [{ id: 'media', type: 'any', label: 'Media' }];
    default: return [];
  }
}
export function workflowConnectionError(document: WorkflowDocument, sourceId: string, targetId: string, targetHandle?: string | null): string | null {
  if (document.importKind) return 'Imported Comfy topology is preserved. Create a native graph to edit connections.';
  if (sourceId === targetId) return 'A node cannot connect to itself.';
  const source = document.nodes.find(node => node.id === sourceId);
  const target = document.nodes.find(node => node.id === targetId);
  if (!source || !target) return 'Both nodes must exist.';
  const input = workflowInputs(target).find(port => port.id === targetHandle);
  if (!input) return 'Choose an input on an operation node.';
  if (input.type !== 'any' && input.type !== source.data.output) return `This input expects ${input.type}; the source produces ${source.data.output}.`;
  if (document.edges.some(edge => edge.target === targetId && edge.targetHandle === targetHandle)) return 'This input already has a connection. Remove it first.';
  const visited = new Set<string>();
  const reaches = (id: string): boolean => {
    if (id === sourceId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return document.edges.filter(edge => edge.source === id).some(edge => reaches(edge.target));
  };
  return reaches(targetId) ? 'This connection would create a cycle.' : null;
}

/** Resolve one operation only. An operation node is never treated as a generated asset. */
export function resolveWorkflowOperation(document: WorkflowDocument, nodeId: string): WorkflowExecutionRequest {
  if (document.importKind) throw new Error('Imported Comfy graphs are preserved documents. Validate and run them in the intended ComfyUI installation.');
  const node = document.nodes.find(item => item.id === nodeId);
  if (!node || node.data.kind !== 'operation' || !node.data.operation) throw new Error('Select an operation node first.');
  const inputAssetIds: string[] = []; const prompts: string[] = [];
  for (const port of workflowInputs(node)) {
    const connections = document.edges.filter(edge => edge.target === node.id && edge.targetHandle === port.id);
    if (connections.length !== 1) throw new Error(`Connect one ${port.type === 'any' ? 'media asset' : port.type === 'text' ? 'text prompt' : `${port.type} asset`} to “${port.label}” before running.`);
    const source = document.nodes.find(item => item.id === connections[0].source);
    if (!source) throw new Error(`The source for “${port.label}” is missing.`);
    if (source.data.kind === 'operation') throw new Error(`“${source.data.label}” has no computed asset in this graph. Run that operation first, then connect its result from the library as an asset node.`);
    if (port.type !== 'any' && port.type !== source.data.output) throw new Error(`“${port.label}” requires ${port.type}, but its source produces ${source.data.output}.`);
    if (port.type === 'text') {
      if (source.data.kind !== 'text' || !source.data.text?.trim()) throw new Error(`Write instructions in the text node connected to “${port.label}”.`);
      prompts.push(source.data.text.trim());
    } else {
      if (source.data.kind !== 'asset' || !source.data.assetId) throw new Error(`Choose a library asset for “${port.label}”.`);
      inputAssetIds.push(source.data.assetId);
    }
  }
  const width = typeof node.data.width === 'number' && Number.isFinite(node.data.width) ? clamp(Math.round(node.data.width), 16, 8192) : undefined;
  const height = typeof node.data.height === 'number' && Number.isFinite(node.data.height) ? clamp(Math.round(node.data.height), 16, 8192) : undefined;
  return { operation: node.data.operation, prompt: prompts.join('\n'), inputAssetIds: [...new Set(inputAssetIds)], ...(width ? { width } : {}), ...(height ? { height } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
export function importWorkflowJson(text: string): WorkflowDocument {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error('Expected a workflow JSON object.');
  if (value.kind === 'tye-workflow' && value.version === 1) {
    if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error('Workflow nodes and edges must be arrays.');
    const ids = new Set<string>();
    for (const node of value.nodes) {
      if (!isRecord(node) || typeof node.id !== 'string' || ids.has(node.id) || !isRecord(node.position) || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y) || !isRecord(node.data) || typeof node.data.label !== 'string') throw new Error('Invalid or duplicate workflow node.');
      ids.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const edge of value.edges) {
      if (!isRecord(edge) || typeof edge.id !== 'string' || edgeIds.has(edge.id) || !ids.has(String(edge.source)) || !ids.has(String(edge.target))) throw new Error('An edge is duplicated or points to a missing node.');
      edgeIds.add(edge.id);
    }
    const parsed = value as unknown as WorkflowDocument;
    if (!parsed.importKind) {
      for (const node of parsed.nodes) {
        if (!['asset', 'text', 'operation'].includes(node.data.kind) || !['image', 'video', 'audio', 'text', 'any'].includes(node.data.output)) throw new Error('Unsupported native node type.');
        if (node.data.kind === 'operation' && !['image-generate', 'image-edit', 'video-generate', 'upscale', 'export'].includes(node.data.operation || '')) throw new Error('Unsupported workflow operation.');
      }
      const validated = { ...parsed, edges: [] as WorkflowEdge[] };
      for (const edge of parsed.edges) {
        const error = workflowConnectionError(validated, edge.source, edge.target, edge.targetHandle);
        if (error) throw new Error(`Invalid connection: ${error}`);
        validated.edges.push(edge);
      }
    }
    return parsed;
  }
  if (Array.isArray(value.nodes) && Array.isArray(value.links)) {
    const nodes: WorkflowNode[] = value.nodes.filter(isRecord).map((node, index) => ({ id: String(node.id ?? index), position: { x: index % 4 * 270, y: Math.floor(index / 4) * 160 },
      data: { label: String(node.title ?? node.type ?? `Node ${index}`), kind: 'comfy', output: 'unknown', classType: String(node.type ?? 'Unknown') } }));
    return { version: 1, kind: 'tye-workflow', nodes, edges: [], importKind: 'comfy-ui', originalComfyJson: text };
  }
  const entries = Object.entries(value);
  if (entries.length && entries.every(([, node]) => isRecord(node) && typeof node.class_type === 'string' && isRecord(node.inputs))) {
    const edges: WorkflowEdge[] = [];
    const ids = new Set(entries.map(([id]) => id));
    const nodes: WorkflowNode[] = entries.map(([id, raw], index) => {
      const node = raw as { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } };
      for (const [input, link] of Object.entries(node.inputs)) if (Array.isArray(link) && link.length === 2 && ids.has(String(link[0])) && typeof link[1] === 'number') edges.push({ id: `${link[0]}-${id}-${input}`, source: String(link[0]), target: id, targetHandle: input });
      return { id, position: { x: index % 4 * 270, y: Math.floor(index / 4) * 160 }, data: { label: node._meta?.title || node.class_type, kind: 'comfy', output: 'unknown', classType: node.class_type, inputNames: Object.entries(node.inputs).filter(([, link]) => Array.isArray(link) && link.length === 2 && ids.has(String(link[0])) && typeof link[1] === 'number').map(([input]) => input) } };
    });
    return { version: 1, kind: 'tye-workflow', nodes, edges, importKind: 'comfy-api', originalComfyJson: text, scalarOverrides: {} };
  }
  throw new Error('Use a Tye workflow, Comfy UI workflow, or Comfy API-format graph.');
}
export function exportComfyGraph(document: WorkflowDocument): string {
  if (!document.originalComfyJson) throw new Error('No imported Comfy workflow is attached.');
  if (document.importKind !== 'comfy-api' || !Object.keys(document.scalarOverrides || {}).length) return document.originalComfyJson;
  const graph = JSON.parse(document.originalComfyJson);
  for (const [node, inputs] of Object.entries(document.scalarOverrides || {})) {
    for (const [input, value] of Object.entries(inputs)) {
      const existing = graph[node]?.inputs?.[input];
      if (!['string', 'number', 'boolean'].includes(typeof existing) || typeof existing !== typeof value || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Only existing scalar inputs with the same type can be edited.');
      graph[node].inputs[input] = value;
    }
  }
  return JSON.stringify(graph, null, 2);
}
