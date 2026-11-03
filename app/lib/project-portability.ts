import type { Asset } from "./server/contracts";

export const PORTABLE_LIMITS = { assets: 200, archiveBytes: 150 * 1024 * 1024, expandedBytes: 250 * 1024 * 1024, mediaBytes: 20 * 1024 * 1024, manifestBytes: 20 * 1024 * 1024, documentRequestBytes: 1_000_000 };
export interface PortableAsset { id: string; name: string; mimeType: string; path: string; parentAssetId?: string | null; versionRootId?: string | null }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const singleRefs = new Set(["assetId", "sourceAssetId", "parentAssetId", "versionRootId", "activeImageAssetId", "frameSourceAssetId", "selectedTakeAssetId", "maskAssetId"]);
const arrayRefs = new Set(["inputAssetIds", "referenceAssetIds", "sceneReferenceAssetIds", "manualTakeAssetIds", "takeAssetIds", "outputAssetIds"]);
const assetMaps = new Set(["imageEdits", "imageVersionDocuments"]);

/** Only typed media references are IDs; matching prompt/text/structural strings remain unchanged. */
export function referencedAssetIds(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach(item => referencedAssetIds(item, result));
  else if (record(value)) for (const [key, item] of Object.entries(value)) {
    if (singleRefs.has(key) && typeof item === "string" && item) result.add(item);
    else if (arrayRefs.has(key) && Array.isArray(item)) item.forEach(id => { if (typeof id === "string" && id) result.add(id); });
    if (assetMaps.has(key) && record(item)) Object.keys(item).forEach(id => { if (id !== "canvas") result.add(id); });
    referencedAssetIds(item, result);
  }
  return result;
}
export function remapAssetIds(value: unknown, ids: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map(item => remapAssetIds(item, ids));
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (singleRefs.has(key) && typeof item === "string") return [key, ids.get(item) || item];
    if (arrayRefs.has(key) && Array.isArray(item)) return [key, item.map(id => typeof id === "string" ? ids.get(id) || id : id)];
    if (assetMaps.has(key) && record(item)) return [key, Object.fromEntries(Object.entries(item).map(([id, doc]) => [id === "canvas" ? id : ids.get(id) || id, remapAssetIds(doc, ids)]))];
    return [key, remapAssetIds(item, ids)];
  }));
  return value;
}
export function restoredComposerWorkspace<T extends string>(current: T, kind?: "image" | "video"): T | "image" | "video" {
  return kind && (current === "image" || current === "video") ? kind : current;
}
export function assertPortableDocument(document: unknown, ids?: Map<string, string>): Record<string, unknown> {
  const doc = document === undefined || document === null ? {} : document;
  if (!record(doc)) throw new Error("The project document must be an object.");
  const bytes = new TextEncoder().encode(JSON.stringify({ document: ids ? remapAssetIds(doc, ids) : doc })).byteLength;
  if (bytes > PORTABLE_LIMITS.documentRequestBytes) throw new Error("This project's editable document exceeds the 1 MB restore limit. Split it into smaller projects before exporting.");
  return doc;
}

