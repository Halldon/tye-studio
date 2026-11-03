import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ApiFailure } from "./errors";
import { localPreviewAllowed } from "./security";
import { credentialStorageReady, decryptCredential, savedCredential, validateApiKey } from "./credentials";
import type { StudioUser } from "./contracts";

export type Runtime = Cloudflare.Env & { ownerId?: string; connectionSaved?: boolean; credentialError?: string };
export async function requestContext(request: Request): Promise<{ user: StudioUser; bindings: Runtime }> {
  const identity = await getChatGPTUser();
  const user: StudioUser | null = identity ? { id: identity.userId, name: identity.displayName, email: identity.email, localPreview: false } : localPreviewAllowed(env.TYE_LOCAL_PREVIEW, request.url) ? { id: "local-preview-owner", name: "Local creator", email: "local@preview", localPreview: true } : null;
  if (!user) throw new ApiFailure(401, "sign_in_required", "Sign in with ChatGPT to access your studio.");
  const sessionKey = request.headers.get("X-Comfy-Api-Key")?.trim();
  const bindings: Runtime = { ...env, ownerId: user.id, ...(sessionKey ? { COMFY_API_KEY: validateApiKey(sessionKey) } : {}) };
  if (env.DB && credentialStorageReady(env.STUDIO_CREDENTIAL_KEY)) {
    try {
      const record = await savedCredential(env.DB, user.id); bindings.connectionSaved = !!record && !sessionKey && !env.COMFY_API_KEY;
      if (record && !sessionKey && !env.COMFY_API_KEY) bindings.COMFY_API_KEY = await decryptCredential(record, user.id, env.STUDIO_CREDENTIAL_KEY!);
    } catch (error) { bindings.credentialError = error instanceof ApiFailure ? error.message : "Secure saved connections need the latest database migration."; }
  }
  return { user, bindings };
}
export function requireStorage(bindings: Runtime): { db: D1Database; bucket: R2Bucket } {
  if (!bindings.DB || !bindings.BUCKET) throw new ApiFailure(503, "storage_not_configured", "Configure the DB and BUCKET storage bindings before using the studio library.");
  return { db: bindings.DB, bucket: bindings.BUCKET };
}
export function assertMutationOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ApiFailure(403, "origin_not_allowed", "This request must come from your studio.");
}
