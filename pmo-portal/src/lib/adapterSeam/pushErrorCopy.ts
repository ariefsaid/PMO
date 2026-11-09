/**
 * pushErrorCopy.ts — the ONE translation from a persisted `*_erp_mirror.push_error` to something a
 * human reads, plus the two properties every push surface must key its affordances on.
 *
 * ⚑ WHY THIS EXISTS (rendered Discover pass, 2026-07-22 — I-5/I-6/I-7/I-14/I-15).
 * `push_error` is a MACHINE token. The budget banner rendered it verbatim (`budget-category-unmapped`)
 * and the timesheet badge rendered the writer's `"<code>: <message>"` concatenation verbatim
 * (`activity-type-unconfigured: binding config has no default_activity_type`). Both put an adapter's
 * internal vocabulary in front of an operator on the primary money surfaces. Worse, both offered
 * **Retry** for causes a retry can never fix — while the budget surface already gets exactly this
 * contract right for `unstamped-activation` (explain the real route, offer no button that can only
 * fail). Retryability is a property of the CODE, not of the component that happens to display it, so
 * it is decided once, here, and proven once, here.
 *
 * Three facts per code:
 *   • `message`  — a sentence. NEVER a token (the tests assert against the test-support
 *                  `lib/testing/rawAdapterToken` oracle).
 *   • `retryable`— can re-running the SAME command plausibly land it without a change elsewhere?
 *                  Fail OPEN on an unknown code: stranding an operator is worse than a wasted click.
 *   • `transport`— did it fail to REACH ERPNext (nothing on screen was fixable), or did ERPNext /
 *                  the gate understand it and refuse (something above may need fixing)? I-6.
 *
 * `remedy` is what must change first; it is always present when `retryable` is false, because a
 * withheld button with no route out is a dead end (the C-3 lesson, applied to error copy).
 */

export interface PushErrorCopy {
  /** The classified code, for logic/tests. `null` when nothing was recorded. */
  code: string | null;
  /** A human sentence. Never contains a raw adapter token. */
  message: string;
  /** May re-running the same command plausibly succeed? */
  retryable: boolean;
  /** Did it fail to REACH ERPNext (as opposed to being refused by a rule)? */
  transport: boolean;
  /** What must change first. Always set when `retryable` is false. */
  remedy: string | null;
  /** `info`: nothing went wrong, so a surface must not style it as a failure. Absent for every real failure. */
  severity?: 'info';
}

interface Entry {
  message: string;
  retryable: boolean;
  transport?: boolean;
  remedy?: string;
  severity?: 'info';
}

/** Codes whose copy lives in the `project` locale (`projectDetail.budget.pushError.<code>`). The rest of this
 *  module is still inline English: translating it is a follow-up. */
export const TRANSLATED_PUSH_ERRORS: ReadonlySet<string> = new Set([
  'budget-project-start-date-missing',
  'budget-fiscal-year-unresolved',
  'budget-fiscal-year-ambiguous',
  'budget-multi-fiscal-year-unphased',
  'outbox-finalize-refused',
]);

