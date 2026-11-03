# Verification record — 2026-11-02

## Browser checks

Checked the actual app in the internal browser, including 1280×800 desktop and 390×844 mobile layouts. Reference research lives separately in `../research/2026-11-02/` and is excluded from application publication.

- Uploaded an authored 720×540 PNG fixture and a real 2-second H.264/AAC MP4 fixture into local D1/R2 storage.
- Added text and a painted mask, used undo, exported a real PNG, and reloaded saved image layers and dimensions.
- Trimmed the MP4 to 1.5 seconds, added a caption, played the sequence and rendered actual VP9/Opus WebM. Browser rendering uses wall-clock recording and is not frame-exact. The finalizer writes and verifies real WebM duration metadata without re-encoding the media. A fresh browser export was downloaded and ffprobe confirmed VP9 video, Opus audio and a finite 1.5-second container duration without container warnings. The exported video was also added back into a sequence. A completed PNG/WebM is downloaded if library storage fails; that fallback reports the failed save explicitly.
- Exported a portable project ZIP; SHA-256 comparisons confirmed both original fixture files were unchanged. Imported the ZIP and restored the sequence, caption and image document with remapped media IDs. Archived jobs were not resubmitted.
- Created workflow prompt/operation nodes, connected compatible ports, inspected input validation and downloaded the actual graph JSON.
- Checked mobile navigation and populated creation workspace; no horizontal overflow was observed.

Fixtures are deterministic software test media, not AI-generated demonstrations. They are kept in ignored local outputs and are not bundled into the app.

## Real Comfy account check

Created the user-approved Tye Studio API credential. The official SDK authenticated and discovered model/node availability. One real Z-Image Turbo workflow submission returned an API access denied 403. The developer workspace showed zero API credits while the browser product showed five free runs. No credits were purchased and no further generation was retried.

This establishes authentication and a real failure path. It does not establish successful image inference, video inference, GPU/model compatibility or generation quality. Use an API-enabled Comfy account or a reachable self-hosted engine to complete that validation.

## Automated coverage

Server tests cover owner boundaries, SQLite migrations, encrypted credentials, request and redirect validation, ambiguous submission handling, output persistence, workflow/mask construction and byte-range playback. Editor tests cover document transforms, sequence timing, portability and workflow input resolution. All 85 current tests and TypeScript pass. Scoped lint passed for the delegated shell and Shots changes; the original editor release also passed repository lint. The production build and deployment are checked before delivery.

Hosted authentication, deployed storage and saved encrypted connection checks are reported separately from local emulator verification in the delivery message.

## Visual refresh — November 2, 2026

Three original illustrations were generated with the built-in image generator using the supplied Sam Stoof reference for print texture and palette. Full-resolution PNG originals are retained in ignored local outputs; the application serves three 768×512 WebP files totaling 346,696 bytes. The prompt set is recorded in `generated-artwork.json`.

The shell now follows Linear’s published hierarchy and restraint principles: direct task names, quieter navigation, consistent compact headers, fewer separators, and no decorative eyebrow or repeated motivational copy. Relevant input requirements, errors, credential storage details and execution limits remain visible. The actual local creator was inspected at 1280×720 and 390×844; generated assets loaded correctly and cards cleared the composer. Image, sequence and workflow editor layouts were inspected after the cleanup. The workflow editor had no horizontal overflow at 390px. Both stylesheet files parse, and TypeScript passes.

## Task-specific card artwork — November 2, 2026

Revision 2 changes only the three starter-card asset references and artwork provenance. Image creation now shows a framed landscape; video creation shows sequential bird poses in a filmstrip; editing shows a brush and crop corners over a picture. The original abstract illustrations remain preserved. The new 768×512 WebP files total 248,160 bytes; full-resolution generated PNGs remain in ignored local outputs. Prompts are recorded in `generated-artwork-v2.json`. TypeScript passes; phone-sized previews retain recognizable task subjects.

## Creator flows — November 2, 2026

Checked these flows in the actual local app with D1/R2 storage, at 1280×800 and 390×844:

- Imported reference images attach immediately; pasting a real PNG into the composer saves and attaches `clipboard.png`. Incompatible models keep the images visible and offer a compatible model picker. Model favorites survive reload.
- The generation feed displays the existing real Comfy 403 failure, its original prompt and model settings. Reuse restores the request without submitting it. No further provider run was made.
- PNG exports create child versions. Saved editable snapshots stay independent of working autosaves: changing a child draft, branching from the original and reopening the child restores the accepted text layer. Reload preserves the project state. Both comparison panes reported the same `translate(-5%, 0%) scale(1.25)` after keyboard pan and zoom.
- Shots preserve titles, prompts, selected library takes, pinned scene references and per-shot references after reload. A real 2-second MP4 produced actual 480×270 PNG frames at 0 ms and 1001 ms; captures retain their source clip as parent. The selected video take arrived in Sequence with its actual 2-second duration.
- Cmd-K opens the command palette with its search field focused; Enter navigates to the matching action. Search covers projects, models and actual media. Phone composer, inspector and Shots layouts have no horizontal document overflow. The shot inspector's Generate controls use normal flow so they do not cover the prompt field.
- Exported the seven-file project, imported it into a new project and exported again. SHA-256 comparisons confirm all seven media files are unchanged, every asset received a fresh ID, and parent links were remapped correctly. The restored three-version family includes the accepted editable text layer; Shots and the two-second Sequence clip also reopen correctly. Invalid/oversized archives fail preflight, and an unexpected later storage failure identifies its partial project instead of claiming a complete restore.

