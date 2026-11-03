import type { ApiError } from "./contracts";

export type EligibilityBlock = "authentication" | "api-access" | "credits";
/** Nonreversible request attribution only. The actual credential is never persisted here. */
export async function credentialFingerprint(apiKey: string | null | undefined): Promise<string> {
  if (!apiKey) return "keyless";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("tye-studio-credential-v1:" + apiKey.trim()));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A generic 403 can be a prompt/model policy failure. It is not proof of a plan/credit block. */
export function eligibilityBlock(status: number, code: string, message: string): EligibilityBlock | null {
  const normalized = code.toLowerCase().replace(/[-\s]/g, "_");
  if (status === 401) return "authentication";
  if (["insufficient_credits", "insufficient_balance", "credits_exhausted", "out_of_credits"].includes(normalized)) return "credits";
  if (status === 402) return "credits";
  if (status === 403 && ["content_policy_violation", "content_policy", "safety_filter", "model_not_found", "model_not_supported", "model_not_allowed", "unsupported_model", "invalid_input", "invalid_workflow", "workflow_validation_failed", "prompt_rejected", "policy_violation"].includes(normalized)) return null;
  if (["api_access_denied", "api_not_enabled", "api_access_not_allowed", "subscription_required", "paid_plan_required", "api_access_requires_subscription"].includes(normalized)) return "api-access";
  if (status !== 403) return null;
  if (/\bapi\s+access\b.{0,90}\b(denied|disabled|not\s+(enabled|permitted|allowed)|requires?\s+(a\s+)?(paid|subscription))\b/i.test(message) || /\b(requires?|need)\s+(an?\s+)?(active\s+)?(paid\s+)?subscription\b/i.test(message)) return "api-access";
  if (/\b(insufficient|not enough|exhausted)\s+(api\s+)?(credits?|balance)\b/i.test(message)) return "credits";
  return null;
}

export function recordedEligibilityBlock(error: ApiError | null): EligibilityBlock | null {
  const provider = error?.details && typeof error.details === "object" ? (error.details as { provider?: { eligibilityReason?: unknown } }).provider : undefined;
  return provider && ["authentication", "api-access", "credits"].includes(String(provider.eligibilityReason)) ? provider.eligibilityReason as EligibilityBlock : null;
}
