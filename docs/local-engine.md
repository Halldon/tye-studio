# Local Comfy engine

Tye Studio has completed real FLUX.2 Klein generation and reference editing against a separate local ComfyUI engine. This guide records the tested revisions and explains how to recreate the setup without changing an existing ComfyUI installation.

## What was verified

| Path | Result |
| --- | --- |
| Tye → raw ComfyUI on `8188` | FLUX.2 Klein 4B, 512×512, 4 steps, seed `424242`; completed in 31.834 seconds. App-stored PNG matched the native output bytes. |
| Tye → official SDK → official proxy on `8189` → ComfyUI | Reference upload, FLUX instruction edit, polling and output download completed. The 1024×1024 PNG was persisted with its source image as parent; app download matched native SHA-256 `55096d4d4c04351f2aaed8fdc5e7b479e647e75125f4e46d7d2c51953366efc6`. |
| Wan image-to-video | Verified SDK/proxy run: 256×256, 17 H.264 frames at 16 fps, 1.062012 seconds. The first export failed; corrected serialization reused its actual cached inference and produced a playable MP4. See [video evidence](video-execution-proof.json). |

The tested machine was a Mac with **36 GiB unified memory**, using PyTorch **MPS**. This is an observed configuration, not a minimum VRAM requirement, speed promise or platform support matrix. Reference editing can alter the broader scene; it does not preserve every unselected pixel by itself.

The inference environment used a separate checkout and new venv, with other common dependencies available from an existing environment as a read-only fallback. That existing environment was unchanged. A fully clean installation of every Python dependency was **not** the tested path. The fresh-venv instructions below avoid that fallback and have not been executed end to end as a separate Python-install test.

## Create a separate engine

Use a new directory and terminal. Do not activate or install into an existing ComfyUI environment, add its packages to `PYTHONPATH`, or use `--system-site-packages`.

```sh
mkdir tye-local-engine
cd tye-local-engine
git clone https://github.com/Comfy-Org/ComfyUI.git
cd ComfyUI
git checkout --detach 6b904b5fafd062effc1acbc46b1d3196922f7055
unset PYTHONPATH
export PYTHONNOUSERSITE=1
python3.12 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt \
  'torch==2.15.0' 'torchvision==0.29.2' 'numpy==2.2.6' 'av==19.0.2'
```

The pinned [official core revision](https://github.com/Comfy-Org/ComfyUI/commit/6b904b5fafd062effc1acbc46b1d3196922f7055) reports ComfyUI `0.43.0`. The tested Python was `3.12.11`; installed packages included [Torch `2.15.0`](https://pypi.org/project/torch/2.15.0/), [Torchvision `0.29.2`](https://pypi.org/project/torchvision/0.29.2/), NumPy `2.2.6`, PyAV `19.0.2`, `comfy-kitchen 0.2.40` and `comfy-aimdo 0.6.0`. The latter two are pinned by this core's requirements. Older Torch `2.5.1` failed a current custom-op schema during setup; the tested newer Torch resolved it. Other hardware requires the appropriate PyTorch build and separate validation.

## Install the exact FLUX files

Download these three revision-pinned files into the indicated paths under `ComfyUI/models/`. Together they are approximately 12.3 GB. The model cards declare Apache-2.0; review their linked licenses and provenance independently of the app's license. These are the files actually used, rather than substituting a similarly named VAE or encoder. See the [official Klein guide](https://docs.comfy.org/tutorials/flux/flux-2-klein).

| Target under `models/` | Revision-pinned download | License/source |
| --- | --- | --- |
| `diffusion_models/flux-2-klein-4b-fp8.safetensors` | [BFL FP8 diffusion model](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/resolve/5b4408e59397a4a37ccb46afe426d8ed86379441/flux-2-klein-4b-fp8.safetensors) | [BFL model card](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8) |
| `text_encoders/qwen_3_4b.safetensors` | [Comfy-Org text encoder](https://huggingface.co/Comfy-Org/flux2-klein-4B/resolve/5b3abca5c0dc1ecd4eaf3340868d09063fc1c965/split_files/text_encoders/qwen_3_4b.safetensors) | [Comfy-Org model card](https://huggingface.co/Comfy-Org/flux2-klein-4B) |
| `vae/flux2-vae.safetensors` | [BFL Klein VAE](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/resolve/e7b7dc27f91deacad38e78976d1f2b499d76a294/vae/diffusion_pytorch_model.safetensors), saved with the target name | [BFL Klein model card](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) |

Expected SHA-256 values, in the same order:

```text
97ed34fe0567e436200f2faee3939b88f2b5d99f8af2a4dc16532c4245c0ccb6
6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a
ca70d2202afe6415bdbcb8793ba8cd99fd159cfe6192381504d6c4d3036e0f04
```

On macOS, `shasum -a 256 models/diffusion_models/flux-2-klein-4b-fp8.safetensors` checks the first file; check the other two likewise. Model files are not bundled in Tye's source. Other recipes need their own files; consult [the workflow model table](../workflows/README.md#model-setup).

## Run raw core on 8188

From the fresh ComfyUI directory, create a minimal web root for API-only operation and keep this terminal running:

```sh
mkdir headless-web
printf '%s\n' '<!doctype html><title>Local ComfyUI API</title>' > headless-web/index.html
.venv/bin/python main.py --listen 127.0.0.1 --port 8188 \
  --disable-all-custom-nodes --offline --front-end-root headless-web
```

These match the tested backend flags: custom nodes and partner nodes are disabled. No custom node pack is needed for the tested Klein graphs. Read-only checks such as `curl --fail http://127.0.0.1:8188/system_stats` and `/object_info` establish process/device/node discovery, not successful inference.

## Optional official SDK proxy on 8189

Leave core running. In another terminal, from the same ComfyUI directory:

```sh
python3.12 -m venv .proxy-venv
.proxy-venv/bin/python -m pip install 'comfy-api-proxy==0.1.6'
.proxy-venv/bin/comfy-api-proxy --comfyui http://127.0.0.1:8188 \
  --host 127.0.0.1 --port 8189 --state-dir ./proxy-state
```

This is the official [API proxy](https://docs.comfy.org/development/comfyui-server/api-proxy), pinned to the tested [PyPI release `0.1.6`](https://pypi.org/project/comfy-api-proxy/0.1.6/). It exposes v2 for the official SDK; it does not run another model engine. Keep the proxy state directory for its job/asset index. `/api/v2/health` is a liveness probe; the app keeps recipe availability unverified when proxy discovery cannot establish exact installed models. No token is required for this loopback-only configuration.

## Connect Tye Studio

In the **app checkout**, set one line in its ignored `.dev.vars`, preserving all existing values and encryption keys:

```dotenv
COMFY_BASE_URL="http://127.0.0.1:8189"
```

Use `http://127.0.0.1:8188` instead for the raw adapter. Restart the app's development server after changing it. Follow [local app setup](hosting-runtime.md#local-setup), sign in locally, and choose FLUX.2 Klein 4B or Klein Edit. No hosted-provider key is needed for this local engine. The official SDK upload/submit/poll/download path is used with the proxy; raw mode uses core's native API.

All three services must be reachable from the app server. A deployed Worker cannot reach a laptop's loopback ports. Keep this setup local; a remote engine needs deliberate authenticated network configuration as described in the official proxy guide. App success, native history success and persisted output bytes are separate checks; the verified FLUX and Wan runs above passed all three. See [the verification record](verification.md) for current coverage.
