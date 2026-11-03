# Tye Studio

An open-source image and video workspace powered by ComfyUI. Create images and short videos, edit images with layers and masks, assemble sequences, and keep reusable workflows and media together.

Tye Studio uses the official `@comfyorg/sdk` Fetch transport on the server. The creator interface is independent of the ComfyUI frontend. No model weights, provider credentials, competitor screenshots or generated examples are bundled.

Source: [Halldon/tye-studio](https://github.com/Halldon/tye-studio). [GitHub CI](https://github.com/Halldon/tye-studio/actions/workflows/ci.yml) checks tests, TypeScript, workflow exports, production builds and repeatable local migrations.

Standalone ComfyUI API graphs, model requirements and engine setup are documented in [workflows/README.md](workflows/README.md). Run `npm run workflows:check` to verify the checked-in graphs match the app's builder.

## Features

- Projects with automatic saving, a private media library, favorites and portable project ZIP import/export.
- Native Comfy recipes for Z-Image Turbo, FLUX.2 Klein 4B generation/editing, Qwen Image Edit 2511 and Wan2.2 5B video. Each recipe declares capabilities and checks installed nodes and models.
- Real generation jobs with durable app IDs, per-user access, cancellation and status reconciliation. Ambiguous submissions are never silently retried.
- A prompt-based generation feed with real batch/run states and reusable settings. Paste, drop or upload reference images directly; changing models keeps references visible and explains incompatible inputs.
- A persistent result inspector with inline image editing, durable parent/child versions, editable saved snapshots and image comparison with linked zoom and pan.
- Image layers, editable text, transforms, crop, canvas expansion, mask painting, undo/redo and PNG export. Qwen can edit an image and composite masked output over the original; this is not advertised as mask-conditioned diffusion.
- Shots with saved prompts, compatible model settings, pinned scene references and alternative takes. Capture actual video frames as PNGs, edit them or use them as start images, then send a chosen take to Sequence.
- A sequence editor with image holds, trimmed video, reordering, splitting, captions, source audio and one additional audio track. A supported browser can render a playable WebM in real time. Browser capture is not a frame-exact offline renderer.
- A typed workflow canvas with assets, prompts and operation drafts, import/export, cycle checking and preserved Comfy originals. Imported Comfy topology stays locked; only supported scalar inputs can change. Selected generation/edit operations with direct prompt and asset inputs can submit real jobs through validated recipes. Imported Comfy graphs and unresolved upstream operations remain editable documents; the app does not claim full graph execution.
- Local, self-hosted v2 proxy, Comfy Cloud and configured remote engine adapters. A private hosted deployment uses ChatGPT access control.
- Cmd/Ctrl-K search across projects, assets, models and actions, plus recent and favorite models. Provider access checks distinguish authentication from successful generation.

## Run locally

Use Node.js 22.13 or newer and npm. A fresh checkout needs no Sites plugin, hosting registration, provider key or existing database to run the app locally. Model execution uses a separate ComfyUI instance or authorized hosted engine.

```sh
npm run setup:local
npm run dev -- --port 5173 --hostname 127.0.0.1
```

Setup installs the locked dependencies, builds the Worker and applies pending local D1 migrations. It preserves environment files and existing D1/R2 data. With dependencies already installed, use `npm run setup:local -- --skip-install`. After adding a migration, run `npm run build` followed by `npm run db:migrate:local`; the command verifies recorded migration checksums and never replays applied SQL. An older database initialized with manual SQL is left untouched and requires explicit migration; see [local D1 migrations](docs/hosting-runtime.md#local-d1-migrations).

Open [the local sign-in route](http://127.0.0.1:5173/signin-with-chatgpt?return_to=%2F). The portable development server supplies a local test identity on loopback; hosted builds do not include that sign-in simulation. You can import media, edit, assemble shots/sequences and save projects before connecting an engine in Settings.

The checked-in `.openai/hosting.json` declares `DB` and `BUCKET`, which are emulated locally. Keep both declarations; `project_id` is unnecessary for standalone local development. Persistent local data lives in ignored `.wrangler/state/`; deleting it deletes local projects and media. Setup never creates or changes a credential encryption key.

For local engine access set `COMFY_BASE_URL=http://127.0.0.1:8188` for raw core, or `http://127.0.0.1:8189` for the official v2 proxy in an ignored `.dev.vars` file. The app server must be able to reach the engine; a hosted Worker cannot reach your laptop's loopback address. See [runtime setup and troubleshooting](docs/hosting-runtime.md).

The production runtime targets Cloudflare Workers with D1/R2, using Miniflare for local development. A separate Node production server is not included.

## Runtime configuration

| Name | Purpose |
| --- | --- |
| COMFY_BASE_URL | Execution endpoint, default `https://cloud.comfy.org` |
| COMFY_API_KEY | Optional server-managed Comfy key; never exposed to the client |
| STUDIO_CREDENTIAL_KEY | A base64url-encoded random 32-byte AES key for encrypted per-user saved connections |
| TYE_LOCAL_PREVIEW | Optional explicit `true` single-user fallback, accepted only on a loopback URL |
| DB | D1 structured storage binding |
| BUCKET | R2 media binding |

When secure storage is configured, keys entered in Settings are encrypted with AES-GCM and bound to the authenticated user ID before storage. Otherwise, a connected key remains in browser memory for that session only. Credentials are excluded from project exports. Preserve the runtime encryption key across deployments; rotating it makes existing saved connections unreadable until users reconnect. Use the hosting platform's secret manager, not source files.

Comfy browser free runs and developer API credits may have different eligibility. Tye Studio displays real API errors and does not purchase credits, invent output or mark failed jobs as complete.

## Data and limits

Original media is preserved. Each output is copied into the application's media store; expiring upstream URLs are not permanent asset references. Projects retain editor state, saved versions, shots, takes and generation parameters. Portable ZIPs bundle project media and referenced media from other projects, including masks and version ancestors; importing remaps those references and never resubmits archived jobs. An exported PNG is a new version; working autosaves do not overwrite the accepted editable snapshot of an older version. Older projects without such snapshots reopen that version's actual source pixels.

Uploads are limited to 20 MB each; generation references and masks to 25 MB total; retrieved outputs to 40 MB each. Portable imports have bounded compressed and expanded sizes. Current list endpoints return at most 100 projects, 300 assets and 100 jobs; paging beyond these limits is a future extension.

Keep the preview/deployment private when using server-managed credentials. Hosted access and per-user authorization are required; the local test identity is restricted to loopback development. SVG uploads are rejected, and media types are determined from bytes. External engine URLs come from server configuration. Download redirects are allowlisted and do not receive engine credentials on another origin.

## Verification

Run `npx tsc --noEmit`, `node --experimental-strip-types --test tests/*.test.ts`, and `npm run build` on a supported Node version. The tests exercise owner isolation, real SQLite migrations, encrypted credential boundaries, safe requests, ambiguous submissions, output persistence, mask composition and editor project interoperability.

A successful build or mocked adapter test does not establish GPU compatibility. Validate exact workflow, model, encoder, VAE and custom-node revisions on your own engine. The UI reports missing dependencies rather than assuming every installed model supports every tool.

## License

Tye Studio's authored code is MIT. Dependencies and model weights retain their own licenses. ComfyUI core and frontend are GPL-3.0; the official SDK is MIT. No ComfyUI frontend implementation code is copied into this repository. See [third-party notices](THIRD_PARTY_NOTICES.md).
