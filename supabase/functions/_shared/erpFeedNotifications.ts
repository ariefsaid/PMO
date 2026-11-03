import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

/**
 * P3b — the generic action-required surface (task 6.2/3.6). Writes to the EXISTING `notifications`
 * surface (0048), matching `notifyFinanceUnassignedInvoice`'s established pattern, generalized across
 * every P3b action-required reason (never-adopted Timesheet, desk-cancel, unresolved/ambiguous Employee
 * link, a confirmed link's email changing). Best-effort: a notification failure is logged, never
 * propagated — the caller's own write (the mint/update/tombstone) must never be lost to it.
 *
 * Exported (P3c slice 5): `erpnext-sweep/index.ts`'s `reconcileOrgBudgetPushesLive` surfaces its own
 * `'budget-push-no-outbox-candidate'` reason through this SAME surface, rather than a second one.
 */
export async function surfaceActionRequired(
  serviceClient: SupabaseClient,
  orgId: string,
  actionRequired: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    // ⚑ HIGH-A — DEDUPE FIRST. Every one of these reasons is raised from a path the sweep re-runs on a
    // cron tick for as long as the underlying condition holds (a Desk-created Budget sits in ERPNext
    // forever; a desk-cancelled push stays cancelled). Inserting one row per Admin/Finance profile per
    // tick is unbounded `notifications` growth from a single Desk action — and it buries the inbox that
    // is supposed to make the condition actionable. Suppressed only against an UNRESOLVED (unread)
    // notification for the SAME reason AND the SAME document: once a human reads/dismisses it, a
    // recurrence is allowed to surface again, and a different document always surfaces on its own.
    const dedupeKey = { action_required: actionRequired, ...detail };
    const { data: existing, error: existingError } = await serviceClient.from('notifications').select('id')
      .eq('org_id', orgId).is('read_at', null).contains('metadata', dedupeKey).limit(1);
    if (existingError) throw new AppError(existingError.message, existingError.code);
    if (Array.isArray(existing) && existing.length > 0) return;

    const { data, error } = await serviceClient.from('profiles').select('id')
      .eq('org_id', orgId).eq('status', 'active').in('role', ['Admin', 'Finance']);
    if (error) throw new AppError(error.message, error.code);
    const recipients = (data as Array<{ id: string }> | null) ?? [];
    if (recipients.length === 0) {
      console.error(`[erpnextFeedDeps] no active Admin/Finance recipient in org ${orgId} — ${actionRequired} is unsurfaced`);
      return;
    }
    const { error: insertError } = await serviceClient.from('notifications').insert(
      recipients.map((r) => ({
        org_id: orgId,
        owner_id: r.id,
        severity: 'warning',
        title: 'Action required',
        body: describeActionRequired(actionRequired, detail),
        metadata: dedupeKey, // the SAME shape the dedupe probe matches on (`metadata @> dedupeKey`)
      })),
    );
    if (insertError) throw new AppError(insertError.message, insertError.code);
  } catch (err) {
    console.error(`[erpnextFeedDeps] surfaceActionRequired(${actionRequired}) for org ${orgId} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** #775 phase B — raise `expense-posting-desk-cancelled` unless PMO queued this cancel itself. Only an approval
 *  can be cancelled by PMO (`<claim>:approval-cancel`); a cancel of any other posting is never PMO's. */
export async function surfaceExpenseDeskCancelUnlessOurs(serviceClient: SupabaseClient, orgId: string, postingIdentity: string): Promise<void> {
  if (postingIdentity.endsWith(':approval')) {
    const { data, error } = await serviceClient.from('expense_posting_erp_mirror').select('id')
      .eq('org_id', orgId).eq('posting_identity', `${postingIdentity}-cancel`).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    if (data) return;
  }
  await surfaceActionRequired(serviceClient, orgId, 'expense-posting-desk-cancelled', { postingIdentity });
}

/** Human-readable body text per action-required reason — kept out of the caller sites so a new reason
 *  is a one-line addition here, never a copy-pasted notification insert. */
function describeActionRequired(actionRequired: string, detail: Record<string, unknown>): string {
  switch (actionRequired) {
    case 'employee-link-no-email':
      return `Adopted Employee ${detail.erpEmployeeId ?? ''} has no work email on record — link it to a PMO user manually.`;
    case 'employee-link-no-match':
      return `No PMO user matches work email ${detail.workEmail ?? ''} for the adopted Employee ${detail.erpEmployeeId ?? ''} — link it manually.`;
    case 'employee-link-ambiguous':
      return `Multiple PMO users match work email ${detail.workEmail ?? ''} for the adopted Employee ${detail.erpEmployeeId ?? ''} — confirm the correct link manually.`;
    case 'employee-link-email-changed':
      return `The linked Employee's work email changed in ERPNext — the CONFIRMED link was NOT re-pointed (a security property, not a bug).`;
    case 'timesheet-native-not-adopted':
      return `A Timesheet created directly in ERPNext (${detail.erpName ?? ''}) was NOT imported — PMO is the source of truth for hours; enter it in PMO instead.`;
    case 'timesheet-desk-cancelled':
      return `A Timesheet was cancelled directly in ERPNext after PMO pushed it — the push is marked failed for review.`;
    case 'budget-native-not-adopted':
      return `A Budget created directly in ERPNext (${detail.erpName ?? ''}) was NOT imported — PMO is the source of truth for the budget figure; author it in PMO instead.`;
    case 'budget-desk-cancelled':
      return `A Budget was cancelled directly in ERPNext after PMO pushed it — the push is marked failed for review. PMO's budget version is unchanged.`;
    case 'budget-push-no-outbox-candidate':
      return `An activated budget's automatic push to ERPNext never reached the queue — retry from the budget's version history, or contact support.`;
    case 'erp-actuals-undated-fiscal-year':
      return `Some ERP ledger entries carry no fiscal year, so their spend cannot appear under any year on the budget screen — set the fiscal year on those GL entries in ERPNext.`;
    case 'receipt-withholding-unconfirmed':
      return `Receipt ${detail.erpName ?? ''} in ERPNext carries a withholding-tax deduction PMO could not confirm (${detail.reason ?? 'unknown'}) — PMO recorded the cash amount without the tax. Check the Payment Entry's deductions in ERPNext.`;
    case 'party-match-unclear':
      return `ERP ${detail.erpName ?? 'party'} matches more than one company in PMO (or one with a different tax ID), so it was not linked. Merge or rename the PMO duplicates, then it links on its next change.`;
    case 'contact-not-adopted':
      return `ERPNext Contact ${String(detail.erpName ?? '').replace(/^Contact:/, '')} was NOT synced to PMO (${detail.reason ?? 'refused'}) — resolve its company links or duplicate in ERPNext; later contact changes are unaffected.`;
    case 'budget-push-failed':
      return `PMO could not push the activated budget to ERPNext (${detail.reason ?? 'unknown error'}) — ERPNext is still enforcing the previous budget (or none) for this project.`;
    case 'erp-doc-missing-field':
      return `ERPNext sent ${detail.externalRecordId ?? 'a document'} without its ${detail.field ?? 'required'} field, so PMO did not record it — add the field to the ERPNext webhook configuration.`;
    case 'expense-posting-desk-cancelled':
      return `An expense posting PMO made in ERPNext was cancelled directly in ERPNext — the claim in PMO is unchanged; review the ledger.`;
    case 'expense-posting-failed':
      return `An expense claim could not be posted to ERPNext (${detail.reason ?? 'unknown reason'}) — fix the cause; the next sweep retries it.`;
    case 'expense-posting-held':
      return `An expense posting to ERPNext needs an operator (${detail.reason ?? 'unknown reason'}) — it is not retried automatically.`;
    case 'imprest-posting-desk-cancelled':
      return `A site float top-up PMO posted in ERPNext was cancelled directly in ERPNext — the replenishment in PMO is unchanged; review the ledger.`;
    case 'imprest-posting-failed':
      return `A site float top-up could not be posted to ERPNext (${detail.reason ?? 'unknown reason'}) — fix the cause; the next sweep retries it.`;
    case 'imprest-posting-held':
      return `A site float top-up posting to ERPNext needs an operator (${detail.reason ?? 'unknown reason'}) — it is not retried automatically.`;
    default:
      return `Action required: ${actionRequired}`;
  }
}

