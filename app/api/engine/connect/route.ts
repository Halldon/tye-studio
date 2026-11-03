import { env } from "cloudflare:workers";
import { assertMutationOrigin, requestContext } from "../../../lib/server/context";
import { credentialStorageReady, forgetCredential, saveCredential, validateApiKey } from "../../../lib/server/credentials";
import { ApiFailure, readJson, route } from "../../../lib/server/errors";
import { acknowledgeEngineCheck, discoverEngine } from "../../../lib/server/service";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return route(async () => {
  assertMutationOrigin(request); const { user, bindings } = await requestContext(request);
  const body = await readJson<{ apiKey: string }>(request); const apiKey = validateApiKey(body.apiKey);
  const connected = { ...bindings, COMFY_API_KEY: apiKey, connectionSaved: false };
  const { status: engine } = await discoverEngine(connected);
  if (!engine.connected) return Response.json({ engine, saved: false });
  await acknowledgeEngineCheck(connected, user.id, engine);
  const canSave = !!bindings.DB && credentialStorageReady(bindings.STUDIO_CREDENTIAL_KEY);
  if (canSave) { await saveCredential(bindings.DB!, user.id, apiKey, bindings.STUDIO_CREDENTIAL_KEY!); engine.connectionSaved = true; }
  else engine.message += " Secure saving is not configured; keep this connection in the current session only.";
  return Response.json({ engine, saved: canSave });
}); }
export async function DELETE(request: Request) { return route(async () => {
  assertMutationOrigin(request); const { user, bindings } = await requestContext(request);
  if (!bindings.DB) throw new ApiFailure(503, "storage_not_configured", "The connection store is unavailable.");
  await forgetCredential(bindings.DB, user.id);
  const { status: engine } = await discoverEngine({ ...env, ownerId: user.id, connectionSaved: false });
  return Response.json({ engine, saved: false });
}); }
