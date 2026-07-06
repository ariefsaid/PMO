/**
 * Classifies a mutation/transition error into a human toast headline by its preserved
 * Postgres/PostgREST code, keeping the verbatim message as the secondary detail (the
 * silent-no-op fix). Promoted from `pages/ProcurementDetails.tsx` to a shared lib (ADR-0017)
 * so every CRUD mutation can surface a classified, recoverable failure instead of a generic one.
 *
 * Code mapping:
 *   P0001 → illegal state/stage transition (RAISE EXCEPTION in a state-machine RPC)
 *   42501 → insufficient privilege / SoD (RLS or RPC role check)
 *   23505 → unique-constraint violation (duplicate)
 *   23503 → foreign-key violation (the row is still referenced — e.g. an in-use company delete)
 *   else  → generic "Update failed"
 *
 * The code is read structurally (any error exposing a string `.code` — `AppError`,
 * `ProcurementError`, `TimesheetWriteError`, or a raw PostgREST error), so the helper
 * is backend-agnostic.
 *
 * `overrides` (ops-admin-surface S4): an optional caller-specific code→headline map, checked
 * BEFORE the built-in Postgres-code mapping — so a call-site with its own non-Postgres codes
 * (e.g. the admin-invite-user edge fn's `DUPLICATE_EMAIL`/`INVITE_UNAUTHORIZED`/`INVALID_ROLE`/
 * `UNKNOWN_ORG`) can classify them without this shared helper needing to know every caller's
 * vocabulary. An unmatched code (in neither `overrides` nor the built-in map) falls through to
 * the generic "Update failed" headline, same as today.
 */
export function classifyMutationError(
  err: unknown,
  overrides?: Record<string, string>,
): { headline: string; detail: string } {
  const detail = err instanceof Error ? err.message : 'An error occurred';
  const code = typeof (err as { code?: unknown })?.code === 'string'
    ? (err as { code: string }).code
    : undefined;

  if (code && overrides && Object.prototype.hasOwnProperty.call(overrides, code)) {
    return { headline: overrides[code], detail };
  }

  switch (code) {
    case 'P0001':
      return { headline: "That move isn't allowed from the current stage.", detail };
    case '42501':
      return { headline: "You don't have permission to do that.", detail };
    case '23505':
      return { headline: 'That already exists.', detail };
    case '23503':
      return { headline: 'Still in use', detail };
    default:
      return { headline: 'Update failed', detail };
  }
}
