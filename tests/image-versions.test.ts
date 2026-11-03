import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native type stripping uses the source extension.
import { restoreImageVersion, saveImageWork } from "../app/lib/image-versions.ts";

test("working autosaves cannot change the accepted source version", () => {
  const original = { layers: [{ assetId: "source" }], mask: [] };
  const initial = saveImageWork({}, "source", original);
  original.layers.push({ assetId: "text-layer" });
  const edited = saveImageWork(initial, "source", original);
  assert.deepEqual(restoreImageVersion(edited, "source"), { source: { layers: [{ assetId: "source" }], mask: [] } });
  assert.equal((edited.imageEdits.source as typeof original).layers.length, 2);
});
test("saved child versions retain their own editable document when another branch changes", () => {
  const initial = saveImageWork({}, "original", { layers: ["source"] });
  const child = saveImageWork(initial, "child", { layers: ["source", "accepted text"] });
  const work = saveImageWork(child, "child", { layers: ["source", "unsaved draft"] });
  const restored = restoreImageVersion(work, "child");
  assert.deepEqual(restored.child, { layers: ["source", "accepted text"] });
  assert.deepEqual(restored.original, { layers: ["source"] });
  assert.deepEqual(work.imageEdits.child, { layers: ["source", "unsaved draft"] });
});
test("legacy source versions restore from source pixels instead of a mismatched working draft", () => {
  const project = { imageEdits: { source: { layers: ["draft text"] }, other: { layers: ["keep"] } } };
  assert.deepEqual(restoreImageVersion(project, "source"), { other: { layers: ["keep"] } });
  assert.equal(project.imageEdits.source.layers[0], "draft text");
});
