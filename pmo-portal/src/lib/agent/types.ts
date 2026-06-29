/**
 * Request/response/error contract types for the compose-view edge function.
 * Shared by the handler (server) and the useAIComposer hook (client).
 * Pure types only — no runtime imports except the viewspec CompositionSpec.
 *
 * ADR-0039, FR-AS-011, FR-AS-012, FR-AS-013.
 * Reconciliation #1: validationError is SINGULAR (the compiler is fail-fast and throws one error).
 */
import type { CompositionSpec } from '../viewspec/types';

// ── Request ────────────────────────────────────────────────────────────────────

export interface ComposeViewRequest {
  /** User's natural-language description; max 2000 chars (FR-AS-011). */
  prompt: string;
  /** UUID — must match the org_id derived from the caller's JWT profiles row (FR-AS-012). */
  orgId: string;
  contextHints?: {
    /** For $current_user token resolution hints. */
    currentUserId?: string;
    /** ISO-8601 date string, for date token hints. */
    currentDate?: string;
  };
}

// ── Response ───────────────────────────────────────────────────────────────────

export interface ComposeViewResponse {
  /** Validated CompositionSpec v1 (FR-AS-013). */
  spec: CompositionSpec;
  /** 0 if first attempt succeeded; ≥1 if repair rounds were needed (FR-AS-007). */
  repairAttempts: number;
  /** Total input+output tokens consumed (informational). */
  tokensUsed?: number;
}

// ── Error (discriminated union by status) ──────────────────────────────────────

/**
 * Structured error body returned by the edge function on non-200 responses.
 * Reconciliation #1: validationError is singular — the compiler is fail-fast (throws one error).
 */
export interface ComposeViewError {
  status: 400 | 401 | 422 | 429 | 502;
  error: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'REPAIR_EXHAUSTED' | 'RATE_LIMITED' | 'UPSTREAM_ERROR';
  detail?: string;
  /**
   * Present on 422 REPAIR_EXHAUSTED: the last ValidationError thrown by compileCompositionSpec.
   * Singular — Reconciliation #1 (fail-fast compiler, single error per round).
   */
  validationError?: {
    code: string;
    detail?: string;
  };
  /** Present on 429 RATE_LIMITED: seconds until the rate limit resets. */
  retryAfterSeconds?: number;
  /** Repair attempts made before exhaustion (present on 422). */
  repairAttempts?: number;
}
