import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's native type stripping uses the source extension.
import { assertPortableDocument, assertPortableExport, assetAncestryClosure, orderedPortableAssets, portableProjectAssets, preparePortableImport, referencedAssetIds, remapAssetIds, restoredComposerWorkspace, PORTABLE_LIMITS } from "../app/lib/project-portability.ts";
import type { Asset } from "../app/lib/server/contracts";

const entry = (id: string, parentAssetId?: string) => ({ id, parentAssetId, name: id + ".png", mimeType: "image/png", path: "media/" + id + ".png" });
const asset = (id: string, parentAssetId: string | null = null, projectId = "current"): Asset => ({ id, parentAssetId, versionRootId: parentAssetId || id,
  projectId, jobId: null, name: id, type: "image", mimeType: "image/png", size: 5, url: "/" + id,
  width: 720, height: 540, duration: null, starred: false, source: "upload", createdAt: "2026-11-02" });

test("portable import restores parents before branches regardless of archive ordering", () => {
  const values = [entry("branch", "revision"), entry("sibling", "original"), entry("revision", "original"), entry("original")];
  const sorted = orderedPortableAssets(values).map(value => value.id);
  assert.ok(sorted.indexOf("original") < sorted.indexOf("revision"));
  assert.ok(sorted.indexOf("revision") < sorted.indexOf("branch"));
  assert.ok(sorted.indexOf("original") < sorted.indexOf("sibling"));
  assert.equal(values[0].id, "branch", "validation must not mutate the source archive");
});
test("invalid version ancestry fails validation before import side effects", () => {
  assert.throws(() => orderedPortableAssets([entry("a", "b"), entry("b", "a")]), /cycle/);
  assert.throws(() => orderedPortableAssets([entry("a", "missing")]), /missing/);
  assert.throws(() => orderedPortableAssets([entry("a"), entry("a")]), /duplicated/);
});
test("export includes cross-project ancestors outside the loaded library", async () => {
  const calls: string[] = [];
  const originals = new Map([["original", asset("original", null, "another-project")], ["revision", asset("revision", "original", "another-project")]]);
  const result = await assetAncestryClosure([asset("child", "revision")], async id => { calls.push(id); return originals.get(id)!; });
  assert.deepEqual(new Set(result.map(value => value.id)), new Set(["child", "revision", "original"]));
  assert.deepEqual(calls, ["revision", "original"]);
});
test("export resolves shared ancestors once and rejects corrupt cycles", async () => {
  let reads = 0;
  const result = await assetAncestryClosure([asset("a", "root"), asset("b", "root")], async () => { reads++; return asset("root"); });
  assert.equal(reads, 1); assert.equal(result.length, 3);
  await assert.rejects(assetAncestryClosure([asset("a", "b"), asset("b", "a")], async () => { throw new Error("unexpected fetch"); }), /cycle/);
});
test("import remaps editable document keys, shot references, takes and selected versions", () => {
  const doc = { imageEdits: { original: { layers: [{ assetId: "original" }] } }, shots: { sceneReferenceAssetIds: ["original"],
    shots: [{ referenceAssetIds: ["original"], takeAssetIds: ["child"], selectedTakeAssetId: "child" }] }, activeImageAssetId: "child" };
  const mapped = remapAssetIds(doc, new Map([["original", "new-original"], ["child", "new-child"]]));
  assert.deepEqual(mapped, { imageEdits: { "new-original": { layers: [{ assetId: "new-original" }] } }, shots: { sceneReferenceAssetIds: ["new-original"],
    shots: [{ referenceAssetIds: ["new-original"], takeAssetIds: ["new-child"], selectedTakeAssetId: "new-child" }] }, activeImageAssetId: "new-child" });
  assert.equal(doc.activeImageAssetId, "child");
});

test("typed remapping preserves matching user text and structural keys", () => {
  const ids=new Map([["imageEdits","new-media"],["original","new-original"]]);
  const doc={prompt:"original",title:"original",imageEdits:{original:{sourceAssetId:"original",layers:[{assetId:"original",text:"original",name:"imageEdits"}]}},draft:{inputAssetIds:["original"],parentAssetId:"original"}};
  assert.deepEqual(remapAssetIds(doc,ids),{prompt:"original",title:"original",imageEdits:{"new-original":{sourceAssetId:"new-original",layers:[{assetId:"new-original",text:"original",name:"imageEdits"}]}},draft:{inputAssetIds:["new-original"],parentAssetId:"new-original"}});
});

