declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    COMFY_API_KEY?: string;
    COMFY_BASE_URL?: string;
    /** Only enables a single-user identity on a loopback preview URL. Never enables hosted anonymous access. */
    TYE_LOCAL_PREVIEW?: string;
    /** Base64url-encoded 32-byte AES key. Runtime secret only. */
    STUDIO_CREDENTIAL_KEY?: string;
  }
}
