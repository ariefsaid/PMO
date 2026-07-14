/**
 * erpnextFeedDeps — SHARED edge-fn wiring for the ERPNext inbound feed apply deps (task 8.2/8.6).
 * Builds the `ErpFeedDeps` (ApplyChangeDeps + LineageDeps + SupersededNameLookupDeps) that
 * `erpnext/applyFeed.applyErpFeedEvent` consumes, for ONE (org, kind) pair. The webhook (8.2) and the
 * sweep (8.6) both call this after decoding an event's kind.
 *
 * EDGE-FN WIRING (depends on the real supabase-js client + does DB writes), NOT pure logic — lives in
 * `_shared/`, not the pure `erpnext/**` lib (confinement: this file carries no Frappe doctype/field
 * vocabulary, only PMO-shaped records + the `erp_*` mirror columns). Deno-only (imported by edge fns);
 * relative imports resolve via each fn's deno.json import map.
 *
 * Scope (slice 8 — the change-feed infrastructure): the feed's PRIMARY job is the lifecycle routing —
 * cancel (docstatus 2 → erp_cancelled_at + erp_docstatus=2), amend (repoint external_refs + stamp
 * erp_amended_from), superseded-name no-op, and status/erp_modified sync. These are written to the
 * per-kind mirror table's `erp_*` columns directly here. The full per-kind native-field re-sync from a
 * field-level desk edit (grand_total, outstanding, …) is owned by the dispatch read-model writers
 * (slices 3-6, `adapter-dispatch/readModelWriters.ts`) on the OUTBOUND commit; the inbound feed stamps
 * the lifecycle/status columns this slice. Inbound ADOPT (mint) is wired for parties (`companies` —
 * commonly created natively in ERP, OQ-4); procurement inbound adopt requires the PMO procurement-case
 * link the dispatch path owns, so it throws a classified error the fn logs + ack's (lossy hint,
 * FR-ENA-083) — the modified-poll sweep re-surfaces the row on the next tick.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { findPmoRecordId, recordExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { KIND_DOMAIN, KIND_MIRROR_TABLE, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import { deriveSiStatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/siStatus.ts';
import type { ErpFeedDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/applyFeed.ts';
import type { LineageRow } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/lineage.ts';
import type { PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

export { ERPNEXT_TIER };

/** Build the inbound feed apply deps for one (org, kind). `kind` decides the mirror table + domain. */
export function createErpFeedDeps(serviceClient: SupabaseClient, orgId: string, kind: ErpDocKind): ErpFeedDeps {
  const domain = KIND_DOMAIN[kind];
  const table = KIND_MIRROR_TABLE[kind];

  return {
    // ── ApplyChangeDeps ──
    resolvePmoRecordId: (externalRecordId) => findPmoRecordId(serviceClient as never, orgId, domain, externalRecordId),
    readMirrorSourceMod: async (pmoRecordId) => {
      const { data, error } = await serviceClient.from(table).select('erp_modified').eq('org_id', orgId).eq('id', pmoRecordId).maybeSingle();
      if (error) throw new AppError(error.message, error.code);
      const modified = (data as { erp_modified?: string | null } | null)?.erp_modified ?? null;
      return modified ? Date.parse(modified) : null;
    },
    updateMirror: async (pmoRecordId, canonical, sourceModMs) => {
      // Stamp the lifecycle/status `erp_*` columns the feed owns; the native-field re-sync is the
      // dispatch read-model writer's job on the outbound commit (see module docstring).
      const patch = mirrorStatusPatch(canonical, sourceModMs);
      const { error } = await (serviceClient.from(table).update(patch).eq('org_id', orgId).eq('id', pmoRecordId) as unknown as Promise<{
        error: { message: string; code?: string } | null;
      }>);
      if (error) throw new AppError(error.message, error.code);
    },
    mintMirror: async (canonical, sourceModMs) => {
      if (domain === 'companies') {
        // Party adopt (Supplier/Customer created natively in ERP — OQ-4): mint the FULL companies
        // mirror row + the source-mod stamp. Writing only name/type here (the original slice-8 cut)
        // silently dropped the party canonical (erp_supplier_name/tax_id/…) and left erp_modified
        // NULL — so the adopted row was half-empty and the per-row staleness guard never engaged
        // (found live arming the demo feed, 2026-07-14).
        const id = crypto.randomUUID();
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
        return id;
      }
      // Revenue domain inbound adopt (sales-invoice / incoming-payment) — mint the FULL canonical
      // row + erp_modified stamp (the 0103 lesson: NOT just name/status). Resolve customer_id from
      // external_refs (companies domain). For incoming-payment, also resolve sales_invoice_id.
      // A project-less inbound SI mints with project_id=null (the 'Unassigned' bucket + Finance
      // notification via existing path, FR-SAR-085 — no new table).
      if (domain === 'revenue') {
        const id = crypto.randomUUID();
        const erpModifiedIso = new Date(sourceModMs).toISOString();
        const docstatus = (canonical.erp_docstatus as number | null | undefined) ?? 0;
        const erpOutstanding = (canonical as { erp_outstanding_amount?: string | number | null }).erp_outstanding_amount;
        // Resolve customer_id from external_refs (Customer:<erp_customer_name>)
        // The canonical from siFromDoc/peReceiveFromDoc carries the ERP customer name in 'customer'.
        let customerId: string | null = null;
        const customerErpName = (canonical as { customer?: string | null }).customer;
        if (customerErpName) {
          const { data: ref } = await serviceClient.from('external_refs').select('pmo_record_id')
            .eq('org_id', orgId).eq('domain', 'companies').eq('external_record_id', `Customer:${customerErpName}`).maybeSingle();
          customerId = (ref as { pmo_record_id?: string } | null)?.pmo_record_id ?? null;
        }
        if (kind === 'sales-invoice') {
          // Project-less SI → project_id = null (Unassigned bucket; Finance notification via existing path)
          const { error } = await serviceClient.from('sales_invoices').insert({
            id,
            org_id: orgId,
            project_id: null,
            customer_id: customerId,
            si_number: canonical.si_number ?? canonical.id,
            reference_number: (canonical as { reference_number?: string | null }).reference_number ?? null,
            invoice_date: (canonical as { invoice_date?: string | null }).invoice_date ?? null,
            amount: (canonical as { amount?: string | number | null }).amount ?? null,
            erp_outstanding_amount: erpOutstanding ?? null,
            status: deriveSiStatus(erpOutstanding == null ? null : String(erpOutstanding), docstatus),
            erp_docstatus: docstatus,
            erp_modified: erpModifiedIso,
            erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
            erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
          });
          if (error) throw new AppError(error.message, error.code);
          return id;
        }
        if (kind === 'incoming-payment') {
          // Resolve sales_invoice_id from PE references (first reference's reference_name)
          let salesInvoiceId: string | null = null;
          const references = (canonical as { references?: Array<{ reference_name?: string | null }> }).references;
          if (Array.isArray(references) && references.length > 0 && references[0].reference_name) {
            const siErpName = references[0].reference_name;
            const { data: ref } = await serviceClient.from('external_refs').select('pmo_record_id')
              .eq('org_id', orgId).eq('domain', 'revenue').eq('external_record_id', siErpName).maybeSingle();
            salesInvoiceId = (ref as { pmo_record_id?: string } | null)?.pmo_record_id ?? null;
          }
          const { error } = await serviceClient.from('incoming_payments').insert({
            id,
            org_id: orgId,
            customer_id: customerId,
            sales_invoice_id: salesInvoiceId, // nullable (on-account receipt)
            ip_number: canonical.ip_number ?? canonical.id,
            reference_number: (canonical as { reference_number?: string | null }).reference_number ?? null,
            date: (canonical as { date?: string | null }).date ?? null,
            amount: (canonical as { amount?: string | number | null }).amount ?? null,
            status: docstatus === 1 ? 'Paid' : 'Scheduled',
            erp_docstatus: docstatus,
            erp_modified: erpModifiedIso,
            erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
            erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
          });
          if (error) throw new AppError(error.message, error.code);
          return id;
        }
      }
      // Procurement inbound adopt requires the PMO procurement-case link the dispatch path owns — the
      // ERP doc does not carry it. Surface a classified error; the fn logs + ack's (lossy hint).
      throw new AppError(
        `procurement inbound adopt of "${canonical.id}" requires a PMO case link — dispatch-owned (the sweep re-surfaces it)`,
        'procurement-inbound-adopt-no-case-link',
      );
    },
    recordExternalRef: (mapping) => recordExternalRef(serviceClient as never, { orgId, ...mapping }),

    // ── LineageDeps ──
    tombstoneMirror: async (pmoRecordId, erpModified) => {
      const { error } = await (serviceClient.from(table).update({
        erp_cancelled_at: new Date().toISOString(),
        erp_docstatus: 2,
        erp_modified: erpModified,
      }).eq('org_id', orgId).eq('id', pmoRecordId) as unknown as Promise<{ error: { message: string; code?: string } | null }>);
      if (error) throw new AppError(error.message, error.code);
    },
    repointExternalRef: async (_domain, pmoRecordId, newExternalRecordId) => {
      // Guarded by `unique(org_id,domain,external_record_id)` (0093) — a concurrent duplicate repoint
      // fails atomically; the loser reconciles on re-run. external_refs is RETAINED on a plain cancel
      // (never repointed there — only an amend repoints).
      const { error } = await (serviceClient.from('external_refs').update({ external_record_id: newExternalRecordId })
        .eq('org_id', orgId).eq('domain', domain).eq('pmo_record_id', pmoRecordId) as unknown as Promise<{
          error: { message: string; code?: string } | null;
        }>);
      if (error) throw new AppError(error.message, error.code);
    },
    stampAmended: async (pmoRecordId, amendedFrom, erpModified) => {
      const { error } = await (serviceClient.from(table).update({
        erp_amended_from: amendedFrom,
        erp_modified: erpModified,
      }).eq('org_id', orgId).eq('id', pmoRecordId) as unknown as Promise<{ error: { message: string; code?: string } | null }>);
      if (error) throw new AppError(error.message, error.code);
    },
    recordLineage: async (row: LineageRow) => {
      const { error } = await serviceClient.from('external_ref_lineage').insert({
        org_id: orgId,
        domain: row.domain,
        pmo_record_id: row.pmoRecordId,
        superseded_external_record_id: row.supersededExternalRecordId,
        successor_external_record_id: row.successorExternalRecordId,
        reason: row.reason,
        erp_docstatus: row.erpDocstatus,
      });
      if (error) throw new AppError(error.message, error.code);
    },

    // ── SupersededNameLookupDeps ──
    findLineageBySupersededName: async (_domain, erpName) => {
      const { data, error } = await serviceClient.from('external_ref_lineage')
        .select('id').eq('org_id', orgId).eq('domain', domain).eq('superseded_external_record_id', erpName).limit(1);
      if (error) throw new AppError(error.message, error.code);
      return Array.isArray(data) && data.length > 0;
    },
  };
}

/** The `erp_*` lifecycle/status columns the inbound feed stamps on a normal upsert (the per-row
 *  source-mod guard already gated the write). Native ERP-derived fields synced by the dispatch
 *  read-model writer on the outbound commit are left untouched here. */
function mirrorStatusPatch(canonical: PmoRecord, sourceModMs: number): Record<string, unknown> {
  const docstatus = (canonical.erp_docstatus as number | null | undefined) ?? null;
  return {
    erp_modified: new Date(sourceModMs).toISOString(),
    erp_docstatus: docstatus,
    erp_amended_from: (canonical.erp_amended_from as string | null | undefined) ?? null,
    erp_cancelled_at: docstatus === 2 ? new Date().toISOString() : null,
  };
}

/** Derive the SI status from ERP docstatus + outstanding amount (mirrors siStatus.ts logic). */
