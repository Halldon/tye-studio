import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { Graph } from "../app/lib/server/recipes";
import { canonicalJson, defaultOutput, exportWorkflows, generatedArtifacts, loadBuilder, scenarios, validateGraph } from "../scripts/export-workflows.mjs";

test("committed API exports exactly match every supported application recipe and round-trip losslessly", async () => {
  const { RECIPES, validateGeneration, buildWorkflow } = await loadBuilder();
  const generated = await generatedArtifacts();
  assert.deepEqual(new Set(scenarios.map(scenario => scenario.recipeId)), new Set(RECIPES.map((recipe: { id: string }) => recipe.id)));
  assert.equal(scenarios.length, 8);
  for (const scenario of scenarios) {
    const stored = await readFile(resolve(defaultOutput, scenario.file), "utf8");
    assert.equal(stored, generated.get(scenario.file), scenario.file);
    const graph: Graph = JSON.parse(stored);
    const request = validateGeneration({ recipeId: scenario.recipeId, prompt: scenario.prompt, seed: 424242, inputAssetIds: scenario.images.map((_, index) => `example-reference-${index + 1}`), ...(scenario.mask ? { maskAssetId: "example-mask" } : {}) });
    assert.deepEqual(graph, buildWorkflow(request, scenario.images, {}, scenario.mask));
    assert.equal(canonicalJson(JSON.parse(JSON.stringify(graph))), stored);
    assert.ok(validateGraph(graph).nodeCount > 0);
    assert.ok(!("nodes" in graph), "API exports contain no frontend save-format wrapper");
  }
});

