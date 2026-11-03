#!/usr/bin/env node
/** Offline export of the actual application graphs. Never contacts an engine. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export const builderPath = "app/lib/server/recipes.ts";
export const defaultOutput = resolve(repositoryRoot, "workflows");
const seed = 424242;
const reference = "tye-reference-1.png";

// Only scenario inputs live here; every node and connection comes from buildWorkflow.
export const scenarios = [
  { file: "z-image-turbo.api.json", recipeId: "z-image-turbo", name: "Text to image", prompt: "A blue ceramic teapot on a warm wooden table, soft window light, product photograph.", images: [] },
  { file: "flux-klein-4b.api.json", recipeId: "flux-klein-4b", name: "Text to image", prompt: "A blue ceramic teapot on a warm wooden table, soft window light, product photograph.", images: [] },
  { file: "flux-klein-edit.api.json", recipeId: "flux-klein-edit", name: "Single reference edit", prompt: "Change the teapot to green ceramic. Preserve the composition and lighting.", images: [reference] },
  { file: "qwen-image-edit.api.json", recipeId: "qwen-image-edit", name: "Single reference edit", prompt: "Change the teapot to green ceramic. Preserve the composition and lighting.", images: [reference] },
  { file: "qwen-image-edit-multi-reference.api.json", recipeId: "qwen-image-edit", name: "Three reference edit", prompt: "Use the teapot from image 1, the color palette from image 2, and the table setting from image 3.", images: [reference, "tye-reference-2.png", "tye-reference-3.png"] },
  { file: "qwen-image-edit-masked.api.json", recipeId: "qwen-image-edit", name: "Instruction edit with masked compositing", prompt: "Change the teapot to green ceramic. Preserve the composition and lighting.", images: [reference], mask: "tye-mask.png" },
  { file: "wan-2.2-5b-text-to-video.api.json", recipeId: "wan-2.2-5b", name: "Text to video", prompt: "A blue ceramic teapot on a wooden table. The camera slowly moves closer, soft natural light.", images: [] },
  { file: "wan-2.2-5b-image-to-video.api.json", recipeId: "wan-2.2-5b", name: "Image to video", prompt: "The camera slowly moves closer to the teapot. Preserve the object, soft natural light.", images: [reference] },
];

/** Load the real TypeScript builder without a second bundle, node server or platform bindings. */
export async function loadBuilder() {
  const cache = new Map();
  async function moduleUrl(file) {
    if (cache.has(file)) return cache.get(file);
    const source = await readFile(file, "utf8");
    let code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
    for (const match of [...code.matchAll(/from\s+["']([^"']+)["']/g)]) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) throw new Error(`Workflow builder must stay platform independent: ${specifier}`);
      const target = resolve(dirname(file), specifier + (specifier.endsWith(".ts") ? "" : ".ts"));
      const url = await moduleUrl(target);
      code = code.replace(match[0], "from " + JSON.stringify(url));
    }
    const url = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
    cache.set(file, url);
    return url;
  }
  return import(await moduleUrl(resolve(repositoryRoot, builderPath)));
}

/** Stable nested dictionary order, fixed scenarios and seeds: identical input yields identical bytes. */
export function canonicalJson(value) {
  function sorted(item) {
    if (Array.isArray(item)) return item.map(sorted);
    if (item && typeof item === "object") return Object.fromEntries(Object.keys(item).sort().map(key => [key, sorted(item[key])]));
    return item;
  }
  return JSON.stringify(sorted(value), null, 2) + "\n";
}
const sha256 = value => createHash("sha256").update(value).digest("hex");
const dictionary = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Structural checks for the scalar/dictionary/link input subset used by these native recipes.
 * This does not substitute for an installed engine's node schemas or a GPU execution.
 */
