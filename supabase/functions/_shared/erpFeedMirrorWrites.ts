import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { KIND_DOMAIN, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import { deriveSiStatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/siStatus.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { allocationDetailsPatch } from './receiptAllocations.ts';
import { resolveInvoiceProject } from './projectInvoiceAttribution.ts';
import { deriveIpStatus, putIfPresent, resolveCustomerId, resolveSalesInvoiceId, surfaceWithholdingReview } from './erpFeedRevenue.ts';
import { proposeEmployeeLink } from './erpFeedEmployee.ts';
import { surfaceActionRequired, notifyFinanceUnassignedInvoice } from './erpFeedNotifications.ts';

/** Mint ONE mirror row for an adopted ERP doc, with a CALLER-SUPPLIED PMO id (Luna BLOCK 7: the id is
 *  claimed in `external_refs` before this runs, so a losing racer never reaches here). */
export async function mintMirrorRow(
  serviceClient: SupabaseClient,
  orgId: string,
  kind: ErpDocKind,
  canonical: PmoRecord,
  sourceModMs: number,
  id: string,
): Promise<void> {
  const domain = KIND_DOMAIN[kind];
  if (kind === 'contact') {
    const { error } = await serviceClient.from('contacts').insert({
      id, org_id: orgId, company_id: canonical.company_id,
      full_name: canonical.full_name, email: canonical.email ?? null, phone: canonical.phone ?? null,
      erp_modified: new Date(sourceModMs).toISOString(),
    });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  if (domain === 'companies') {
    // Party adopt (Supplier/Customer created natively in ERP — OQ-4): mint the FULL companies
    // mirror row + the source-mod stamp. Writing only name/type here (the original slice-8 cut)
    // silently dropped the party canonical (erp_supplier_name/tax_id/…) and left erp_modified
    // NULL — so the adopted row was half-empty and the per-row staleness guard never engaged
    // (found live arming the demo feed, 2026-07-14).
    const { error } = await serviceClient.from('companies').insert({
      id,
      org_id: orgId,
      name: canonical.name ?? canonical.erp_supplier_name ?? null,
      type: canonical.type ?? (kind === 'supplier' ? 'Vendor' : 'Client'),
      erp_party_type: (canonical.erp_party_type as string | null | undefined) ?? null,
      erp_supplier_name: (canonical.erp_supplier_name as string | null | undefined) ?? null,
      erp_customer_name: (canonical.erp_customer_name as string | null | undefined) ?? null,
      erp_tax_id: (canonical.erp_tax_id as string | null | undefined) ?? null,
      erp_payment_terms_days: (canonical.erp_payment_terms_days as number | null | undefined) ?? null,
      erp_docstatus: (canonical.erp_docstatus as number | null | undefined) ?? null,
      erp_modified: new Date(sourceModMs).toISOString(),
    });
    if (error) throw new AppError(error.message, error.code);
    return;
  }
  // P3b — the Timesheets domain (ADR-0059 Posture B). Two SIBLING kinds, opposite adopt rules:
  //   • `employee` — a MASTER (ADR-0059 §5's exception): adopts exactly like Supplier/Customer above —
  //     the SAME shipped party-adopt path, no new adopt function, no new engine.
  //   • `timesheet` — a PROCESS document (FR-TSP-082): the DELIBERATE INVERSE of P3a's Sales Invoice
  //     adopt. PMO is SoT for entry AND approval here, so minting a PMO row from a natively-created ERP
  //     Timesheet would import HOURS THAT NEVER PASSED PMO APPROVAL — exactly what the owner's ruling
  //     forbids. So: mint NOTHING (no `timesheets` row, no `timesheet_entries`, no
  //     `timesheet_erp_mirror` row — this function returns before any insert), surface
  //     action-required, and throw a classified error so the caller (webhook/sweep) neither silently
  //     drops nor treats this as a landed adopt. (This also removes the Luna BLOCK-7 "inbound adoption
  //     loses links" class by deleting the adopt path entirely for this kind.)
  if (domain === 'timesheets') {
    if (kind === 'employee') {
      // Mint the FULL canonical + the erp_modified stamp — never a half-empty name-only row (the exact
      // party-adopt bug found live 2026-07-14: a half-empty adopted row never engages the per-row
      // staleness guard because erp_modified was NULL). link_state is NEVER auto-confirmed (FR-TSP-092)
      // — only a Human `confirm_erp_employee_link` (0148) authorizes a push.
      const { error } = await serviceClient.from('erp_employees').insert({
        id,
        org_id: orgId,
        employee_number: (canonical.employee_number as string | null | undefined) ?? canonical.id,
        employee_name: (canonical.employee_name as string | null | undefined) ?? null,
        work_email: (canonical.work_email as string | null | undefined) ?? null,
        erp_user_id: (canonical.erp_user_id as string | null | undefined) ?? null,
        erp_status: (canonical.erp_status as string | null | undefined) ?? null,
        link_state: 'unlinked',
        erp_docstatus: (canonical.erp_docstatus as number | null | undefined) ?? null,
        erp_modified: new Date(sourceModMs).toISOString(),
      });
      if (error) throw new AppError(error.message, error.code);
      // OQ-TSP-10(C): PROPOSE only, on a unique exact case-insensitive work-email match. Zero/multiple
      // hits stay 'unlinked' + surface action-required (the party-adopt ambiguous-match precedent:
      // SURFACE, never auto-resolve). A proposal does NOT authorize a push — only a confirm does.
      await proposeEmployeeLink(serviceClient, orgId, id, (canonical.work_email as string | null | undefined) ?? null);
      return;
    }
    if (kind === 'timesheet') {
      await surfaceActionRequired(serviceClient, orgId, 'timesheet-native-not-adopted', {
        erpName: String(canonical.id ?? ''),
      });
      // ⚑ LOW-2 (audit round 5): the reason is carried as the error CODE, not as prose in the message.
      // `terminalApplyReason` (feedErrorPolicy.ts) decides an HTTP 200 ACK at the webhook ingress, and an
      // acked inbound event is dropped FOR GOOD — so the classification must read a deliberate signal.
      throw new AppError(
        `native ERPNext Timesheet "${String(canonical.id ?? '')}" is not adopted — PMO owns timesheet entry AND approval (FR-TSP-082)`,
        'native-timesheet-not-adopted',
      );
    }
  }
  // P3c FR-BUD-140 (⚑ never adopt — ADR-0059 §5) — a `Budget` doc with no `external_refs` mapping was
  // created directly in the Desk. PMO is the SoT for the budget figure (OD-BUDGET-1): adopting it would
  // mint a version that never passed PMO's activation authority — the DELIBERATE INVERSE of P3a's
  // revenue adopt rule (FR-SAR-085), not a variant of it. Mint NOTHING (no `budget_versions` row, no
  // `budget_line_items` row, no `budget_version_erp_mirror` row — this function returns before any
  // insert), surface action-required, and throw a classified error so the caller (webhook/sweep)
  // neither silently drops the event nor treats it as a landed adopt.
  if (domain === 'budget') {
    await surfaceActionRequired(serviceClient, orgId, 'budget-native-not-adopted', {
      erpName: String(canonical.id ?? ''),
    });
    // ⚑ LOW-2 (audit round 5) — the reason is the CODE (see the timesheet twin above).
    throw new AppError(
      `native ERPNext Budget "${String(canonical.id ?? '')}" is not adopted — PMO is the SoT for the budget figure (FR-BUD-140)`,
      'native-budget-not-adopted',
    );
  }
  // #775 phase B (FR-EXP-113, DD-EXP-19) — never adopt. An unmapped Journal Entry / Employee Payment Entry was not
  // posted by PMO (payroll, a manual entry): mint nothing, raise no notice (these are normal ERP activity), and
  // throw the classified terminal code so the feed acks and moves on.
  if (domain === 'expenses') {
    throw new AppError(
      `native ERPNext document "${String(canonical.id ?? '')}" is not adopted — PMO posts expense entries itself (FR-EXP-113)`,
      'native-expense-posting-not-adopted',
    );
  }
  // Revenue domain inbound adopt (sales-invoice / incoming-payment) — mint the FULL canonical
  // row + erp_modified stamp (the 0103 lesson: NOT just name/status). Resolve customer_id from
  // external_refs (companies domain). For incoming-payment, also resolve sales_invoice_id.
  // A project-less inbound SI mints with project_id=null (the 'Unassigned' bucket) AND raises the
  // Finance action-required notification (Luna BLOCK 13, FR-SAR-085 — no new table).
  if (domain === 'revenue') {
    const erpModifiedIso = new Date(sourceModMs).toISOString();
    // Keep an absent docstatus as NULL rather than defaulting to 0: a payload that never stated the
    // lifecycle must not have a "draft" claim invented for it. Defaulting to 0 minted a FALSE mirror
    // (erp_docstatus=0 for an invoice ERP has actually submitted) and, with the revenue allow-list,
    // permanently excluded that invoice's money. NULL is honest — the sweep repairs it on a tick
    // carrying the real docstatus.
    const docstatus = (canonical.erp_docstatus as number | null | undefined) ?? null;
    const erpOutstanding = (canonical as { erp_outstanding_amount?: string | number | null }).erp_outstanding_amount;
    const customerId = await resolveCustomerId(serviceClient, orgId, canonical);
    if (kind === 'sales-invoice') {
      const projectId = await resolveInvoiceProject(serviceClient, orgId, canonical.erp_project);
      const { error } = await serviceClient.from('sales_invoices').insert({
        id,
        org_id: orgId,
        project_id: projectId,
        erp_project: canonical.erp_project ?? null,
        customer_id: customerId,
        si_number: canonical.si_number ?? canonical.id,
        reference_number: (canonical as { reference_number?: string | null }).reference_number ?? null,
        invoice_date: (canonical as { invoice_date?: string | null }).invoice_date ?? null,
        amount: (canonical as { amount?: string | number | null }).amount ?? null,
        erp_outstanding_amount: erpOutstanding ?? null,
        // #478 (0187/0188). `amount` above is ERPNext's `grand_total`, which includes taxes by
        // definition, so 'inclusive' is a fact about the figure being written, not a guess.
        // `tax_amount` is NOT NULL with no DB default: ERPNext states `total_taxes_and_charges` on
        // every Sales Invoice (0 when untaxed) and siFromDoc maps it, so '0.00' here is the untaxed
        // document, never "unknown". `currency` and `tax_template` are omitted when absent —
        // `currency` is NOT NULL and its BEFORE-INSERT trigger fills it from the org's
        // default_currency, which v1 pins to the ERPNext company currency at Connect (DD-OPS-3).
        tax_treatment: 'inclusive',
        tax_amount: (canonical as { tax_amount?: string | number | null }).tax_amount ?? '0.00',
        ...((canonical as { currency?: string | null }).currency
          ? { currency: (canonical as { currency?: string | null }).currency }
          : {}),
        ...((canonical as { tax_template?: string | null }).tax_template
          ? { tax_template: (canonical as { tax_template?: string | null }).tax_template }
          : {}),
        status: deriveSiStatus(erpOutstanding == null ? null : String(erpOutstanding), docstatus),
        erp_docstatus: docstatus,
        erp_modified: erpModifiedIso,
        erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
        erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
      });
      if (error) throw new AppError(error.message, error.code);
      // Luna BLOCK 13: an inbound SI PMO could not attribute to a project lands in the 'Unassigned'
      // revenue bucket. Without an explicit prompt nobody is ever asked to assign it — so raise the
      // action-required notification on the EXISTING `notifications` surface (0048). Best-effort:
      // the invoice itself is already adopted and must never be lost to a notification failure.
      if (projectId === null) await notifyFinanceUnassignedInvoice(serviceClient, orgId, {
        salesInvoiceId: id,
        siNumber: String(canonical.si_number ?? canonical.id ?? ''),
        amount: (canonical as { amount?: string | number | null }).amount ?? null,
      });
      return;
    }
    if (kind === 'incoming-payment') {
      const salesInvoiceId = await resolveSalesInvoiceId(serviceClient, orgId, canonical);
      const { error } = await serviceClient.from('incoming_payments').insert({
        ...(canonical.received_amount !== undefined ? { received_amount: canonical.received_amount } : {}),
        ...(canonical.withheld_amount !== undefined ? { withheld_amount: canonical.withheld_amount } : {}),
        ...(canonical.withholding_slip_number !== undefined ? { withholding_slip_number: canonical.withholding_slip_number } : {}),
        ...(await allocationDetailsPatch(serviceClient, orgId, canonical)),
        id,
        org_id: orgId,
        customer_id: customerId,
        sales_invoice_id: salesInvoiceId, // nullable (on-account receipt)
        ip_number: canonical.ip_number ?? canonical.id,
        reference_number: (canonical as { reference_number?: string | null }).reference_number ?? null,
        date: (canonical as { date?: string | null }).date ?? null,
        amount: (canonical as { amount?: string | number | null }).amount ?? null,
        status: deriveIpStatus(docstatus), // ONE derivation, shared with the update/cancel paths
        erp_docstatus: docstatus,
        erp_modified: erpModifiedIso,
        erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
        erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
      });
      if (error) throw new AppError(error.message, error.code);
      await surfaceWithholdingReview(serviceClient, orgId, canonical);
      return;
    }
  }
  // Procurement inbound adopt requires the PMO procurement-case link the dispatch path owns — the
  // ERP doc does not carry it. Surface a classified error; the fn logs + ack's (lossy hint).
  throw new AppError(
    `procurement inbound adopt of "${canonical.id}" requires a PMO case link — dispatch-owned (the sweep re-surfaces it)`,
    'procurement-inbound-adopt-no-case-link',
  );
}

/** The inbound feed's lifecycle/status patch for a normal upsert, after its per-row source-mod
 *  guard. Amend-convergence writes use a separate path and are not covered by that guard.
 *  Customer/Supplier legal names are ERP-owned on this path; all other PMO-owned company columns
 *  stay untouched. */
export function mirrorStatusPatch(kind: ErpDocKind, canonical: PmoRecord, sourceModMs: number): Record<string, unknown> {
  if (kind === 'contact') return {full_name: canonical.full_name, email: canonical.email ?? null, phone: canonical.phone ?? null, company_id: canonical.company_id, erp_modified: new Date(sourceModMs).toISOString()};
  const partyNameField = kind === 'customer' ? 'erp_customer_name' : kind === 'supplier' ? 'erp_supplier_name' : null;
  const patch: Record<string, unknown> = { erp_modified: new Date(sourceModMs).toISOString() };
  if (partyNameField) {
    const partyName = canonical[partyNameField];
    if (typeof partyName === 'string' && partyName.trim().length > 0) {
      patch.name = partyName;
      patch[partyNameField] = partyName;
    }
  }
  const docstatus = (canonical.erp_docstatus as number | null | undefined) ?? null;
  // erp_modified always advances. The lifecycle columns follow putIfPresent discipline: a partial
  // webhook that omits docstatus must not clear a real erp_docstatus, nor wipe a genuine
  // erp_cancelled_at stamp back to null. Only a payload that actually carries docstatus writes them,
  // and only docstatus===2 stamps the cancellation time.
  putIfPresent(patch, 'erp_amended_from', (canonical.erp_amended_from as string | null | undefined));
  if (docstatus != null) {
    patch.erp_docstatus = docstatus;
    // Round-5 finding 6: docstatus 2 is TERMINAL in ERPNext (a cancelled doc is never un-cancelled —
    // it is amended into a NEW document instead). So a change that authoritatively states a non-2
    // docstatus describes a live document, and any `erp_cancelled_at` on that row belongs to a
    // superseded predecessor: on a native amend the successor is repointed onto the SAME mirror row
    // the predecessor's cancel had already tombstoned. Clear it so the row's lifecycle matches the
    // document it now mirrors. Absent docstatus ⇒ untouched (the putIfPresent discipline).
    //
    // ⚑ MEDIUM-G — EXCEPT for the PMO-SoT (Posture-B) kinds. There the tombstone is not just a
    // lifecycle mirror: it is the sweep backstop's candidate-query EXCLUSION, and `budgetBackstop.ts`
    // states the invariant as "the tombstone excludes the row from the candidate list FOREVER". The
    // accountant's standard correction after cancelling a PMO-pushed Budget is to AMEND it into
    // BUDGET-001-1 — `applyFeed`'s amend branch repoints external_refs onto the SAME mirror row and
    // then calls `updateMirror`, whose non-2 docstatus cleared the stamp. The row (still
    // `push_state='failed'`) then became a permanent backstop candidate, re-dispatched every cron tick
    // against the very document the operator had just authored: exactly the fight FR-BUD-142 /
    // FR-TSP-084 forbid. `erp_cancelled_at` on these two kinds is cleared by ONE writer only — a fresh
    // PMO push (`readModelWriters.ts`).
    if (!isPmoSoTKind(kind)) {
      patch.erp_cancelled_at = docstatus === 2 ? new Date().toISOString() : null;
    } else if (docstatus === 2) {
      patch.erp_cancelled_at = new Date().toISOString();
    }
  }
  return patch;
}

/** The derived-status columns a CANCEL (docstatus 2) must also write, per kind (Luna BLOCK 8). Revenue
 *  rollups key on `status <> 'Cancelled'` (db/revenue.ts) — stamping only `erp_*` left a cancelled
 *  invoice counted in project revenue and open AR. Non-revenue kinds keep their existing behavior. */
export function cancelStatusPatch(kind: ErpDocKind): Record<string, unknown> {
  if (kind === 'sales-invoice') return { status: deriveSiStatus(null, 2) };
  if (kind === 'incoming-payment') return { status: deriveIpStatus(2) };
  // P3b FR-TSP-084 — desk cancel REOPENS the push state to 'failed' + action-required (surfaced by the
  // caller, `tombstoneMirror`, right after this patch lands). Do NOT re-push here: the sweep backstop
  // would instantly re-create what a human just cancelled — an infinite fight between the backstop and
  // the accountant. `erp_cancelled_at` (set by the caller alongside this patch) is ALSO the sweep's
  // candidate-query exclusion (task 6.4). The PMO `timesheets` row itself is UNTOUCHED here — still
  // Approved; PMO's approval is not ERP's to revoke (FR-TSP-004(ii)). Resolution is the OQ-TSP-6
  // correction path (OPEN).
  if (kind === 'timesheet') return { push_state: 'failed' };
  // P3c FR-BUD-142 (⚑ never fight the operator) — the SAME reopen, for the SAME reason: a re-push here
  // would instantly re-create the ERP object a human just cancelled. `budget_versions` is UNTOUCHED —
  // PMO's version stays Active; PMO's budget is not ERP's to revoke. `erp_cancelled_at` (set by the
  // caller alongside this patch) is ALSO `reconcileOrgBudgetPushes`'s candidate-query exclusion.
  if (kind === 'budget') return { push_state: 'failed' };
  return {};
}

/** The ADR-0059 Posture-B kinds: PMO is the source of truth and the ERP object is a projection of it.
 *  Their mirror's `erp_cancelled_at` is a never-fight-the-operator TOMBSTONE (the sweep backstop's
 *  candidate exclusion), not merely a lifecycle mirror — see `mirrorStatusPatch` (MEDIUM-G). */
function isPmoSoTKind(kind: ErpDocKind): boolean {
  return kind === 'timesheet' || kind === 'budget' || KIND_DOMAIN[kind] === 'expenses';
}
