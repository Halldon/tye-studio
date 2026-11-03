# Native ComfyUI workflows

These eight standalone JSON files are **API-format node dictionaries**, generated from the same [`buildWorkflow`](../app/lib/server/recipes.ts) function used by Tye Studio. They contain native ComfyUI nodes, fixed example prompts and seed `424242`. No model weights or example media are included. [Comfy's format reference](https://docs.comfy.org/development/api-development/workflow-api-format) distinguishes this format from frontend save-format JSON with canvas layout.

## Choose a workflow

| File | Recipe / operation | Required input files |
| --- | --- | --- |
| [z-image-turbo.api.json](z-image-turbo.api.json) | Z-Image Turbo; text to image, 1024×1024, 8 steps | None |
| [flux-klein-4b.api.json](flux-klein-4b.api.json) | FLUX.2 Klein 4B; text to image, 1024×1024, 4 steps | None |
| [flux-klein-edit.api.json](flux-klein-edit.api.json) | FLUX.2 Klein; single image instruction edit, 4 steps | `tye-reference-1.png` |
| [qwen-image-edit.api.json](qwen-image-edit.api.json) | Qwen Image Edit 2511; single image instruction edit, 40 steps | `tye-reference-1.png` |
| [qwen-image-edit-multi-reference.api.json](qwen-image-edit-multi-reference.api.json) | Qwen; three image references, 40 steps | `tye-reference-1.png`, `tye-reference-2.png`, `tye-reference-3.png` |
| [qwen-image-edit-masked.api.json](qwen-image-edit-masked.api.json) | Qwen; instruction edit followed by masked compositing, 40 steps | `tye-reference-1.png`, `tye-mask.png` |
| [wan-2.2-5b-text-to-video.api.json](wan-2.2-5b-text-to-video.api.json) | Wan2.2 TI2V 5B; text to video, 832×480, 20 steps | None |
| [wan-2.2-5b-image-to-video.api.json](wan-2.2-5b-image-to-video.api.json) | Wan2.2 TI2V 5B; image to video, 832×480, 20 steps | `tye-reference-1.png` |

Wan's example uses 49 frames at 24 fps, approximately 2.04 seconds. The app rounds its duration request to the node's `4n+1` frame sequence. Native video saving is `VAEDecode → CreateVideo → SaveVideo`; the current SaveVideo selector is `{"format":"mp4","codec":{"codec":"h264"}}`. The engine needs working video encoding support. See the official [Wan latent node](https://docs.comfy.org/built-in-nodes/Wan22ImageToVideoLatent), [CreateVideo](https://docs.comfy.org/built-in-nodes/CreateVideo) and [SaveVideo](https://docs.comfy.org/built-in-nodes/SaveVideo) references.

## Model setup

Use a current ComfyUI installation with the native nodes listed in each JSON. No custom node pack is required by these graphs. Exact installed model filenames must match the loader inputs; restart or refresh the model list after installing files. The official guides below provide model download links and folder layouts.

| Recipe | `models/diffusion_models/` | `models/text_encoders/` | `models/vae/` | Official setup guide |
| --- | --- | --- | --- | --- |
| Z-Image Turbo | `z_image_turbo_bf16.safetensors` | `qwen_3_4b.safetensors` | `ae.safetensors` | [Z-Image Turbo](https://docs.comfy.org/tutorials/image/z-image/z-image-turbo) |
| FLUX.2 Klein generation/edit | `flux-2-klein-4b-fp8.safetensors` | `qwen_3_4b.safetensors` | `flux2-vae.safetensors` | [FLUX.2 Klein](https://docs.comfy.org/tutorials/flux/flux-2-klein) |
| Qwen Image Edit 2511 | `qwen_image_edit_2511_fp8mixed.safetensors` | `qwen_2.5_vl_7b_fp8_scaled.safetensors` | `qwen_image_vae.safetensors` | [Qwen Image Edit 2511](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511) |
| Wan2.2 TI2V 5B | `wan2.2_ti2v_5B_fp16.safetensors` | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `wan2.2_vae.safetensors` | [Wan2.2](https://docs.comfy.org/tutorials/video/wan/wan2_2) |

The exports use the builder's first model choice. Tye also recognizes Klein's `flux-2-klein-4b.safetensors` and Qwen's `qwen_image_edit_2511_bf16.safetensors`. The Qwen guide illustrates BF16; the default export uses Comfy-Org's [FP8 mixed repack](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/tree/main/split_files/diffusion_models). To run a standalone graph with the alternative, change node `1.inputs.unet_name` to that exact installed filename. The optional four-step Lightning LoRA in the Qwen guide is **not** used by Tye's 40-step recipe.

## Inputs and output behavior

1. Supply your own reference images in ComfyUI's `input/` directory using the listed filenames, or upload them through the engine's image upload API and replace each `LoadImage.inputs.image` value with the returned filename/subfolder. Filenames here are placeholders, not Tye asset IDs or remote URLs.
2. For the masked variant, use a PNG mask with the same dimensions as reference 1: selected pixels transparent, preserved pixels opaque. `LoadImage` output `1` supplies the inverse-alpha mask. Qwen first performs an instruction edit; `ImageCompositeMasked` then resizes that result to the original image and blends it over reference 1 only inside the mask. This is post-generation compositing, **not mask-conditioned inpainting**. Partial alpha produces a blend. See [LoadImage](https://docs.comfy.org/built-in-nodes/LoadImage) and [ImageCompositeMasked](https://docs.comfy.org/built-in-nodes/ImageCompositeMasked).
3. Klein edit derives latent dimensions from the reference scaled to one megapixel. Qwen encodes its internally scaled first reference; text-to-image width/height controls do not determine these edit dimensions. Only Qwen's masked composite explicitly restores the original canvas dimensions.
4. Output node `99` saves images under `TyeStudio/image` or videos under `TyeStudio/video` in ComfyUI's output directory. Model/encoder/VAE nodes are shared within each graph. These are one-output, batch-size-one recipes.

ComfyUI's frontend can open API-format JSON but has no authored node layout to restore. For a raw local API submission, wrap the graph as `{"prompt": <graph>}` for `POST /prompt`. Comfy's v2 job API instead takes `{"workflow": <graph>}` and has separate upload/authentication handling; a local filename graph is not a ready-made Cloud asset upload. Tye Studio's server adapter handles this translation. See the [raw server routes](https://docs.comfy.org/development/comfyui-server/comms_routes), [v2 submission contract](https://docs.comfy.org/api-reference/v2/jobs/submit-a-workflow-for-execution) and [official SDK guide](https://docs.comfy.org/development/api-development/sdks).

## Regenerate and verify offline

After installing repository dependencies, run on the Node version required by the project:

```sh
node scripts/export-workflows.mjs
node scripts/export-workflows.mjs --check
node --experimental-strip-types --test tests/workflow-export.test.ts
```

`--out DIRECTORY` writes or checks a separate directory. The exporter imports the actual TypeScript builder using the installed TypeScript transpiler, validates each scenario with the app's request validator, and serializes stable JSON. It never reads credentials, contacts an engine, downloads weights or submits a generation job. Change graph logic in `app/lib/server/recipes.ts`, then regenerate; editing generated JSON alone makes the check fail.

[`manifest.json`](manifest.json) records each scenario, exact selected/alternative model filenames, required inputs, node count, output node and SHA-256 of the JSON bytes, plus the builder's source hash. Tests check deterministic exports, full recipe coverage, lossless JSON round trips, loader/model agreement, reference/mask/video wiring, and rejection of broken links, cycles and stale exports.

These checks verify **offline graph structure and consistency**, not every installed engine's node schema, GPU memory fit or completed model inference. No GPU run was made for this export. A fixed seed alone does not guarantee bit-identical results across model variants, hardware or engine revisions. Current node/setup references were checked on 2026-11-02; the source inventory is in [`sources.json`](sources.json). Confirm exact dependencies on the engine you intend to run.
