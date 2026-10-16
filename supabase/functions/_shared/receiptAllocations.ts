/**
 * S-06 (RF-030/031) — the invoice allocations of a Receive Payment Entry, resolved for the `incoming_payments.allocation_details`
 * mirror. Pure (the invoice lookup is injected); shared by the inbound feed, the outbound read-model writer and the sweep repair.
 *
 * Coverage rules: `undefined` references = the source did not say → return `undefined` (the caller leaves the column alone);
 * an empty list is a KNOWN on-account receipt; an amount the ERP did not state stays null — unknown is never zero; an invoice
 * PMO has not adopted yet is kept by its ERP number with no link and no currency, never guessed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ErpAllocation { reference_name: string; allocated_amount: string | null }
export interface AllocationDetail { invoice_id: string | null; invoice_number: string; amount: string | null; currency: string | null }
export type InvoiceLookup = (erpName: string) => Promise<{ id: string; currency: string | null } | null>;

export async function buildAllocationDetails(
  allocations: ErpAllocation[] | undefined,
  lookup: InvoiceLookup,
): Promise<AllocationDetail[] | undefined> {
  if (!Array.isArray(allocations)) return undefined;
  const details: AllocationDetail[] = [];
  for (const a of allocations) {
    const invoice = await lookup(a.reference_name);
    details.push({ invoice_id: invoice?.id ?? null, invoice_number: a.reference_name, amount: a.allocated_amount, currency: invoice?.currency ?? null });
  }
  return details;
}

/** The org-scoped PMO Sales Invoice behind an ERP invoice name (external_refs → sales_invoices.currency). */
export function salesInvoiceLookup(serviceClient: SupabaseClient, orgId: string): InvoiceLookup {
  return async (erpName) => {
    const { data: ref } = await serviceClient.from('external_refs').select('pmo_record_id')
      .eq('org_id', orgId).eq('domain', 'revenue').eq('external_record_id', erpName).maybeSingle();
    const id = (ref as { pmo_record_id?: string } | null)?.pmo_record_id;
    if (!id) return null;
    const { data: inv } = await serviceClient.from('sales_invoices').select('currency').eq('org_id', orgId).eq('id', id).maybeSingle();
    return { id, currency: (inv as { currency?: string | null } | null)?.currency ?? null };
  };
}

/** Convenience for the writers: the mirror column for one canonical receipt, or `{}` when coverage is unknown. */
export async function allocationDetailsPatch(
  serviceClient: SupabaseClient,
  orgId: string,
  canonical: Record<string, unknown>,
): Promise<{ allocation_details?: AllocationDetail[] }> {
  const details = await buildAllocationDetails(canonical['allocations'] as ErpAllocation[] | undefined, salesInvoiceLookup(serviceClient, orgId));
  return details === undefined ? {} : { allocation_details: details };
}
