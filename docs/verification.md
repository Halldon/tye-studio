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

Server tests cover owner boundaries, SQLite migrations, encrypted credentials, request and redirect validation, ambiguous submission handling, output persistence, workflow/mask construction and byte-range playback. Editor tests cover document transforms, sequence timing, portability and workflow input resolution. All 72 current tests and TypeScript pass. Scoped lint passed for the delegated shell and Shots changes; the original editor release also passed repository lint. The production build and deployment are checked before delivery.

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

Screenshots and deterministic QA fixtures remain outside the published application. Generation success, new model compatibility and provider billing remain unverified because the account's API submission was denied.

## Challenge source and reproducibility — November 2, 2026

Eight standalone native API-format workflow JSON files cover all five supported recipes, including multi-reference/masked Qwen and text/image-to-video Wan variants. They are deterministic exports of the actual application builder, with SHA-256 manifests, source references and model/input setup instructions. Seven graph/export tests and four setup/migration tests bring the suite to 83 passing tests.

Two fresh sanitized source copies, with the private hosting project ID removed and isolated npm/XDG configuration, installed 708 packages, built and applied all three local migrations without a Sites registration, plugin cache, inherited credentials or existing database. The default `npm run setup:local` completed successfully. A repeated migration run verified all three source checksums without replaying SQL. The development server saved and reopened a project/document and retrieved the exact uploaded PNG bytes after restart. The built Worker page and bootstrap returned 200 with the explicitly enabled loopback fallback. A separate legacy-schema test refused to initialize an untracked database and preserved its existing sentinel row.

The public GitHub repository excludes credentials, local runtime/media outputs, private hosting identity and prior source history. Its Linux CI passed install, all 83 tests, TypeScript, deterministic workflow checks, production build and both fresh/repeated migrations. Local interactive checks used macOS, Node 25.3.0 and npm 10.8.2; Windows and the minimum Node version have not been executed. The original MIT license remains unchanged. Demo video and social post are excluded from this work; final competition submission and eligibility/feature attestations remain separate from source publication.
