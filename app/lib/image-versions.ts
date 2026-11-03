type Documents = Record<string, unknown>;
const record = (value: unknown): Documents => value && typeof value === "object" && !Array.isArray(value) ? value as Documents : {};

/** Working autosaves never overwrite an accepted image version's editable snapshot. */
export function saveImageWork(project: Documents, assetId: string, document: unknown): { imageEdits: Documents; imageVersionDocuments: Documents } {
  const snapshots = record(project.imageVersionDocuments);
  return { imageEdits: { ...record(project.imageEdits), [assetId]: document },
    imageVersionDocuments: assetId === "canvas" || Object.hasOwn(snapshots, assetId) ? snapshots : { ...snapshots, [assetId]: structuredClone(document) } };
}

/** Legacy assets with no accepted editable document start from their actual source pixels. */
export function restoreImageVersion(project: Documents, assetId: string): Documents {
  const edits = { ...record(project.imageEdits) }; const snapshots = record(project.imageVersionDocuments);
  if (Object.hasOwn(snapshots, assetId)) edits[assetId] = structuredClone(snapshots[assetId]);
  else delete edits[assetId];
  return edits;
}
