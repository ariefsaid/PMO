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

/**
 * Known module ids (2026-07-27 review round 2 #3): a closed set, not `string`. `module`/
 * `operation` typed as plain `string` type-checked `classifyMutationError(err, undefined, {
 * module: company.name })` — the SAME shape as the `capture_dead_clicks` leak, one authoring
 * mistake away. Nothing leaks TODAY (no call site passes the third arg yet), which is exactly
 * why this must be closed before the first caller is wired, not after.
 */
export type AnalyticsModule =
  | 'administration' | 'approvals' | 'auth' | 'budget-account-map' | 'companies' | 'contacts'
  | 'dashboard' | 'incidents' | 'my-tasks' | 'procurement' | 'projects' | 'reports' | 'sales'
  | 'settings' | 'timesheets' | 'unknown';

/** Known mutation operations — a genuinely closed, small set (unlike module ids, which grow).
 *  `'import'` (2026-07-27 #2) marks a `trackBatchSaveFailed` aggregate — never a per-row event. */
export type ClassifyOperation =
  | 'create' | 'update' | 'delete' | 'archive' | 'approve' | 'push' | 'classify' | 'import';

export interface ClassifyContext {
  /** Which module the user was in, e.g. 'companies'. Never derived from user input. */
  module?: AnalyticsModule;
  /** Defaults to 'classify' when omitted. */
  operation?: ClassifyOperation;
  /**
   * SECURITY (2026-07-27 review round 2 #2): set `true` inside a per-row/per-item LOOP (a bulk
   * import commit) to skip this call's OWN analytics capture. Looping classifyMutationError
   * per-row would multiply one user click into thousands of `save_failed` events — PostHog's
   * free-allowance overage DISCARDS PERMANENTLY, so a large bulk failure can silently exhaust
   * the month's headroom and flatten every OTHER chart into a false "nobody uses the product"
   * signal. The classification/headline/detail return value is unaffected — only the analytics
   * side effect is skipped. Call `trackBatchSaveFailed` ONCE after the loop instead.
   */
  suppressCapture?: boolean;
}

// RUNTIME guards (not just the types above): TS types are erased at runtime and a caller can
// always bypass them with `as AnalyticsModule` — the enforcement that actually stops a leak is
// this Set lookup, not the type annotation. The type exists for a good compile-time authoring
// experience; the Set is what makes the leak unrepresentable.
const KNOWN_MODULES: ReadonlySet<AnalyticsModule> = new Set([
  'administration', 'approvals', 'auth', 'budget-account-map', 'companies', 'contacts',
  'dashboard', 'incidents', 'my-tasks', 'procurement', 'projects', 'reports', 'sales',
  'settings', 'timesheets', 'unknown',
]);
const KNOWN_OPERATIONS: ReadonlySet<ClassifyOperation> = new Set([
  'create', 'update', 'delete', 'archive', 'approve', 'push', 'classify', 'import',
]);

function boundModule(module: AnalyticsModule | undefined): AnalyticsModule {
  return module && KNOWN_MODULES.has(module) ? module : 'unknown';
}

function boundOperation(operation: ClassifyOperation | undefined): ClassifyOperation {
  return operation && KNOWN_OPERATIONS.has(operation) ? operation : 'classify';
}

/**
 * SECURITY (2026-07-27 finding): `.code` is typed `string | undefined` (`AppError.code`,
 * `src/lib/appError.ts:16`) — unbounded by construction — and at least one real call site
 * (`src/lib/db/adminUsers.ts:103`, `new AppError(data.error, data.error)`) reads it straight
 * from an external/edge-fn response body, which can carry arbitrary text (an ERP error message
 * routinely embeds the offending record's name/value). A verbatim pass-through into the
 * `reason_code` analytics property would leak that text under an innocuous-looking key — the
 * same class of leak `capture_dead_clicks` was for autocapture, arriving through a different
 * door. `boundReasonCode` closes it: only a reviewed allowlist of known application codes, or a
 * shape that is structurally too short to hold free text (a genuine Postgres SQLSTATE, an HTTP
 * status, a PostgREST error code), ever leaves this function verbatim; everything else collapses
 * to the literal string `'other'`. Truncating instead of bounding was rejected — a truncated
 * customer name is still a customer name.
 *
 * Adding a new custom application error code? It will NOT flow through automatically — add it to
 * `KNOWN_REASON_CODES` (a deliberate friction point, not an oversight).
 */
const KNOWN_REASON_CODES = new Set([
  // Postgres/PostgREST codes already classified in classifyCode() below.
  'P0001', '42501', '23505', '23503', 'REQUEST_TIMEOUT',
  // Custom application-level codes (AppError/InviteError), reviewed 2026-07-27.
  'BAD_REQUEST', 'DUPLICATE_EMAIL', 'INVITE_UNAUTHORIZED', 'INVALID_ROLE', 'UNKNOWN_ORG',
  'BINDING_NOT_FOUND', 'REF_NOT_FOUND', 'INTERNAL_ERROR',
  'activity-type-unconfigured', 'command-held', 'commit-rejected', 'config-rejected',
  'cross-org-link-rejected', 'employee-unlinked', 'external-owned', 'external-unreachable',
  'native-budget-not-adopted', 'native-timesheet-not-adopted', 'not-found',
  'procurement-inbound-adopt-no-case-link', 'project-unmapped', 'revenue-not-enabled',
  'snapshot-replaced-mid-read',
]);

/** A genuine Postgres SQLSTATE is exactly 5 alphanumeric characters — too short to hold a name. */
const SQLSTATE_SHAPE = /^[0-9A-Z]{5}$/;
/** An HTTP status code — 3 digits, 1xx-5xx. */
const HTTP_STATUS_SHAPE = /^[1-5][0-9]{2}$/;
/** PostgREST's own short error codes, e.g. `PGRST116`. */
const POSTGREST_SHAPE = /^PGRST[0-9]{2,4}$/;

function boundReasonCode(code: string | undefined): string {
  if (!code) return 'unknown';
  if (KNOWN_REASON_CODES.has(code)) return code;
  if (SQLSTATE_SHAPE.test(code) || HTTP_STATUS_SHAPE.test(code) || POSTGREST_SHAPE.test(code)) {
    return code;
  }
  return 'other';
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
  // SECURITY (review round 2 #2): `suppressCapture` skips ONLY this side effect — a bulk-import
  // loop calls this per row for its headline/detail but must not multiply one click into
  // thousands of events; see ClassifyContext.suppressCapture + trackBatchSaveFailed below.
  if (!context?.suppressCapture) {
    safeTrack(() =>
      trackSaveFailed(classification, boundOperation(context?.operation), boundReasonCode(code), boundModule(context?.module)),
    );
  }

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

/**
 * Fires ONE aggregate `save_failed` event for a bulk-import commit run (2026-07-27 review round
 * 2 #2). Call sites that loop `classifyMutationError` per row/record must pass
 * `{ suppressCapture: true }` on every per-item call, then call this exactly once after the loop
 * with the total failed count. A no-op when `failedCount` is 0 — a clean run reports nothing.
 */
export function trackBatchSaveFailed(module: AnalyticsModule | undefined, failedCount: number): void {
  if (failedCount <= 0) return;
  safeTrack(() => trackSaveFailed('batch', 'import', 'other', boundModule(module), failedCount));
}
