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
 *   REQUEST_TIMEOUT → a `withTimeout`-wrapped mutation hit its deadline (UI-freeze hardening,
 *                      `withTimeout.ts`'s `REQUEST_TIMEOUT_CODE`) — recoverable, not a crash
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
 *
 * FR-PHG-010/011 (ADR-0067): this is also the single friction-instrumentation point. A
 * `save_failed` analytics event fires from here — not from `useEntityForm` — because this is
 * the one place where "the user was shown a mutation error" is reliably knowable: dozens of call
 * sites across `pages/`/`src/` versus 17 entity forms, none of which passed the hook the props its
 * (now-deleted) `save_failed` branch needed. See ADR-0067 for why the obvious fix ("just pass
 * the missing prop") would still have produced zero events.
 */
import { safeTrack } from './analytics/safeTrack';
import { trackSaveFailed } from './analytics';

/** Stable, PII-free classification slugs for the friction event (ADR-0067). */
type FrictionClass =
  | 'illegal_transition' | 'permission_denied' | 'duplicate'
  | 'in_use' | 'timeout' | 'override' | 'unclassified';

export interface ClassifyContext {
  /** Which module the user was in, e.g. 'companies'. Never derived from user input. */
  module?: string;
  /** 'create' | 'update' | 'delete' | … Defaults to 'classify'. */
  operation?: string;
}

export function classifyMutationError(
  err: unknown,
  overrides?: Record<string, string>,
  context?: ClassifyContext,
): { headline: string; detail: string } {
  const detail = err instanceof Error ? err.message : 'An error occurred';
  const code = typeof (err as { code?: unknown })?.code === 'string'
    ? (err as { code: string }).code
    : undefined;

  // FR-PHG-010/011 (ADR-0067): this is the single point where "the user was shown a mutation
  // error" is knowable. Instrumenting here instead of in the 17 entity forms means a new form
  // cannot forget to opt in, and errors that never touch a form (import, export, ERP push) are
  // covered too. safeTrack because this runs INSIDE error handling — an analytics fault must
  // never propagate into the path that is already recovering. Only the stable code + slug
  // leave; never `detail` (which may embed a user-entered value, e.g. a duplicate-key message).
  const classification = classifyCode(code, overrides);
  safeTrack(() =>
    trackSaveFailed(classification, context?.operation ?? 'classify', code ?? 'unknown', context?.module ?? 'unknown'),
  );

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
    case 'REQUEST_TIMEOUT':
      return { headline: "Request timed out — we couldn't confirm whether it saved.", detail };
    default:
      return { headline: 'Update failed', detail };
  }
}

function classifyCode(code: string | undefined, overrides?: Record<string, string>): FrictionClass {
  if (code && overrides && Object.prototype.hasOwnProperty.call(overrides, code)) return 'override';
  switch (code) {
    case 'P0001': return 'illegal_transition';
    case '42501': return 'permission_denied';
    case '23505': return 'duplicate';
    case '23503': return 'in_use';
    case 'REQUEST_TIMEOUT': return 'timeout';
    default: return 'unclassified';
  }
}
