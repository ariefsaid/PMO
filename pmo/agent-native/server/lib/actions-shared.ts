/**
 * Shared action helpers — the uniform error envelope + the duplicated DB/auth
 * helpers for every PMO agent-native action (read AND write).
 *
 * WHY THIS EXISTS (M-3): `SupabaseError`, `authRequired()`, and `dbError()` were
 * copy-pasted across server/actions/*, and pmo-query.ts inlined a slightly
 * different error shape. Centralizing them guarantees every PMO action surfaces
 * failures in the SAME envelope (so callers — and the Step-5 deputy-invariant
 * gates — can rely on `error.code` / `error.message`) and keeps the
 * deputy-enforcement points (no caller JWT → refuse; DB error → verbatim)
 * identical. Behavior is unchanged; the existing AC-403/404/405/606 gates stay
 * green.
 *
 * The canonical CRM-activity vocabulary (M-4) is also defined here so the two
 * write paths (pmo_query.create_activity and create_activity) cannot drift on
 * the `crm_activity_kind` enum.
 */

/** Fields we read off a Supabase/Postgres error (a structural subset of PostgrestError). */
export type SupabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

/** The uniform error envelope returned by every PMO action on failure. */
export type ActionError = {
  error: {
    code?: string;
    message: string;
    details?: string;
    hint?: string;
  };
};

/**
 * No authenticated caller on the deputy chain — the host AsyncLocalStorage has
 * no caller JWT (no/invalid `Authorization: Bearer`). Step-3 actions MUST treat
 * this as "refuse the data call" so a caller client is never built without
 * identity (which would silently bypass RLS).
 */
export function authRequired(): ActionError {
  return {
    error: {
      code: "NO_CALLER_IDENTITY",
      message: "No authenticated caller on this request (missing caller JWT).",
    },
  };
}

/**
 * Validation / allow-list rejection, raised BEFORE any business read or write
 * (unknown entity, disallowed column, bad filter). Carries no DB details — it
 * fails before the driver is ever consulted.
 */
export function badRequest(message: string): ActionError {
  return {
    error: {
      code: "BAD_REQUEST",
      message,
    },
  };
}

/**
 * Surface a Supabase/Postgres error verbatim. `fallback` is used ONLY when the
 * driver returned no message (defensive — real errors always carry one), so the
 * envelope is uniform across actions. RLS denials (`42501`) and PK/FK
 * violations keep their native code/details/hint so the deputy-invariant gates
 * can observe them — errors are never swallowed.
 */
export function dbError(error: SupabaseError | null, fallback: string): ActionError {
  return {
    error: {
      code: error?.code,
      message: error?.message ?? fallback,
      details: error?.details,
      hint: error?.hint,
    },
  };
}

// ── CRM activity vocabulary (M-4) ────────────────────────────────────────────

/**
 * The canonical `crm_activity_kind` enum values, as accepted by
 * `pmo_query.create_activity` (the display form is the DB enum value).
 * Single source of truth so the two write paths share one vocabulary.
 */
export const ACTIVITY_KINDS = ["Call", "Email", "Meeting", "Note"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * `create_activity` accepts lowercase aliases (its existing, tested input
 * contract) and normalizes them to the canonical enum above. Centralized so the
 * mapping cannot drift from ACTIVITY_KINDS.
 */
export const ACTIVITY_KIND_FROM_ALIAS: Readonly<Record<string, ActivityKind>> = Object.freeze({
  call: "Call",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
});
