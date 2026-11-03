import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node's type-stripping runner requires the source extension.
import { assetVersions, generationRuns, lineageRoot, recipeInputIssue } from "../app/components/studio/studio-model.ts";
import type { Asset, Job, Recipe } from "../app/lib/types";

const recipe = (patch: Partial<Recipe> = {}): Recipe => ({ id: "image", name: "Image", description: "", kind: "image", capabilities: ["text-to-image"], availability: "available", missingModels: [], requiresInput: false, maxInputs: 0, defaults: { width: 1024, height: 1024, steps: 4 }, license: "Apache-2.0", sourceUrl: "https://docs.comfy.org", ...patch });
const asset = (id: string, patch: Partial<Asset> = {}): Asset => ({ id, projectId: "project", jobId: null, parentAssetId: null, versionRootId: null, name: id, type: "image", mimeType: "image/png", size: 100, url: `/assets/${id}`, width: 1024, height: 1024, duration: null, starred: false, source: "generation", createdAt: "2026-11-02T12:00:00Z", ...patch });
const job = (id: string, patch: Partial<Job> = {}): Job => ({ id, projectId: "project", recipeId: "image", status: "queued", prompt: "A still life", parameters: { recipeId: "image", prompt: "A still life" }, engineJobId: null, progress: null, stage: null, outputAssetIds: [], error: null, createdAt: "2026-11-02T12:00:00Z", updatedAt: "2026-11-02T12:00:00Z", completedAt: null, ...patch });

test("a generation feed groups real batch jobs without inventing outputs or leaking other projects", () => {
  const jobs = [job("a", { parameters: { recipeId: "image", prompt: "A still life", batchId: "batch" }, outputAssetIds: ["output", "missing", "foreign"] }), job("b", { parameters: { recipeId: "image", prompt: "A still life", batchId: "batch" }, status: "running", progress: .4 }), job("other", { projectId: "elsewhere", outputAssetIds: ["foreign"] })];
  const runs = generationRuns(jobs, [asset("output"), asset("foreign", { projectId: "elsewhere" })], [recipe()], "project", "image");
  assert.equal(runs.length, 1); assert.equal(runs[0].id, "batch"); assert.equal(runs[0].jobs.length, 2);
  assert.deepEqual(runs[0].outputs.map((value: Asset) => value.id), ["output"]);
  assert.equal(runs[0].jobs[0].progress, null); assert.equal(runs[0].jobs[1].progress, .4);
});

test("legacy jobs remain separate; retired recipe output type determines the right feed", () => {
  const jobs = [job("image-job", { status: "succeeded", outputAssetIds: ["still"] }), job("old-video", { recipeId: "retired", status: "succeeded", outputAssetIds: ["clip"] })];
  const assets = [asset("still"), asset("clip", { type: "video" })];
  assert.deepEqual(generationRuns(jobs, assets, [], "project", "image").map((run: { id: string }) => run.id), ["image-job"]);
  assert.deepEqual(generationRuns(jobs, assets, [], "project", "video").map((run: { id: string }) => run.id), ["old-video"]);
});

test("version history includes sibling branches without adding unrelated roots", () => {
  const root = asset("root"); const branch = asset("branch", { parentAssetId: "root", versionRootId: "root", createdAt: "2026-11-02T12:01:00Z" });
  const sibling = asset("sibling", { parentAssetId: "root", createdAt: "2026-11-02T12:02:00Z" });
  const descendant = asset("descendant", { parentAssetId: "branch", createdAt: "2026-11-02T12:03:00Z" });
  const foreign = asset("foreign", { projectId: "elsewhere", versionRootId: "another-root" });
  const values = [root, branch, sibling, descendant, foreign]; const snapshot = JSON.stringify(values);
  assert.deepEqual(assetVersions(branch, values).map((value: Asset) => value.id), ["root", "branch", "sibling", "descendant"]);
  assert.equal(JSON.stringify(values), snapshot);
});

test("owner-authorized originals and sibling branches remain connected across projects", () => {
  const original = asset("original", { projectId: "source-project", source: "upload", createdAt: "2026-11-02T10:00:00Z" });
  const child = asset("child", { projectId: "current-project", parentAssetId: "original", versionRootId: "original", createdAt: "2026-11-02T11:00:00Z" });
  const sibling = asset("sibling", { projectId: "other-project", parentAssetId: "original", createdAt: "2026-11-02T12:00:00Z" });
  const unrelated = asset("unrelated", { projectId: "current-project", versionRootId: "different-original" });
  const values = [child, sibling, original, unrelated];
  assert.equal(lineageRoot(sibling, values), "original");
  assert.deepEqual(assetVersions(child, values).map((value: Asset) => value.id), ["original", "child", "sibling"]);
  assert.deepEqual(assetVersions(original, values).map((value: Asset) => value.id), ["original", "child", "sibling"]);
});

test("a deleted original and cyclic imported ancestry do not break the inspector", () => {
  const child = asset("child", { parentAssetId: "deleted" });
  const sibling = asset("sibling", { versionRootId: "deleted" });
  assert.equal(lineageRoot(child, [child, sibling]), "deleted");
  assert.equal(assetVersions(child, [child, sibling]).length, 2);
  const a = asset("a", { parentAssetId: "b" }); const b = asset("b", { parentAssetId: "a" });
  assert.equal(assetVersions(a, [a, b]).length, 2);
});

test("zero-input workflows report incompatibility and required-input workflows stay discoverable", () => {
  assert.equal(recipeInputIssue(recipe(), 1), "Does not accept reference images");
  assert.equal(recipeInputIssue(recipe({ requiresInput: true, maxInputs: 3 }), 0), "Needs a source image");
  assert.equal(recipeInputIssue(recipe({ requiresInput: true, maxInputs: 3 }), 3), null);
  assert.equal(recipeInputIssue(recipe({ maxInputs: 1 }), 2), "Accepts up to 1 reference image");
});
