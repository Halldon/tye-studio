import type { GenerationRequest, Recipe } from "./contracts";
import { ApiFailure } from "./errors";

export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
export interface RecipeDefinition extends Recipe {
  models: Record<string, string[]>; nodes: string[];
}
const common = { availability: "unverified" as const, missingModels: [], maxInputs: 0, requiresInput: false };
export const RECIPES: RecipeDefinition[] = [
  { ...common, id: "z-image-turbo", name: "Z-Image Turbo", description: "Fast local image generation with an 8-step native workflow.", kind: "image", capabilities: ["text-to-image"], defaults: { width: 1024, height: 1024, steps: 8 }, license: "Apache-2.0", sourceUrl: "https://docs.comfy.org/tutorials/image/z-image/z-image-turbo", models: { unet: ["z_image_turbo_bf16.safetensors"], clip: ["qwen_3_4b.safetensors"], vae: ["ae.safetensors"] }, nodes: ["UNETLoader", "CLIPLoader", "ModelSamplingAuraFlow", "KSampler", "EmptySD3LatentImage"] },
  { ...common, id: "flux-klein-4b", name: "FLUX.2 Klein 4B", description: "Four-step image generation with the Apache-licensed Klein model.", kind: "image", capabilities: ["text-to-image"], defaults: { width: 1024, height: 1024, steps: 4 }, license: "Apache-2.0", sourceUrl: "https://docs.comfy.org/tutorials/flux/flux-2-klein", models: { unet: ["flux-2-klein-4b-fp8.safetensors", "flux-2-klein-4b.safetensors"], clip: ["qwen_3_4b.safetensors"], vae: ["flux2-vae.safetensors"] }, nodes: ["UNETLoader", "Flux2Scheduler", "CFGGuider", "EmptyFlux2LatentImage", "SamplerCustomAdvanced"] },
  { ...common, id: "flux-klein-edit", name: "FLUX.2 Klein Edit", description: "Edit one reference image with a natural-language instruction.", kind: "image", capabilities: ["image-edit"], requiresInput: true, maxInputs: 1, defaults: { width: 1024, height: 1024, steps: 4 }, license: "Apache-2.0", sourceUrl: "https://docs.comfy.org/tutorials/flux/flux-2-klein", models: { unet: ["flux-2-klein-4b-fp8.safetensors", "flux-2-klein-4b.safetensors"], clip: ["qwen_3_4b.safetensors"], vae: ["flux2-vae.safetensors"] }, nodes: ["ReferenceLatent", "Flux2Scheduler", "CFGGuider", "EmptyFlux2LatentImage", "SamplerCustomAdvanced"] },
  { ...common, id: "qwen-image-edit", name: "Qwen Image Edit 2511", description: "Instruction and reference edits; an optional alpha mask composites the result over the original, preserving pixels outside the selection.", kind: "image", capabilities: ["image-edit", "multi-reference", "masked-composite"], requiresInput: true, maxInputs: 3, defaults: { width: 1024, height: 1024, steps: 40 }, license: "Apache-2.0", sourceUrl: "https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511", models: { unet: ["qwen_image_edit_2511_fp8mixed.safetensors", "qwen_image_edit_2511_bf16.safetensors"], clip: ["qwen_2.5_vl_7b_fp8_scaled.safetensors"], vae: ["qwen_image_vae.safetensors"] }, nodes: ["TextEncodeQwenImageEditPlus", "FluxKontextMultiReferenceLatentMethod", "CFGNorm", "ModelSamplingAuraFlow", "KSampler"] },
  { ...common, id: "wan-2.2-5b", name: "Wan 2.2 · 5B", description: "Short text-to-video or image-to-video clips using native Wan nodes.", kind: "video", capabilities: ["text-to-video", "image-to-video"], maxInputs: 1, defaults: { width: 832, height: 480, steps: 20, duration: 2, fps: 24 }, license: "Apache-2.0 (verify each companion)", sourceUrl: "https://docs.comfy.org/tutorials/video/wan/wan2_2", models: { unet: ["wan2.2_ti2v_5B_fp16.safetensors"], clip: ["umt5_xxl_fp8_e4m3fn_scaled.safetensors"], vae: ["wan2.2_vae.safetensors"] }, nodes: ["Wan22ImageToVideoLatent", "ModelSamplingSD3", "KSampler", "CreateVideo", "SaveVideo"] },
];
for (const recipe of RECIPES) {
  recipe.capabilities.push("seed", "steps");
  if (!recipe.requiresInput) recipe.capabilities.push("dimensions");
  if (recipe.id === "qwen-image-edit" || recipe.kind === "video") recipe.capabilities.push("negative-prompt");
  if (recipe.kind === "video") recipe.capabilities.push("duration", "fps");
}
export function recipeById(id: string): RecipeDefinition {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) throw new ApiFailure(400, "unknown_recipe", "Choose a supported model workflow.");
  return recipe;
}
export function publicRecipe(recipe: RecipeDefinition): Recipe {
  // Engine dependency definitions are excluded from the public recipe contract.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { models: _models, nodes: _nodes, ...value } = recipe;
  return value;
}
export function validateGeneration(input: GenerationRequest): GenerationRequest {
  const recipe = recipeById(input.recipeId);
  for (const key of ["projectId", "maskAssetId", "requestId", "batchId", "parentAssetId", "shotId"] as const) if (input[key] !== undefined && input[key] !== null && (typeof input[key] !== "string" || input[key]!.length > 100)) throw new ApiFailure(400, "invalid_identifier", "A project, asset or grouping identifier is invalid.");
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 12000) throw new ApiFailure(400, "invalid_prompt", "Enter a prompt between 1 and 12,000 characters.");
  const inputs = input.inputAssetIds || [];
  if (!Array.isArray(inputs) || inputs.some((id) => typeof id !== "string") || inputs.length > recipe.maxInputs || (recipe.requiresInput && !inputs.length)) throw new ApiFailure(400, "invalid_inputs", recipe.requiresInput ? "Add a reference image for this workflow." : "This workflow does not accept that many references.");
  if (input.maskAssetId && recipe.id !== "qwen-image-edit") throw new ApiFailure(400, "mask_not_supported", "Choose Qwen Image Edit to composite a masked instruction edit.");
  const width = input.width ?? recipe.defaults.width; const height = input.height ?? recipe.defaults.height;
  const sourceEdit = recipe.kind === "image" && recipe.requiresInput;
  const maxSize = recipe.kind === "video" ? 1280 : 2048;
  const multiple = recipe.kind === "video" ? 32 : 16;
  if (sourceEdit) {
    if (![width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= 16384)) throw new ApiFailure(400, "invalid_dimensions", "Source dimensions must be valid integers between 1 and 16384.");
  } else if (![width, height].every((n) => Number.isInteger(n) && n >= 256 && n <= maxSize && n % multiple === 0) || width * height > (recipe.kind === "video" ? 1_000_000 : 4_194_304)) throw new ApiFailure(400, "invalid_dimensions", `Choose dimensions in multiples of ${multiple} within the model limits.`);
  const steps = input.steps ?? recipe.defaults.steps;
  if (!Number.isInteger(steps) || steps < 1 || steps > 60) throw new ApiFailure(400, "invalid_steps", "Sampling steps must be between 1 and 60.");
  const seed = input.seed ?? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new ApiFailure(400, "invalid_seed", "Use a nonnegative, safe integer seed.");
  if (input.negativePrompt && (typeof input.negativePrompt !== "string" || input.negativePrompt.length > 12000)) throw new ApiFailure(400, "invalid_prompt", "The negative prompt is too long.");
  if (input.negativePrompt?.trim() && !recipe.capabilities.includes("negative-prompt")) throw new ApiFailure(400, "negative_prompt_not_supported", "This recipe does not use a negative prompt.");
  const duration = recipe.kind === "video" ? input.duration ?? 2 : undefined;
  const fps = recipe.kind === "video" ? input.fps ?? 24 : undefined;
  if (duration !== undefined && (!Number.isFinite(duration) || duration < 1 || duration > 5)) throw new ApiFailure(400, "invalid_duration", "Video clips must be between 1 and 5 seconds.");
  if (fps !== undefined && ![16, 24].includes(fps)) throw new ApiFailure(400, "invalid_fps", "Choose 16 or 24 frames per second.");
  return { recipeId: recipe.id, projectId: input.projectId || null, prompt: input.prompt.trim(), negativePrompt: input.negativePrompt || "", width, height, steps, seed, inputAssetIds: inputs, ...(input.maskAssetId ? { maskAssetId: input.maskAssetId } : {}), ...(duration ? { duration, fps } : {}), ...(input.requestId ? { requestId: input.requestId } : {}), ...(input.batchId ? { batchId: input.batchId } : {}), ...(input.parentAssetId ? { parentAssetId: input.parentAssetId } : {}), ...(input.shotId ? { shotId: input.shotId } : {}) };
}

