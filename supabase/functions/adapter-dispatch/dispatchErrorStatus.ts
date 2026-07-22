/**
 * adapter-dispatch/dispatchErrorStatus.ts (AC-TSP-031) — the ONE code→HTTP-status map for this
 * function's two failure exits: adapter-select (the fail-closed pre-flight, which runs BEFORE the
 * outbox claim and any ERP call) and dispatch (the commit itself).
 *
 * ⚑ WHY THIS EXISTS. The two exits had forked ladders: the dispatch catch classified
 * `commit-rejected`/budget codes as 422, while the adapter-select catch answered a flat **400** for
 * EVERYTHING — so the timesheet push's classified business rejections (`cross-org-link-rejected`,
 * `employee-unlinked`, `project-unmapped`, `activity-type-unconfigured`), which are raised precisely
 * there, told the client "malformed request". A client that switches on 422 to mean "the server
 * understood you and refused on a business rule" cannot distinguish those from a bad body — and the
 * refusal that matters most on this surface (a week of hours that would have crossed a tenant
 * boundary) was the one mis-stated.
 *
 * Pure + Deno-importable (no `Deno.*`, no supabase-js), so the contract is unit-provable
 * (`dispatchErrorStatus.test.ts`) rather than reachable only through the served stack.
 */
import { COMMAND_IN_FLIGHT_FOR_RECORD } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';

/**
 * The classified BUSINESS rejections — the server understood the command and refused it on a rule.
 * Every one of them is unprocessable-entity (422), never 400: the request was well-formed.
 *
 * ⚑ Fail-closed by omission: an UNCLASSIFIED code keeps the caller's own fallback (400 at
 * adapter-select, 500 at dispatch) rather than being optimistically re-labelled as a business
 * rejection — a new failure class must be named here deliberately.
 */
const BUSINESS_REJECTION_CODES: readonly string[] = [
  // generic — the adapter/body refused the command (ERP rejected it, or a fail-closed body guard)
  'commit-rejected',
  // the erpnext binding itself is unusable (absent/never activated, version handshake mismatch)
  'config-rejected',
  // P3b timesheet push — the fail-closed ref pre-flight (dispatchFactory.ts `resolveTimesheetRefs`)
  'cross-org-link-rejected',
  'employee-unlinked',
  'project-unmapped',
  'activity-type-unconfigured',
  // P3c budget push — the gate's own classified refusals
  'budget-category-unmapped',
  'budget-multi-fiscal-year',
  // ⚑ HIGH-1 (audit round 5): a DRAFT Budget already occupying the (company, fiscal_year, project)
  // grain. ERPNext's duplicate guard counts it, so the push CANNOT succeed until a human submits or
  // deletes that draft — a business refusal with a precise remedy, raised inside adapter select (whose
  // own unclassified fallback is 400, i.e. "malformed request", which this state is not).
  'budget-draft-rival-on-grain',
];

export function isBusinessRejectionCode(code: unknown): code is string {
  return typeof code === 'string' && BUSINESS_REJECTION_CODES.includes(code);
}

/**
 * The HTTP status for a classified dispatch failure.
 *
 * `fallback` is the caller's own "unclassified" answer — 400 at adapter-select (a command this
 * function could not even build an adapter for) and 500 at dispatch (an unexpected server failure).
 */
export function dispatchErrorStatus(code: unknown, fallback: number): number {
  if (code === 'external-unreachable') return 502;
  if (code === 'command-held' || code === COMMAND_IN_FLIGHT_FOR_RECORD) return 409;
  if (isBusinessRejectionCode(code)) return 422;
  return fallback;
}