/**
 * Luna BLOCK 13 — the action-required surfacing for a project-less inbound Sales Invoice (FR-SAR-085).
 * Writes to the EXISTING `notifications` surface (0048: the in-app inbox + unread badge) for the org's
 * active Finance/Admin profiles, so the 'Unassigned' revenue bucket actually prompts somebody instead
 * of silently accumulating native invoices.
 *
 * Best-effort by design: the invoice is ALREADY adopted when this runs, and re-running the adopt is not
 * possible (the ref is claimed) — so a notification failure is logged, never propagated, rather than
 * losing the money row itself.
 */
export async function notifyFinanceUnassignedInvoice(
  serviceClient: SupabaseClient,
  orgId: string,
  invoice: { salesInvoiceId: string; siNumber: string; amount: string | number | null },
): Promise<void> {
  try {
    const { data, error } = await serviceClient.from('profiles').select('id')
      .eq('org_id', orgId).eq('status', 'active').in('role', ['Finance', 'Admin']);
    if (error) throw new AppError(error.message, error.code);
    const recipients = (data as Array<{ id: string }> | null) ?? [];
    if (recipients.length === 0) {
      console.error(`[erpnextFeedDeps] no active Finance/Admin recipient in org ${orgId} — unassigned invoice ${invoice.siNumber} is unsurfaced`);
      return;
    }
    const { error: insertError } = await serviceClient.from('notifications').insert(
      recipients.map((r) => ({
        org_id: orgId,
        owner_id: r.id,
        severity: 'warning',
        title: 'Invoice needs a project',
        body: `Sales Invoice ${invoice.siNumber}${invoice.amount != null ? ` (${invoice.amount})` : ''} arrived from ERPNext without a project and is in the Unassigned bucket. Assign it to a project.`,
        metadata: { sales_invoice_id: invoice.salesInvoiceId, si_number: invoice.siNumber, action_required: 'assign-project' },
      })),
    );
    if (insertError) throw new AppError(insertError.message, insertError.code);
  } catch (err) {
    console.error(`[erpnextFeedDeps] Finance notification for unassigned invoice ${invoice.siNumber} (org ${orgId}) failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