/** Graphs mirror native template node types, without frontend subgraph/layout constructs. */
export function buildWorkflow(p: GenerationRequest, filenames: unknown[] = [], chosen: Record<string, string> = {}, mask?: unknown): Graph {
  const recipe = recipeById(p.recipeId);
  const model = (key: string) => chosen[key] || recipe.models[key][0];
  const g: Graph = {};
  const add = (id: string, type: string, inputs: Record<string, unknown>) => { g[id] = { class_type: type, inputs }; return [id, 0]; };
  const unet = add("1", "UNETLoader", { unet_name: model("unet"), weight_dtype: "default" });
  const clip = add("2", "CLIPLoader", { clip_name: model("clip"), type: p.recipeId.startsWith("flux-") ? "flux2" : p.recipeId === "qwen-image-edit" ? "qwen_image" : p.recipeId === "wan-2.2-5b" ? "wan" : "lumina2", device: "default" });
  const vae = add("3", "VAELoader", { vae_name: model("vae") });
  const loaded = filenames.map((file, i) => add(String(40 + i), "LoadImage", { image: file }));
  let output: unknown;
  if (p.recipeId.startsWith("flux-")) {
    const positive = add("4", "CLIPTextEncode", { clip, text: p.prompt });
    let pos: unknown = positive; let neg: unknown = add("5", "ConditioningZeroOut", { conditioning: positive });
    let width: unknown = p.width; let height: unknown = p.height;
    if (loaded.length) {
      const scaled = add("12", "ImageScaleToTotalPixels", { image: loaded[0], upscale_method: "nearest-exact", megapixels: 1, resolution_steps: 1 });
      const ref = add("13", "VAEEncode", { pixels: scaled, vae });
      pos = add("14", "ReferenceLatent", { conditioning: pos, latent: ref });
      neg = add("15", "ReferenceLatent", { conditioning: neg, latent: ref });
      width = add("16", "GetImageSize", { image: scaled }); height = ["16", 1];
    }
    const latent = add("6", "EmptyFlux2LatentImage", { width, height, batch_size: 1 });
    const sigmas = add("7", "Flux2Scheduler", { steps: p.steps, width, height });
    const guider = add("8", "CFGGuider", { model: unet, positive: pos, negative: neg, cfg: 1 });
    const noise = add("9", "RandomNoise", { noise_seed: p.seed });
    const sampler = add("10", "KSamplerSelect", { sampler_name: "euler" });
    const sampled = add("11", "SamplerCustomAdvanced", { noise, guider, sampler, sigmas, latent_image: latent });
    output = add("20", "VAEDecode", { samples: sampled, vae });
  } else if (p.recipeId === "qwen-image-edit") {
    const scaled = add("12", "FluxKontextImageScale", { image: loaded[0] });
    const refs = { image1: scaled, ...(loaded[1] ? { image2: loaded[1] } : {}), ...(loaded[2] ? { image3: loaded[2] } : {}) };
    const pos = add("4", "TextEncodeQwenImageEditPlus", { clip, vae, prompt: p.prompt, ...refs });
    const neg = add("5", "TextEncodeQwenImageEditPlus", { clip, vae, prompt: p.negativePrompt || "", ...refs });
    const positive = add("14", "FluxKontextMultiReferenceLatentMethod", { conditioning: pos, reference_latents_method: "index_timestep_zero" });
    const negative = add("15", "FluxKontextMultiReferenceLatentMethod", { conditioning: neg, reference_latents_method: "index_timestep_zero" });
    const shifted = add("6", "ModelSamplingAuraFlow", { model: unet, shift: 3.1 });
    const normalized = add("7", "CFGNorm", { model: shifted, strength: 1 });
    const latent = add("8", "VAEEncode", { pixels: scaled, vae });
    const sampled = add("9", "KSampler", { model: normalized, positive, negative, latent_image: latent, seed: p.seed, steps: p.steps, cfg: 4, sampler_name: "euler", scheduler: "simple", denoise: 1 });
    output = add("20", "VAEDecode", { samples: sampled, vae });
    if (mask) {
      add("44", "LoadImage", { image: mask });
      // Editor masks use transparency for selected pixels. Comfy LoadImage's MASK output is 1-alpha.
      const maskValue = ["44", 1];
      output = add("46", "ImageCompositeMasked", { destination: loaded[0], source: output, x: 0, y: 0, resize_source: true, mask: maskValue });
    }
  } else {
    const positive = add("4", "CLIPTextEncode", { clip, text: p.prompt });
    const negative = p.recipeId === "wan-2.2-5b" ? add("5", "CLIPTextEncode", { clip, text: p.negativePrompt || "low quality, blurry, distorted" }) : add("5", "ConditioningZeroOut", { conditioning: positive });
    const modelNode = p.recipeId === "wan-2.2-5b" ? add("6", "ModelSamplingSD3", { model: unet, shift: 8 }) : add("6", "ModelSamplingAuraFlow", { model: unet, shift: 3 });
    const latent = p.recipeId === "wan-2.2-5b" ? add("7", "Wan22ImageToVideoLatent", { vae, width: p.width, height: p.height, length: Math.floor((p.duration || 2) * (p.fps || 24) / 4) * 4 + 1, batch_size: 1, ...(loaded[0] ? { start_image: loaded[0] } : {}) }) : add("7", "EmptySD3LatentImage", { width: p.width, height: p.height, batch_size: 1 });
    const sampled = add("8", "KSampler", { model: modelNode, positive, negative, latent_image: latent, seed: p.seed, steps: p.steps, cfg: p.recipeId === "wan-2.2-5b" ? 5 : 1, sampler_name: p.recipeId === "wan-2.2-5b" ? "uni_pc" : "res_multistep", scheduler: "simple", denoise: 1 });
    output = add("20", "VAEDecode", { samples: sampled, vae });
  }
  if (recipe.kind === "video") {
    const video = add("21", "CreateVideo", { images: output, fps: p.fps || 24 });
    add("99", "SaveVideo", { video, filename_prefix: "TyeStudio/video", format: { format: "mp4", codec: { codec: "h264" } } });
  } else add("99", "SaveImage", { images: output, filename_prefix: "TyeStudio/image" });
  return g;
}
