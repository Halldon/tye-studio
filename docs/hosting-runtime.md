# Tye Studio runtime

Tye Studio runs a React/Vinext interface and a Cloudflare Worker API, with D1 for projects/jobs and R2 for media. Miniflare emulates those services locally. The source includes the development integrations it imports; a local checkout does not require a Sites plugin installation or a registered hosting project.

## Local setup

Use Node.js 22.13 or newer with npm. From the repository root:

```sh
npm run setup:local
npm run dev -- --port 5173 --hostname 127.0.0.1
```

The first command runs the locked dependency install, builds and migrates only the local database. It requires network access for npm packages, but no Cloudflare login, provider credentials or model downloads. Use `npm run setup:local -- --skip-install` when `node_modules` is already installed. The script does not create, replace or source environment files itself, generate encryption keys, reset a database or upload anything.

Open `http://127.0.0.1:5173/signin-with-chatgpt?return_to=%2F`. The portable development server simulates sign-in as a local test user on loopback only. The development cookie survives restarts; use `/signout-with-chatgpt?return_to=%2F` to clear it. This simulation is excluded from hosted builds. Keep local preview servers on loopback.

`.openai/hosting.json` must retain `"d1": "DB"` and `"r2": "BUCKET"`. The `project_id` field is optional for local use and belongs only to the hosted publishing integration. An absent ignored `.sites-runtime/execution-profile.json` selects the portable profile automatically. Do not copy a managed runtime profile into a standalone checkout.

No Comfy connection is required for project creation, media import, native image editing, shots, sequences or portable project export. Generation, AI editing and model discovery require an engine configured below. Setup never runs a generation job.

## Local D1 migrations

```sh
npm run build
npm run db:migrate:local
```

Build generates the D1 binding configuration. The migration script reads the SQLite Drizzle journal in `drizzle/meta/_journal.json`, validates that every SQL file is journaled, and checks the existing local migration history. It applies pending files in journal order through Wrangler's local D1 migration runner. Each applied migration records its filename and a SHA-256 source checksum in the same migration transaction. Running the command again verifies that history and leaves applied SQL alone.

The script always passes `--local` and uses `.wrangler/state`, matching development and built preview. It accepts no extra arguments and cannot target a remote database. The generated migration files, config and lock are under ignored `.sites-runtime/`. The journal and original SQL remain unchanged. A failed migration leaves earlier successful migrations recorded; fix the cause and rerun. If a killed process leaves `.sites-runtime/local-migrations.lock`, confirm no migration is running before removing that lock directory.

An older database initialized by manually executing SQL has no verified migration ledger. Setup refuses that schema instead of replaying `CREATE`/`ALTER`, adopting it automatically or resetting it. Keep a backup and arrange an explicit migration for that database; alternatively use a separate fresh checkout for evaluation. Never delete the existing `.wrangler/state` to troubleshoot without first preserving the data you need. The setup script is intended for new local databases and subsequent tracked migrations, not automatic conversion of legacy databases.

For schema work, update `db/schema.ts`, run `npm run db:generate`, review and commit the complete generated SQL/journal/snapshot changes, then rebuild and migrate. Do not edit a migration that has already been applied. Production migrations require a separate authorized deployment procedure; this local command does not apply them.

## Engine and credential configuration

Set runtime values in an ignored `.dev.vars` file for local development, or in the hosting platform's bindings/secret manager for deployment. No environment file is needed for offline app features. Do not replace an existing file or encryption key during setup.

| Name | Purpose |
| --- | --- |
| `COMFY_BASE_URL` | Execution endpoint; defaults to `https://cloud.comfy.org` |
| `COMFY_API_KEY` | Optional server-managed Comfy key |
| `STUDIO_CREDENTIAL_KEY` | Optional base64url-encoded random 32-byte AES key for per-user encrypted saved connections |
| `TYE_LOCAL_PREVIEW` | Explicit `true` enables a single-user fallback on a loopback URL only |
| `DB` / `BUCKET` | Required D1/R2 bindings, declared in the hosting manifest |