/** Parents precede children; invalid archives fail before any project or upload is created. */
export function orderedPortableAssets(value: unknown): PortableAsset[] {
  if (!Array.isArray(value) || value.length > PORTABLE_LIMITS.assets) throw new Error("A portable project may contain up to 200 assets.");
  const byId = new Map<string, PortableAsset>(); const paths = new Set<string>();
  for (const raw of value) {
    if (!record(raw)) throw new Error("A project asset is invalid.");
    const asset = raw as unknown as PortableAsset;
    if (typeof asset.id !== "string" || !asset.id || asset.id === "canvas" || asset.id.length > 150 || byId.has(asset.id) ||
      typeof asset.name !== "string" || !asset.name || asset.name.length > 180 || /[\u0000-\u001f/\\]/.test(asset.name) ||
      typeof asset.path !== "string" || !asset.path.startsWith("media/") || asset.path.length > 500 || /[\\\u0000-\u001f]/.test(asset.path) || asset.path.split("/").some(part => !part || part === "." || part === "..") || paths.has(asset.path) ||
      typeof asset.mimeType !== "string" || !/^(image|video|audio)\//.test(asset.mimeType) ||
      asset.parentAssetId !== undefined && asset.parentAssetId !== null && (typeof asset.parentAssetId !== "string" || asset.parentAssetId.length > 150)) throw new Error("A project asset is invalid or duplicated.");
    byId.set(asset.id, asset); paths.add(asset.path);
  }
  const result: PortableAsset[] = []; const visiting = new Set<string>(); const done = new Set<string>();
  const visit = (asset: PortableAsset) => {
    if (done.has(asset.id)) return;
    if (visiting.has(asset.id)) throw new Error("This project contains a cycle in its version history.");
    visiting.add(asset.id);
    if (asset.parentAssetId) { const parent = byId.get(asset.parentAssetId); if (!parent) throw new Error("An original version is missing from this project archive."); visit(parent); }
    visiting.delete(asset.id); done.add(asset.id); result.push(asset);
  };
  byId.forEach(visit); return result;
}
export async function assetAncestryClosure(initial: Asset[], resolve: (id: string) => Promise<Asset>): Promise<Asset[]> {
  const found = new Map(initial.map(asset => [asset.id, asset])); const visiting = new Set<string>(); const done = new Set<string>();
  const visit = async (asset: Asset) => {
    if (found.size > PORTABLE_LIMITS.assets) throw new Error("This project and its source versions exceed the 200-asset portable-project limit.");
    if (done.has(asset.id)) return;
    if (visiting.has(asset.id)) throw new Error("The project's version history contains a cycle.");
    visiting.add(asset.id);
    if (asset.parentAssetId) {
      let parent = found.get(asset.parentAssetId);
      if (!parent) { parent = await resolve(asset.parentAssetId); if (!parent || parent.id !== asset.parentAssetId) throw new Error("A source version could not be resolved."); found.set(parent.id, parent); }
      await visit(parent);
    }
    visiting.delete(asset.id); done.add(asset.id);
  };
  for (const asset of initial) await visit(asset);
  return [...found.values()];
}
export async function portableProjectAssets(projectAssets: Asset[], document: unknown, resolve: (id: string) => Promise<Asset>): Promise<Asset[]> {
  const found = new Map(projectAssets.map(asset => [asset.id, asset]));
  if (found.size > PORTABLE_LIMITS.assets) throw new Error("A portable project may contain up to 200 assets.");
  for (const id of referencedAssetIds(document)) if (!found.has(id)) {
    const asset = await resolve(id); if (!asset || asset.id !== id) throw new Error("A media file referenced by this project is missing. Relink it before exporting."); found.set(id, asset);
  }
  return assetAncestryClosure([...found.values()], async id => found.get(id) || resolve(id));
}
export function assertPortableExport(assets: Asset[], document: unknown, manifestBytes: number): void {
  if (assets.length > PORTABLE_LIMITS.assets) throw new Error("A portable project may contain up to 200 assets.");
  // Imported media receives fresh UUIDs. Check the exact serialized-ID width before generating an archive.
  const futureIds = new Map(assets.map((asset, index) => [asset.id, `00000000-0000-4000-8000-${String(index).padStart(12,"0")}`]));
  assertPortableDocument(document, futureIds);
  if (assets.some(asset => !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > PORTABLE_LIMITS.mediaBytes)) throw new Error("Portable projects support media files up to 20 MB. This project contains a larger file; export that media separately or reduce it first.");
  const total = assets.reduce((n, asset) => n + asset.size, manifestBytes);
  if (manifestBytes > PORTABLE_LIMITS.manifestBytes || total > PORTABLE_LIMITS.expandedBytes || total > PORTABLE_LIMITS.archiveBytes) throw new Error("This project exceeds the portable-project size limit. Split it into smaller projects.");
}
function mediaMime(bytes: Uint8Array): string | null {
  const text = (a:number,b:number) => String.fromCharCode(...bytes.slice(a,b));
  if (bytes.length>=24 && bytes[0]===137 && text(1,4)==="PNG" && text(12,16)==="IHDR") return "image/png";
  if (bytes.length>12 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return "image/jpeg";
  if (bytes.length>=12 && text(0,4)==="RIFF" && text(8,12)==="WEBP") return "image/webp";
  if (bytes.length>=10 && ["GIF87a","GIF89a"].includes(text(0,6))) return "image/gif";
  if (bytes.length>=12 && text(4,8)==="ftyp") return "video/mp4";
  if (bytes.length>=4 && bytes[0]===0x1a && bytes[1]===0x45 && bytes[2]===0xdf && bytes[3]===0xa3) return "video/webm";
  if (bytes.length>=12 && text(0,4)==="RIFF" && text(8,12)==="WAVE") return "audio/wav";
  if (text(0,3)==="ID3" || (bytes.length>2 && bytes[0]===255 && (bytes[1]&0xe0)===0xe0)) return "audio/mpeg";
  if (text(0,4)==="OggS") return "audio/ogg";
  return null;
}
export function preparePortableImport(value: unknown, files: Record<string, Uint8Array>): { name: string; document: Record<string, unknown>; assets: PortableAsset[] } {
  if (!record(value) || value.format !== "tye-studio" || value.version !== 1 || !record(value.project)) throw new Error("Unsupported portable project format.");
  const name = value.project.name === undefined ? "Imported project" : value.project.name;
  if (typeof name !== "string" || !name.trim() || name.length>100) throw new Error("The project name must contain 1–100 characters.");
  const assets = orderedPortableAssets(value.assets); const ids = new Set(assets.map(asset => asset.id));
  const futureIds = new Map(assets.map((asset,index) => [asset.id,`00000000-0000-4000-8000-${String(index).padStart(12,"0")}`]));
  const document = assertPortableDocument(value.project.document, futureIds);
  if ([...referencedAssetIds(document)].some(id => !ids.has(id))) throw new Error("A media file referenced by this project is missing from the archive.");
  let expanded = 0;
  for (const [path, bytes] of Object.entries(files)) {
    expanded += bytes.byteLength;
    if (bytes.byteLength > (path === "project.json" ? PORTABLE_LIMITS.manifestBytes : PORTABLE_LIMITS.mediaBytes)) throw new Error("An archive entry exceeds its size limit.");
  }
  if (expanded > PORTABLE_LIMITS.expandedBytes) throw new Error("This archive exceeds the expanded size limit.");
  for (const asset of assets) {
    const bytes=files[asset.path]; if (!bytes || !bytes.byteLength || bytes.byteLength>PORTABLE_LIMITS.mediaBytes) throw new Error("A project media file is missing or exceeds 20 MB.");
    if (mediaMime(bytes)!==asset.mimeType) throw new Error("A project media file is unsupported or does not match its declared format.");
  }
  return { name: name.trim(), document, assets };
}