Screenshots and deterministic QA fixtures remain outside the published application. At this UI-check checkpoint, successful inference was still unverified after the Cloud API denial; the subsequent local execution proofs below establish successful native and SDK runs. Cloud billing/plan eligibility remains unverified.

## Challenge source and reproducibility — November 2, 2026

Eight standalone native API-format workflow JSON files cover all five supported recipes, including multi-reference/masked Qwen and text/image-to-video Wan variants. They are deterministic exports of the actual application builder, with SHA-256 manifests, source references and model/input setup instructions. Seven graph/export tests and four setup/migration tests bring the suite to 83 passing tests.

Two fresh sanitized source copies, with the private hosting project ID removed and isolated npm/XDG configuration, installed 708 packages, built and applied all three local migrations without a Sites registration, plugin cache, inherited credentials or existing database. The default `npm run setup:local` completed successfully. A repeated migration run verified all three source checksums without replaying SQL. The development server saved and reopened a project/document and retrieved the exact uploaded PNG bytes after restart. The built Worker page and bootstrap returned 200 with the explicitly enabled loopback fallback. A separate legacy-schema test refused to initialize an untracked database and preserved its existing sentinel row.

The public GitHub repository excludes credentials, local runtime/media outputs, private hosting identity and prior source history. Its Linux CI passed install, all 83 tests, TypeScript, deterministic workflow checks, production build and both fresh/repeated migrations. Local interactive checks used macOS, Node 25.3.0 and npm 10.8.2. Linux CI also passed on both Node 22.13.0 and Node 25; Windows has not been executed. The original MIT license remains unchanged. Demo video and social post are excluded from this work; final competition submission and eligibility/feature attestations remain separate from source publication.

## Real local model execution — November 2, 2026

The earlier Cloud 403 remains an account/API-eligibility result. An isolated local engine now establishes successful native model execution without purchasing credits or changing the existing Comfy installation. Pinned ComfyUI 0.43.0 at `6b904b5fafd062effc1acbc46b1d3196922f7055`, Torch 2.15.0 and genuine checksum-verified FLUX.2 Klein 4B/encoder/VAE weights ran on this 36 GiB Mac's MPS device. Text encoding used CPU. [Local engine setup](local-engine.md) records the exact dependencies and the read-only fallback used for some Python packages; this is not a claim of an independently clean Python dependency installation.

- The Tye Studio UI submitted one 512×512, four-step FLUX text-to-image request, seed 424242. Native generation finished in 31.834 seconds. The app reconciled it to `succeeded`, copied 278,550 actual PNG bytes into its media store and served a download with the identical SHA-256 `2388e171fdb59484af9bd561a2532a1e3b21c85af21b5b42338faf95ba0a2214`. The saved project, asset and completed job survived an app restart.
- A second request used the actual official SDK through comfy-api-proxy 0.1.6 on loopback 8189 and the same native engine. It uploaded the saved source image, changed the blue teapot to green via FLUX Klein Edit and returned a 1024×1024 PNG after 103.229 seconds. The app persisted 1,122,499 bytes with SHA-256 `55096d4d4c04351f2aaed8fdc5e7b479e647e75125f4e46d7d2c51953366efc6`, matching the native output. The source upload matched the original bytes, and the resulting asset's parent points to the original version. Comparison opens both actual images. The edit broadly preserves the scene; unmasked instruction editing does not promise pixel-identical unchanged regions.

These proofs cover actual raw-local generation and SDK/proxy upload, submit, polling, output retrieval and application persistence. They do not establish Cloud API eligibility, every supported model, generation quality across prompts or a minimum hardware requirement. Generated proof images remain separate release/verification assets rather than prepopulated application results.

## Completed video export and source timing — November 2, 2026

The first Wan image-to-video request loaded the real weights and completed four sampling steps, then failed in SaveVideo. The old app graph sent a nested execution argument as a DynamicCombo API input. The corrected builder sends flat selectors `format: "mp4"` and `"format.codec": "h264"`; actual pinned core input reconstruction and execution-signature binding confirm the fix, and a regression test rejects the old shape. All eight exports and their manifest were regenerated from the builder.

A deliberate retry reused the actual inference cached from that failed run and encoded a playable H.264/yuv420p MP4: 256×256, 17 decoded frames at 16 fps, 1.062012 seconds, no audio, 143,290 bytes. Native, proxy and app downloads match SHA-256 `5b911e8cb1aaf9200b9aad40edd6fd99889d26cf420d96b93e4835cad75831a4`. The app stores it as video/mp4 despite the proxy's generic image label and preserves its parent link to the edited green image. Browser video metadata reported readyState 4 and the same measured duration.

Generated video duration now stays null when no measurement is available; the requested duration remains in immutable job parameters. Copying the one-second request into source metadata would prematurely trim the 17-frame clip. A further deliberate cached export verified the null metadata, and Sequence probed the actual file and set its out point to 1.062012 seconds. The earlier failed run remains in history with no output. These two regressions bring the current suite to 85 passing tests. [Video execution evidence](video-execution-proof.json) records the measured bytes, native inference/cache history, model provenance and application checks.