const CODES: Record<string, Entry> = {
  // ── budget push ──────────────────────────────────────────────────────────────────────────────
  'budget-category-unmapped': {
    // Retryable ON PURPOSE: this is precisely the case HIGH-D exists for — the Admin maps the missing
    // categories, then re-drives under their own JWT (the sweep backstop excludes `held`).
    message: 'One or more budget categories have no ERP account mapped, so ERPNext cannot accept the budget.',
    retryable: true,
    remedy: 'Map every listed category to an ERP account, then retry.',
  },
  'budget-multi-fiscal-year': {
    message: 'This budget spans more than one fiscal year, which ERPNext records as one budget per year.',
    retryable: false,
    remedy: 'Split the budget so each version covers a single fiscal year, then activate it again.',
  },
  // #1364 — refused before anything was written: the project's own dates decide the fiscal years, so the
  // fix is on the project, and a retry cannot succeed until it is made.
  'budget-project-start-date-missing': {
    message: 'The project has no start date, so PMO cannot tell which fiscal year this budget belongs to.',
    retryable: false,
    remedy: 'Set the project start and end dates, then retry the push.',
  },
  'budget-fiscal-year-unresolved': {
    message: 'No ERPNext fiscal year contains the project start or end date.',
    retryable: false,
    remedy: 'Add the missing fiscal year in ERPNext, or correct the project dates, then retry the push.',
  },
  'budget-fiscal-year-ambiguous': {
    message: 'More than one ERPNext fiscal year contains the project start date, so PMO will not pick one.',
    retryable: false,
    remedy: 'Remove the overlap between the fiscal years in ERPNext, then retry the push.',
  },
  'budget-multi-fiscal-year-unphased': {
    message: 'The project spans more than one fiscal year but some budget lines have no fiscal year.',
    retryable: false,
    remedy: 'Set a fiscal year on every budget line (or shorten the project dates to one year), then activate again.',
  },
  // #1364 — the ERP document exists but PMO's finalize step refused to record it, repeatedly. The refusals
  // behind it are rules (a different Budget on the slot, a changed version), so a Retry meets the same one.
  'outbox-finalize-refused': {
    message: 'ERPNext accepted the budget, but PMO could not record its reference after several tries.',
    retryable: false,
    remedy: "Retrying repeats the same refusal. Ask an administrator to check the ERPNext connection and the budget's saved reference.",
  },
  'budget-draft-rival-on-grain': {
    message: 'ERPNext already holds an unsubmitted budget for this project and fiscal year.',
    retryable: false,
    remedy: 'In ERPNext, submit or delete that draft budget — until then every push is refused as a duplicate.',
  },
  // FR-BFY-076 (review finding 7) — the SUBMITTED counterpart. The draft rival is refused because
  // ERPNext would refuse us; this one must be refused because ERPNext would NOT: cancelling and
  // amending an accountant's own budget is a destructive act on their work, and PMO would then record
  // the result as its own push.
  'budget-unowned-live-occupant': {
    message: 'ERPNext already holds a budget for this project and fiscal year that PMO did not create.',
    retryable: false,
    remedy:
      'Someone authored that budget in ERPNext directly. PMO will not cancel or amend it unless an Admin or Finance user confirms. They can use its figures as a PMO draft, or replace it with this version.',
  },
  'budget-enforcement-absent': {
    // HIGH-1: the previous ERP budget was cancelled and its replacement never landed.
    message: 'ERPNext is currently enforcing no budget at all for this project — the previous one was withdrawn and its replacement never landed.',
    retryable: true,
  },
  // ── timesheet push ───────────────────────────────────────────────────────────────────────────
  'cross-org-link-rejected': {
    message: 'This timesheet references a record that belongs to a different organisation, so it was refused.',
    retryable: false,
    remedy: 'This is a linkage fault in the underlying data — raise it with an administrator rather than retrying.',
  },
  'employee-unlinked': {
    message: 'This person is not linked to an ERP employee record, so their hours have nowhere to go.',
    retryable: false,
    remedy: 'Confirm their employee link in the queue above; the push is then driven again automatically.',
  },
  'project-unmapped': {
    message: 'A project on this timesheet is not mapped to an ERP project.',
    retryable: false,
    remedy: 'Map the project to its ERP counterpart before pushing these hours.',
  },
  'timesheet-not-approved': {
    // ⚑ NEW-2 — the server's structural refusal, which reached the operator VERBATIM through the
    // retry toast (`timesheet-not-approved (status Submitted)`). Classifying it also withdraws the
    // Retry on the badge path, which is the I-14 rule: the sheet's approval must change first, and no
    // number of retries can do that.
    message: 'Only an approved timesheet can be pushed to ERPNext, and this one is not approved right now.',
    retryable: false,
    remedy: 'Approve the timesheet first — the push is then driven under the approver’s own authority.',
  },
  'activity-type-unconfigured': {
    message: 'The ERPNext connection has no default activity type, so hours cannot be recorded against one.',
    retryable: false,
    remedy: 'Set a default activity type on the ERPNext connection — this is ERP-side configuration, not something a retry can supply.',
  },
  // ⚑ MEDIUM-1 (audit round 7) — the SWEEP's two park reasons. Both mark the mirror row `held`, but
  // NEITHER leaves a `held` outbox command behind, so the release affordance is (correctly) withheld for
  // them — which makes classifying them mandatory rather than nice: a withheld button beside an
  // unclassified fallback tells the operator neither what happened nor what to do. Retryable ON PURPOSE:
  // the sweep gave up on re-driving the row, it did not reject the budget, so a fresh push is exactly
  // the way out and it re-runs every gate.
  'budget-push-attempts-exhausted': {
    message: 'The automatic recovery ran out of attempts before ERPNext accepted this budget, so it stopped trying on its own.',
    retryable: true,
    remedy: 'Retry the push — it starts a fresh attempt and runs every check again.',
  },
  'budget-push-no-outbox-candidate': {
    message: 'There is no queued push command left for this budget, so the automatic recovery had nothing to work with.',
    retryable: true,
    remedy: 'Retry the push to queue a fresh command.',
  },
  // ── the register and its maintenance (#1511 F4) ──────────────────────────────────────────────
  // Refused BEFORE any outbox row: the asset page is where each is fixed, so no retry can help.
  'equipment-not-linked': {
    message: 'This asset is not linked to the Odoo register yet.',
    retryable: false,
    remedy: 'An Admin matches it to its Odoo asset on the match screen, then record this again.',
  },
  'equipment-kind-mismatch': {
    message: 'A vehicle takes a service log; equipment takes a maintenance request.',
    retryable: false,
    remedy: 'Record the right kind of maintenance for this asset: a service log for a vehicle, a maintenance request for equipment.',
  },
  'register-role': {
    message: 'Only an Admin or Project Manager can change the register.',
    retryable: false,
    remedy: 'Ask an Admin or a Project Manager to save this change; anyone can record maintenance.',
  },
  // The id a register CREATE reserves is already in the book (this org's or another's): nothing was sent, and a retry would meet the
  // same row. The asset page is where the fresh id comes from.
  'record-id-invalid': {
    message: 'This save would reuse a PMO asset identity that already belongs to a record, so it was not sent to the register.',
    retryable: false,
    remedy: 'Start the register entry again from the asset page, so it gets its own identity.',
  },
  // A picker the caller named — a vehicle model, a maintenance stage, a service type, a vendor — is not one the Odoo directory
  // mirrors for this organisation, so the register holds no row PMO could point at. Refused before any outbox row.
  'vehicle-model-invalid': {
    message: 'The vehicle model this entry names is not in the Odoo directory PMO mirrors for your organisation.',
    retryable: false,
    remedy: 'Pick a model from the Odoo list, or sync the Odoo directory, then save again.',
  },
  'stage-invalid': {
    message: 'The maintenance stage this entry names is not in the Odoo directory PMO mirrors for your organisation.',
    retryable: false,
    remedy: 'Pick a stage from the Odoo list, or sync the Odoo directory, then save again.',
  },
  'service-type-invalid': {
    message: 'The service type this entry names is not in the Odoo directory PMO mirrors for your organisation.',
    retryable: false,
    remedy: 'Pick a service type from the Odoo list, or sync the Odoo directory, then save again.',
  },
  'vendor-invalid': {
    message: 'The vendor this entry names is not in the Odoo directory PMO mirrors for your organisation.',
    retryable: false,
    remedy: 'Pick a vendor from the Odoo list, or sync the Odoo directory, then save again.',
  },
  // ── cut-over (FR-ECA-030, OQ-ECA-1) ──────────────────────────────────────────────────────────
  // Not a failure: a purchase ordered before the ERP connection is finished in PMO, on purpose.
  'pre-cutover': {
    message: 'Not sent: this purchase started before the ERP connection',
    retryable: false,
    severity: 'info',
    remedy: 'Nothing was saved. Record this step again in PMO: this purchase finishes there.',
  },
  // ── shared ───────────────────────────────────────────────────────────────────────────────────
  'commit-rejected': {
    message: 'ERPNext understood the request and refused it.',
    retryable: true,
  },
  // ── ERP master sends (#1504 S8): the reasons an Odoo create or lookup is refused, as the adapter raises them ──
  validation: {
    message: 'The ERP refused this record because something in it is not valid there.',
    retryable: true,
    remedy: 'Check the record\u2019s name, tax number and code, fix what is wrong, then try again.',
  },
  ambiguous: {
    message: 'Two records in the ERP match this one, so nothing was sent.',
    retryable: false,
    remedy: 'Link the right ERP record by hand, or remove the duplicate there.',
  },
  'unit-unmapped': {
    message: 'This item\u2019s unit has no match in the ERP yet, so it was not sent.',
    retryable: false,
    remedy: 'Match the unit in the ERP connection settings, then send the item again.',
  },
  'analytic-plan-unset': {
    message: 'No cost account plan is chosen for projects yet, so this project was not sent.',
    retryable: false,
    remedy: 'Choose the plan in the ERP connection settings, then send the project again.',
  },
  'config-rejected': {
    message: 'The ERPNext connection is not usable — it is inactive, or its version no longer matches.',
    retryable: false,
    remedy: 'Reconnect ERPNext from the integrations settings before pushing again.',
  },
  'command-held': {
    message: 'This push is held for a person to decide — a machine must not resolve it on its own.',
    retryable: false,
    remedy: 'An administrator must release the hold once the underlying condition is resolved.',
  },
  // ⚑ MINOR 3 (money-safety audit round 12) — the three RECOVERY hold reasons 0158 now persists on a
  // `held` timesheet mirror for the first time (`adapterSeam/dispatch.ts`). Each means the same money
  // fact: the submit reached ERPNext and PMO could not establish the outcome, so a machine must not
  // resolve it. NOT retryable — re-running the same command only lands the outbox's inert `held`
  // branch; the route out is a person, either releasing the hold or confirming what ERPNext holds.
  'recovery-probe-failed': {
    message: 'The push reached ERPNext, but the automatic check of what happened there failed, so PMO cannot tell whether ERPNext recorded these hours.',
    retryable: false,
    remedy: 'An administrator must confirm what ERPNext holds for this week, then release the hold — retrying cannot answer that question.',
  },
  'recovery-inconclusive-absence': {
    message: 'The push reached ERPNext and the automatic check could not prove whether a document was created, so PMO is holding rather than sending it a second time.',
    retryable: false,
    remedy: 'An administrator must confirm what ERPNext holds for this week, then release the hold — retrying risks a duplicate.',
  },
  'recovery-reissue-unauthorized': {
    message: 'This push is held because the person recorded as its approver is no longer authorised to send it, and PMO will not send it again under anyone else.',
    retryable: false,
    remedy: 'Re-activate the approver, or have an administrator resolve the hold — retrying under the same recorded approver is refused.',
  },
  // ── purchase-order revise refusals (#1998) ───────────────────────────────────────────────────
  revision_superseded: {
    message: 'A newer revision already exists for this purchase order, so this revision cannot be pushed.',
    retryable: false,
    remedy: 'View the latest revision of the purchase order to send or review changes.',
  },
  'revision-superseded': {
    message: 'A newer revision already exists for this purchase order, so this revision cannot be pushed.',
    retryable: false,
    remedy: 'View the latest revision of the purchase order to send or review changes.',
  },
  po_has_submitted_bill: {
    message: 'This purchase order has a submitted supplier bill in the ERP, so it cannot be revised to cancel the order.',
    retryable: false,
    remedy: 'Cancel or credit the submitted bill in the ERP first before revising this purchase order.',
  },
  revision_not_issued: {
    message: 'This purchase order revision has not been issued yet in PMO.',
    retryable: false,
    remedy: 'Issue the revision before pushing it to the ERP.',
  },
  po_not_found: {
    message: 'The purchase order could not be found.',
    retryable: false,
    remedy: 'Check that the purchase order exists and has not been deleted.',
  },
  'below-received': {
    message: 'Ordered quantity cannot be reduced below the quantity already received or billed.',
    retryable: false,
    remedy: 'Adjust the revision quantity to be at least the received or billed amount.',
  },
  // ⚑ round-12 SHOULD-FIX 2 (mirror half) — the attestation moves a `held` mirror to `failed` and leaves
  // this code. That row lands in the same "needs attention" queue, so it must classify rather than read
  // "could not be classified" like the recovery codes above once did. Retryable: the whole point of the
  // attestation is that PMO confirmed ERPNext holds nothing, so the recovery route is restored and a
  // fresh push is exactly the way the hours reach ERP.
  'operator-attested-no-erp-document': {
    message: 'An administrator confirmed ERPNext holds no document for this week, so this push is clear to run again.',
    retryable: true,
  },
  'external-unreachable': {
    message: 'ERPNext could not be reached, so the outcome is unconfirmed.',
    retryable: true,
    transport: true,
    remedy: 'The system rechecks ERPNext on its own; confirm there before assuming the push did not land.',
  },
  DISPATCH_FAILED: {
    message: 'The push stopped before ERPNext answered, so the outcome is unconfirmed.',
    retryable: true,
    transport: true,
  },
};

