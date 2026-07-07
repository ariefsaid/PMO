/**
 * historicalImportValidate.mjs — pure terminal-status + committed-value validators for
 * scripts/import-historical.mjs (Deliverable 3, FR-HIST-002/003/004).
 *
 * COMMITTED_STATUSES mirrors pmo-portal/src/lib/db/procurements.ts:28-32 EXACTLY (OD-BUDGET-2) —
 * if that file's list ever changes, this constant must be updated in lockstep (flagged, not
 * automatically synced — there is no build-time import from this Node script into the Vite app;
 * scripts/*.mjs do not import .ts files, per the existing scripts/ directory convention).
 *
 * TERMINAL_PROCUREMENT_STATUSES mirrors the dead-end states of the legal transition map in
 * supabase/migrations/0038_procurement_lifecycle_status_events.sql: 'Paid' -> [], 'Cancelled' -> [],
 * 'Rejected' -> ['Draft'] (reopen-only, not a forward business state). 'Ordered'/'Received'/
 * 'Vendor Invoiced' are mid-flow but legitimately importable as a historical case's LAST OBSERVED
 * state (summary-grade, FR-HIST-009) when no further progress was ever recorded.
 *
 * TERMINAL_PROJECT_STATUSES — the spelling 'Won, Pending KoM' (WITH the comma) is the exact enum
 * literal used by pmo-portal/src/lib/db/projectTransitions.ts's LEGAL_PROJECT_TRANSITIONS /
 * ON_HAND_STATUSES (verified by reading that file directly). This constant intentionally
 * INCLUDES ONLY 'Close Out' and 'Loss Tender' — the two states with no forward-progress legal
 * transition remaining that represents active/paused work ('Won, Pending KoM' and 'On Hold' both
 * transition onward to 'Ongoing Project'/'Close Out' per the legal map, so a project sitting there
 * is NOT closed, just paused/pre-kickoff) — narrower than ON_HAND_STATUSES, which also contains
 * 'Ongoing Project'/'On Hold'/'Won, Pending KoM' (clearly still-active or not-yet-started work).
 * FLAGGED FOR OWNER/DIRECTOR CONFIRMATION: this is a business-semantics judgment call the plan's
 * own list did not verify against the schema (it also had a literal typo: 'Won Pending KoM'
 * without the comma, which would have silently rejected every such row). If the intended scope is
 * broader (e.g. operators want to import a currently-on-hold project as "recent history" too),
 * add the additional statuses here — this is a one-line, fully reversible change.
 */

/** Closed/terminal project statuses (see file docstring — flagged for confirmation). */
export const TERMINAL_PROJECT_STATUSES = ['Close Out', 'Loss Tender'];

/** Terminal procurement_status values a historical case may land at directly. */
export const TERMINAL_PROCUREMENT_STATUSES = [
  'Rejected', 'Ordered', 'Received', 'Vendor Invoiced', 'Paid', 'Cancelled',
];

/** OD-BUDGET-2 committed basis — mirrors procurements.ts:28-32 exactly. */
export const COMMITTED_STATUSES = ['Ordered', 'Received', 'Vendor Invoiced', 'Paid'];

export function validateProjectRow(row) {
  const errors = [];
  if (!TERMINAL_PROJECT_STATUSES.includes(row.status)) {
    errors.push(`status "${row.status}" is not a terminal/closed project status.`);
  }
  if (!row.code?.trim()) errors.push('code is required.');
  if (!row.title?.trim()) errors.push('title is required.');
  if (!row.contract_value?.toString().trim()) errors.push('contract_value is required.');
  if (!row.end_date?.trim()) errors.push('end_date is required.');
  return { valid: errors.length === 0, errors };
}

export function validateCaseRow(row) {
  const errors = [];
  if (!TERMINAL_PROCUREMENT_STATUSES.includes(row.terminal_status)) {
    errors.push(`terminal_status "${row.terminal_status}" is not a terminal procurement status.`);
  }
  if (!row.case_ref?.trim()) errors.push('case_ref is required.');
  if (COMMITTED_STATUSES.includes(row.terminal_status) && !row.total_value?.toString().trim()) {
    errors.push(
      `total_value is required when terminal_status ("${row.terminal_status}") is a committed status (${COMMITTED_STATUSES.join('/')}).`,
    );
  }
  return { valid: errors.length === 0, errors };
}