test("manifest hashes cover exact exported bytes and selected loader models", async () => {
  const generated = await generatedArtifacts();
  const manifest = JSON.parse(generated.get("manifest.json")!);
  assert.equal(manifest.schemaVersion, 1);
  for (const entry of manifest.workflows) {
    const bytes = generated.get(entry.file)!;
    const graph: Graph = JSON.parse(bytes);
    assert.equal(entry.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(graph["1"].inputs.unet_name, entry.models.unet.selected);
    assert.equal(graph["2"].inputs.clip_name, entry.models.clip.selected);
    assert.equal(graph["3"].inputs.vae_name, entry.models.vae.selected);
    assert.equal(entry.outputType, graph[entry.outputNodeId].class_type);
    assert.equal(entry.inputs.length, Object.values(graph).filter(node => node.class_type === "LoadImage").length);
  }
});

test("Klein reference edits derive dimensions from the scaled image instead of invented request dimensions", async () => {
  const artifacts = await generatedArtifacts();
  const graph: Graph = JSON.parse(artifacts.get("flux-klein-edit.api.json")!);
  assert.deepEqual(graph["6"].inputs.width, ["16", 0]);
  assert.deepEqual(graph["6"].inputs.height, ["16", 1]);
  assert.deepEqual(graph["7"].inputs.width, ["16", 0]);
  assert.deepEqual(graph["14"].inputs.latent, ["13", 0]);
  assert.deepEqual(graph["15"].inputs.latent, ["13", 0]);
  assert.deepEqual(graph["16"].inputs.image, ["12", 0]);
});

test("Qwen exports retain all references in both conditionings and preserve mask semantics", async () => {
  const artifacts = await generatedArtifacts();
  const multi: Graph = JSON.parse(artifacts.get("qwen-image-edit-multi-reference.api.json")!);
  for (const id of ["4", "5"]) {
    assert.deepEqual(multi[id].inputs.image1, ["12", 0]);
    assert.deepEqual(multi[id].inputs.image2, ["41", 0]);
    assert.deepEqual(multi[id].inputs.image3, ["42", 0]);
  }
  const masked: Graph = JSON.parse(artifacts.get("qwen-image-edit-masked.api.json")!);
  assert.equal(masked["44"].class_type, "LoadImage");
  assert.equal(masked["46"].class_type, "ImageCompositeMasked");
  assert.deepEqual(masked["46"].inputs.mask, ["44", 1]);
  assert.deepEqual(masked["46"].inputs.destination, ["40", 0]);
  assert.deepEqual(masked["46"].inputs.source, ["20", 0]);
  assert.equal(masked["46"].inputs.resize_source, true);
  assert.deepEqual(masked["99"].inputs.images, ["46", 0]);
  assert.ok(!Object.values(masked).some(node => /inpaint/i.test(node.class_type)), "post-generation compositing is not mask-conditioned diffusion");
});

test("Wan variants use 4n+1 frames, optional image input and current native video output selectors", async () => {
  const artifacts = await generatedArtifacts();
  const text: Graph = JSON.parse(artifacts.get("wan-2.2-5b-text-to-video.api.json")!);
  const image: Graph = JSON.parse(artifacts.get("wan-2.2-5b-image-to-video.api.json")!);
  assert.equal(text["7"].inputs.length, 49);
  assert.equal(image["7"].inputs.length, 49);
  assert.ok(!Object.hasOwn(text["7"].inputs, "start_image"));
  assert.deepEqual(image["7"].inputs.start_image, ["40", 0]);
  assert.deepEqual(image["21"].inputs.images, ["20", 0]);
  assert.equal(image["21"].inputs.fps, 24);
  assert.deepEqual(image["99"].inputs.video, ["21", 0]);
  assert.equal(image["99"].inputs.format, "mp4");
  assert.equal(image["99"].inputs["format.codec"], "h264");
});

test("SaveVideo DynamicCombo wire selectors reconstruct the required execution format argument", async () => {
  // Pinned official core 6b904b5f: DynamicCombo._expand_schema_for_dynamic
  // matches a scalar option key at each dotted API path. build_nested_inputs
  // then nests selectors, repeating each selector's final component.
  // A nested execute() argument sent on the wire passes validate_prompt but is
  // silently omitted here, which caused the first native Wan export to fail.
  const options: Record<string, Record<string, object>> = { mp4: { h264: {} } };
  function executionFormat(inputs: Record<string, unknown>) {
    if (typeof inputs.format !== "string" || !Object.hasOwn(options, inputs.format)) return undefined;
    const codec = inputs["format.codec"];
    if (typeof codec !== "string" || !Object.hasOwn(options[inputs.format], codec)) return undefined;
    return { format: inputs.format, codec: { codec } };
  }
  const artifacts = await generatedArtifacts();
  for (const file of ["wan-2.2-5b-text-to-video.api.json", "wan-2.2-5b-image-to-video.api.json"]) {
    const graph: Graph = JSON.parse(artifacts.get(file)!);
    assert.deepEqual(executionFormat(graph["99"].inputs), { format: "mp4", codec: { codec: "h264" } });
    const malformed = structuredClone(graph);
    malformed["99"].inputs.format = { format: "mp4", codec: { codec: "h264" } };
    delete malformed["99"].inputs["format.codec"];
    assert.throws(() => validateGraph(malformed), /flat.*DynamicCombo/);
  }
  assert.equal(executionFormat({ format: { format: "mp4", codec: { codec: "h264" } } }), undefined, "execute() dictionaries must never be sent as DynamicCombo wire selectors");
});

test("graph checks reject broken links, cycles, disconnected nodes and non-JSON values", async () => {
  const artifacts = await generatedArtifacts();
  const baseline: Graph = JSON.parse(artifacts.get("z-image-turbo.api.json")!);
  function changed(edit: (graph: Graph) => void) { const graph = structuredClone(baseline); edit(graph); return graph; }
  assert.throws(() => validateGraph(changed(graph => { graph["99"].inputs.images = ["missing", 0]; })), /Dangling/);
  assert.throws(() => validateGraph(changed(graph => { graph["99"].inputs.images = ["20", -1]; })), /Malformed/);
  assert.throws(() => validateGraph(changed(graph => { graph["20"].inputs.samples = ["99", 0]; })), /Cycle/);
  assert.throws(() => validateGraph(changed(graph => { graph["100"] = { class_type: "LoadImage", inputs: { image: "unused.png" } }; })), /disconnected/);
  assert.throws(() => validateGraph(changed(graph => { graph["4"].inputs.text = undefined; })), /Non-JSON/);
  assert.throws(() => validateGraph(changed(graph => { graph["8"].inputs.cfg = Infinity; })), /Non-finite/);
  assert.throws(() => validateGraph({ nodes: [] }), /Invalid API node/);
});

test("export is deterministic and check mode rejects modified, missing and obsolete artifacts", async () => {
  const first = await mkdtemp(resolve(tmpdir(), "tye-workflows-a-"));
  const second = await mkdtemp(resolve(tmpdir(), "tye-workflows-b-"));
  try {
    await exportWorkflows({ output: first }); await exportWorkflows({ output: second });
    const artifacts = await generatedArtifacts();
    for (const file of artifacts.keys()) assert.equal(await readFile(resolve(first, file), "utf8"), await readFile(resolve(second, file), "utf8"));
    await exportWorkflows({ output: first, check: true });
    await writeFile(resolve(first, scenarios[0].file), "{}\n");
    await assert.rejects(exportWorkflows({ output: first, check: true }), /stale/);
    await exportWorkflows({ output: first });
    await rm(resolve(first, scenarios[1].file));
    await assert.rejects(exportWorkflows({ output: first, check: true }), /missing/);
    await exportWorkflows({ output: first });
    await writeFile(resolve(first, "obsolete.api.json"), "{}\n");
    await assert.rejects(exportWorkflows({ output: first, check: true }), /obsolete.api.json/);
  } finally { await rm(first, { recursive: true, force: true }); await rm(second, { recursive: true, force: true }); }
});