/**
 * Splits the writer's persisted shape. `markTimesheetPushOutcome` stores `"<code>: <message>"`;
 * `recordBudgetPushFailure` stores a bare code (or `"<code>: <redacted detail>"` for
 * `budget-enforcement-absent`). Everything after the first `:` is adapter/ERP prose and is DROPPED —
 * it is the half that leaks internals, and the classified sentence already says what happened.
 */
function splitCode(raw: string): string {
  const head = raw.split(':', 1)[0]!.trim();
  // ⚑ NEW-2 — a LIVE mutation error does not arrive in the persisted `"<code>: <detail>"` shape. The
  // server throws the writer's own prose, e.g. `timesheet-not-approved (status Submitted)`, so the
  // code is the leading TOKEN rather than everything before the first colon. Without this the one
  // surface that matters most — the operator's own retry — always fell through to the unclassified
  // sentence, losing the remedy. No shipped code contains whitespace or a parenthesis, so taking the
  // leading token can only ever classify MORE, never differently.
  return head.split(/[\s(]/, 1)[0]!.trim();
}

/**
 * ⚑ NEW-2 — the SAME translation, for a live mutation rejection rather than a persisted
 * `push_error`. `classifyMutationError` is the generic CRUD classifier and passes the server's message
 * through verbatim as `detail`; on a push surface that is an adapter token in front of an operator,
 * which is the exact contract this module exists to enforce. Every push surface — persisted state AND
 * live rejection — goes through here, so there is one vocabulary and one place to extend it.
 */
export function describePushMutationError(err: unknown): PushErrorCopy {
  // A classified code beats prose: the cut-over answer is information, and its sentence must not be re-parsed.
  if ((err as { code?: unknown } | null)?.code === 'pre-cutover') return describePushError('pre-cutover');
  const raw =
    err instanceof Error ? err.message : typeof err === 'string' ? err : null;
  return describePushError(raw);
}

export function describePushError(raw: string | null | undefined): PushErrorCopy {
  const accountMatch = raw?.match(/: account=([^\r\n]*)$/);
  const account = accountMatch?.[1]?.trim().slice(0, 120) || null;
  const classifiedInput = accountMatch ? raw!.slice(0, accountMatch.index) : raw;
  if (!classifiedInput || classifiedInput.trim() === '') {
    return {
      code: null,
      message: 'The push did not complete, and no reason was recorded for it.',
      // Fail OPEN: an unrecorded reason is not evidence that a retry is futile.
      retryable: true,
      transport: false,
      remedy: null,
    };
  }

  let code = splitCode(classifiedInput);
  let entry = CODES[code];
  if (!entry || code === 'commit-rejected' || code === 'adapter-held') {
    const subMatch = classifiedInput.match(/\b(revision_superseded|revision-superseded|po_has_submitted_bill|revision_not_issued|po_not_found|below-received)\b/);
    if (subMatch && CODES[subMatch[1]]) {
      code = subMatch[1];
      entry = CODES[code];
    }
  }
  if (entry) {
    return {
      code,
      message: account ? `${entry.message} Account: ${account}.` : entry.message,
      retryable: entry.retryable,
      transport: entry.transport ?? false,
      remedy: entry.remedy ?? null,
      ...(entry.severity ? { severity: entry.severity } : {}),
    };
  }

  // ⚑ Unknown code. It is NEVER printed — a token an operator cannot act on is noise that looks like
  // information. It is named as unclassified, and stays retryable so a new failure class cannot strand
  // anyone before someone gets round to classifying it here.
  return {
    code,
    message: account
      ? `The push failed for a reason this screen could not be classified against a known cause. Account: ${account}.`
      : 'The push failed for a reason this screen could not be classified against a known cause.',
    retryable: true,
    transport: false,
    remedy: null,
  };
}