function pngBytes() { const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);bytes.set([73,72,68,82],12);return bytes; }
const manifest=(document:unknown={},assets:unknown[]=[entry("original")])=>({format:"tye-studio",version:1,project:{name:"Portable",document},assets});
const importFiles=()=>({"media/original.png":pngBytes()});

test("export fetch closure includes project-scoped and uncached direct document references",async()=>{
  const calls:string[]=[];const source=new Map([["uncached-direct",asset("uncached-direct","uncached-root","another")],["uncached-root",asset("uncached-root",null,"another")]]);
  const result=await portableProjectAssets([asset("project-only")],{imageEdits:{canvas:{layers:[{assetId:"uncached-direct"}]}},prompt:"text-is-not-an-asset"},async id=>{calls.push(id);return source.get(id)!;});
  assert.deepEqual(new Set(result.map(a=>a.id)),new Set(["project-only","uncached-direct","uncached-root"]));assert.deepEqual(calls,["uncached-direct","uncached-root"]);
  assert.deepEqual([...referencedAssetIds({prompt:"original",draft:{inputAssetIds:["original"]}})],["original"]);
});
test("export resolves uncached historical input and mask references as well as the real document",async()=>{
  const calls:string[]=[];
  const refs={projectDocument:{activeImageAssetId:"visible"},historicalParameters:[{inputAssetIds:["old-input"],maskAssetId:"old-mask",prompt:"not-an-id"}]};
  const result=await portableProjectAssets([asset("visible")],refs,async id=>{calls.push(id);return asset(id,null,"another-project");});
  assert.deepEqual(calls,["old-input","old-mask"]);assert.deepEqual(new Set(result.map(item=>item.id)),new Set(["visible","old-input","old-mask"]));
});
test("export rejects archives its importer cannot restore before downloading media",()=>{
  assert.throws(()=>assertPortableExport([{...asset("large"),size:PORTABLE_LIMITS.mediaBytes+1}],{},10),/20 MB/);
  assert.throws(()=>assertPortableExport(Array.from({length:201},(_,i)=>asset(String(i))),{},10),/200 assets/);
  assert.throws(()=>assertPortableExport([{...asset("normal"),size:PORTABLE_LIMITS.mediaBytes}],{},PORTABLE_LIMITS.archiveBytes),/size limit/);
  assert.throws(()=>assertPortableDocument({text:"é".repeat(600000)}),/1 MB/);
});
test("import validates document shape, references, paths and actual media before writes",()=>{
  assert.throws(()=>preparePortableImport(manifest([]),importFiles()),/document must be an object/);
  assert.throws(()=>preparePortableImport(manifest({text:"x".repeat(1000000)}),importFiles()),/1 MB/);
  assert.throws(()=>preparePortableImport(manifest({activeImageAssetId:"missing"}),importFiles()),/missing from the archive/);
  assert.throws(()=>preparePortableImport(manifest({},[{...entry("original"),path:"media/../original.png"}]),importFiles()),/invalid/);
  assert.throws(()=>preparePortableImport(manifest(),{"media/original.png":new TextEncoder().encode("<svg><script>test</script></svg>")}),/unsupported/);
  assert.throws(()=>orderedPortableAssets([entry("original"),{...entry("other"),path:"media/original.png"}]),/duplicated/);
  const valid=preparePortableImport(manifest({imageEdits:{original:{layers:[{assetId:"original",text:"original"}]}}}),importFiles());assert.equal(valid.name,"Portable");assert.equal(valid.assets[0].id,"original");
});
test("restored model aligns only an active image/video composer",()=>{
  assert.equal(restoredComposerWorkspace("image","video"),"video");assert.equal(restoredComposerWorkspace("video","image"),"image");
  for(const workspace of ["edit","shots","library","queue","settings","sequence","workflows"])assert.equal(restoredComposerWorkspace(workspace,"video"),workspace);
  assert.equal(restoredComposerWorkspace("video",undefined),"video");
});