export function validateGraph(graph) {
  if (!dictionary(graph) || !Object.keys(graph).length) throw new Error("Workflow must be a nonempty API-format node dictionary.");
  const dependencies = new Map();
  const outputs = [];
  for (const [id, node] of Object.entries(graph)) {
    if (!/^\d+$/.test(id) || !dictionary(node) || typeof node.class_type !== "string" || !node.class_type || !dictionary(node.inputs)) throw new Error(`Invalid API node: ${id}`);
    if (Object.keys(node).some(key => !["class_type", "inputs"].includes(key))) throw new Error(`Unexpected frontend or metadata field on node ${id}.`);
    const links = [];
    function inspect(value, at) {
      if (Array.isArray(value)) {
        if (value.length !== 2 || typeof value[0] !== "string" || !Number.isInteger(value[1]) || value[1] < 0) throw new Error(`Malformed node link at ${at}.`);
        if (!Object.hasOwn(graph, value[0])) throw new Error(`Dangling node link at ${at}: ${value[0]}`);
        links.push(value[0]);
      } else if (dictionary(value)) {
        for (const [key, child] of Object.entries(value)) inspect(child, `${at}.${key}`);
      } else if (value !== null && !["string", "number", "boolean"].includes(typeof value)) throw new Error(`Non-JSON input at ${at}.`);
      else if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`Non-finite input at ${at}.`);
    }
    inspect(node.inputs, `${id}.inputs`);
    dependencies.set(id, links);
    if (["SaveImage", "SaveVideo"].includes(node.class_type)) outputs.push(id);
  }
  if (outputs.length !== 1 || outputs[0] !== "99") throw new Error("Expected exactly one SaveImage/SaveVideo output at node 99.");
  const active = new Set(); const visited = new Set();
  function visit(id) {
    if (active.has(id)) throw new Error(`Cycle at node ${id}.`);
    if (visited.has(id)) return;
    active.add(id);
    for (const parent of dependencies.get(id)) visit(parent);
    active.delete(id); visited.add(id);
  }
  // Check every component for cycles before checking output reachability.
  for (const id of dependencies.keys()) visit(id);
  visited.clear(); visit("99");
  if (visited.size !== Object.keys(graph).length) throw new Error("Workflow contains nodes disconnected from its saved output.");
  return { nodeCount: visited.size, outputNodeId: "99", outputType: graph["99"].class_type };
}

export async function generatedArtifacts() {
  const { RECIPES, validateGeneration, buildWorkflow } = await loadBuilder();
  const artifacts = new Map(); const entries = [];
  for (const scenario of scenarios) {
    const recipe = RECIPES.find(value => value.id === scenario.recipeId);
    if (!recipe) throw new Error(`Recipe no longer exists: ${scenario.recipeId}`);
    const request = validateGeneration({ recipeId: recipe.id, prompt: scenario.prompt, seed, inputAssetIds: scenario.images.map((_, index) => `example-reference-${index + 1}`), ...(scenario.mask ? { maskAssetId: "example-mask" } : {}) });
    const graph = buildWorkflow(request, scenario.images, {}, scenario.mask);
    const checks = validateGraph(graph);
    const content = canonicalJson(graph);
    artifacts.set(scenario.file, content);
    entries.push({ file: scenario.file, recipeId: recipe.id, scenario: scenario.name, kind: recipe.kind, seed, inputs: [...scenario.images.map(filename => ({ filename, role: "reference" })), ...(scenario.mask ? [{ filename: scenario.mask, role: "transparent-selected-alpha-mask" }] : [])], models: Object.fromEntries(Object.entries(recipe.models).map(([role, alternatives]) => [role, { selected: alternatives[0], alternatives }])), defaults: recipe.defaults, sourceUrl: recipe.sourceUrl, ...checks, sha256: sha256(content) });
  }
  const manifest = { schemaVersion: 1, format: "ComfyUI API node dictionary", generator: "scripts/export-workflows.mjs", source: { file: builderPath, sha256: sha256(await readFile(resolve(repositoryRoot, builderPath))) }, verification: "Offline structural and deterministic export checks only; no engine execution or GPU compatibility claim.", workflows: entries };
  artifacts.set("manifest.json", canonicalJson(manifest));
  return artifacts;
}

export async function exportWorkflows({ output = defaultOutput, check = false } = {}) {
  const artifacts = await generatedArtifacts();
  if (check) {
    const stale = [];
    for (const [file, content] of artifacts) {
      try { if (await readFile(resolve(output, file), "utf8") !== content) stale.push(file); }
      catch (error) { if (error.code === "ENOENT") stale.push(file); else throw error; }
    }
    try { for (const file of await readdir(output)) if (file.endsWith(".api.json") && !artifacts.has(file)) stale.push(file); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (stale.length) throw new Error(`Workflow exports are missing, stale or unexpected: ${stale.join(", ")}. Run node scripts/export-workflows.mjs.`);
  } else {
    await mkdir(output, { recursive: true });
    for (const [file, content] of artifacts) await writeFile(resolve(output, file), content);
  }
  return { count: artifacts.size - 1, output, checked: check };
}

async function main() {
  let check = false; let output = defaultOutput;
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index];
    if (arg === "--check") check = true;
    else if (arg === "--out" && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) output = resolve(process.argv[++index]);
    else throw new Error("Usage: node scripts/export-workflows.mjs [--check] [--out DIRECTORY]");
  }
  const result = await exportWorkflows({ output, check });
  console.log(`${check ? "Verified" : "Exported"} ${result.count} native API workflows in ${result.output}. No engine requests made.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