For raw local ComfyUI use `COMFY_BASE_URL="http://127.0.0.1:8188"`; for the official v2 proxy use `http://127.0.0.1:8189`. Install the exact nodes, model/encoder/VAE files and revisions required by your recipes on that separate engine. A hosted Worker needs a reachable authenticated engine; your laptop's loopback address is not reachable from it. Private network URLs are server configuration, never arbitrary client-supplied fetch targets.

With a server credential key configured, Settings encrypts each user's connection with AES-GCM before storing it. Keep that encryption key stable across deployments and backups. Changing or losing it prevents decryption of saved connections; affected users must reconnect. Without it, a key entered in Settings stays in browser memory for the session. Server-managed credentials are separate from those per-user connections. Project exports exclude all credentials.

Connection verification checks authentication and capabilities; API plan/credit eligibility is established by actual provider responses. Browser free runs do not establish developer API eligibility. No local setup step buys credits or proves GPU execution.

## Built Worker preview

`npm run build` produces `dist/server/wrangler.json`. `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, using the same `.wrangler/state` as development. It does not publish or simulate the development sign-in route. For an explicit single-user built preview on loopback, run:

```sh
npm start -- --port 8787 --var TYE_LOCAL_PREVIEW:true
```

The explicit fallback uses a different local user ID from the development sign-in simulation, so each identity sees its own projects even in the same database. That fallback is intentionally restricted to loopback. It is not a production identity system. A production deployment must use trusted authenticated identity and private access when server-managed credentials are enabled. The shipped production target is Workers/D1/R2; a standalone Node production server and a generic self-hosted authentication provider are not included.

## Data and tool state

`.wrangler/state/` contains persistent local D1 and R2 data. Back up that directory while local servers are stopped, together with any credential key needed to decrypt connections. Never commit it. `.sites-runtime/` stores disposable tool configuration, logs, registry/session data and migration scratch files. `.vinext/`, `dist/`, `.next/` and TypeScript build state are generated. The scripts preserve the caller's home directory, npm cache/proxy settings and environment; explicit tool paths remain checkout-local by default.

Local preview metadata fetches and Wrangler tool metrics are disabled by default. `CLOUDFLARE_CF_FETCH_ENABLED=true` or `WRANGLER_SEND_METRICS=true` explicitly opts into those tool features. The local app itself needs no connector session. Hosted access policies, production bindings and migrations are operational configuration, not recreated by local setup.

## Verification and troubleshooting

- `npm run install:ci`: install the locked dependencies, including dev and optional packages.
- `npm run setup:local`: install, build and migrate a local checkout.
- `npm run db:migrate:local`: verify and apply pending local migrations after a build.
- `npm run dev -- --port 5173 --hostname 127.0.0.1`: start the local development server.
- `npx tsc --noEmit`: check TypeScript.
- `node --experimental-strip-types --test tests/*.test.ts`: run the source tests on a supported Node release with type stripping.
- `npm run build`: build the production artifact without publishing.

If npm or the framework rejects your Node version, select a supported Node installation before installing. If the npm cache is unwritable, choose a writable path through `npm_config_cache`; do not change your home directory. If a port is busy, select another loopback port and update the sign-in URL. Stop another preview before running migrations against its database. An `untracked schema` error is a preservation guard, not permission to reset data. A `401` from the development API usually means the local sign-in cookie is missing. A missing storage error means `DB`/`BUCKET` declarations or migration/build configuration need attention. A provider `403`, missing models or a GPU failure must be resolved on the configured engine; rebuilding the UI does not grant API eligibility.

Fresh-checkout verification should use an empty local state, the checked-in lockfile and the binding-only hosting manifest. A successful build, local storage round trip or mocked provider test does not establish real GPU compatibility. See the repository tests and workflow documentation for validated recipe boundaries.
