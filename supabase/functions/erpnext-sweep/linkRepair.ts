// The sweep's late-link repairs (THEME-BACK-40, #1643): an ERP-sourced receipt re-linked to the Sales Invoice it cites
// once that invoice is adopted, and an ERP-sourced Sales Invoice filled with its PMO project. Moved verbatim from index.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildAllocationDetails, salesInvoiceLookup } from '../_shared/receiptAllocations.ts';
import { resolveInvoiceProjects } from '../_shared/projectInvoiceAttribution.ts';
import { DOCTYPE_REGISTRY } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import { DOCTYPE_BODIES } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts';
import { allocationsOf } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/incomingPayment.ts';
import type { ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import type { ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { admitsDocForBindingCompany } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/companyScope.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { type OrgBinding, fetchErpDoc, erpClientForBinding } from './sweepShared.ts';

// ────────────────────────────────────────────────────────────────────────────────────────────────
// The late-link self-heal (Luna BLOCK 6). A Receive Payment Entry adopted BEFORE the Sales Invoice it
// cites resolves `sales_invoice_id` to NULL — and its own ERP row does not change when that invoice is
// later adopted, so the modified-poll never re-surfaces it and the payment stays attached to no
// invoice forever. This pass re-checks the org's unlinked ERP-sourced receipts each tick.
// ────────────────────────────────────────────────────────────────────────────────────────────────

export interface RepairUnlinkedReceiptsDeps {
  /** The org's ERP-sourced receipts still missing their invoice link (bounded per tick). */
  listUnlinkedReceipts: () => Promise<Array<{ id: string; erpName: string | null }>>;
  /** Stamp every attempt so failures cannot monopolise the bounded scan. */
  stampAllocationCheck?: (id: string) => Promise<void>;
  /** Re-read one Payment Entry in full (its `references` child rows are not list-endpoint fields). */
  fetchDoc: (erpName: string) => Promise<Record<string, unknown>>;
  /** The PMO id the cited Sales Invoice ERP name now maps to, or `null` if still unmapped. */
  resolveSalesInvoicePmoId: (siErpName: string) => Promise<string | null>;
  /** Write the repaired link. */
  link: (ipId: string, salesInvoicePmoId: string) => Promise<void>;
  /** S-06: re-mirror the receipt's invoice allocations (the ERP document's `references`, normalised). Called only when the
   *  document states them — a missing table is unknown coverage and writes nothing. */
  mirrorAllocations?: (ipId: string, allocations: NonNullable<ReturnType<typeof allocationsOf>>) => Promise<void>;
}

/**
 * Link every unlinked receipt whose cited invoice has since been adopted. A receipt with no
 * `references` is a genuine on-account payment and is left alone; a receipt whose invoice is still
 * unmapped is left alone too (a guessed link is a WRONG money attribution — it retries next tick). One
 * unreadable doc is recorded and skipped, never aborting the pass. Exported for direct unit testing.
 */
export async function repairUnlinkedReceipts(
  deps: RepairUnlinkedReceiptsDeps,
): Promise<{ repaired: number; errors: Array<{ id: string; error: string }> }> {
  const unlinked = await deps.listUnlinkedReceipts();
  let repaired = 0;
  const errors: Array<{ id: string; error: string }> = [];
  for (const receipt of unlinked) {
    try {
      if (!receipt.erpName) continue;
      const doc = await deps.fetchDoc(receipt.erpName);
      const allocations = allocationsOf(doc.references);
      if (allocations !== undefined) await deps.mirrorAllocations?.(receipt.id, allocations);
      // The legacy single link selects the first mapped Sales Invoice in ERP order; the
      // complete allocation list remains in allocation_details.
      for (const allocation of allocations ?? []) {
        const salesInvoicePmoId = await deps.resolveSalesInvoicePmoId(allocation.reference_name);
        if (salesInvoicePmoId) {
          await deps.link(receipt.id, salesInvoicePmoId);
          repaired += 1;
          break;
        }
      }
    } catch (err) {
      errors.push({ id: receipt.id, error: err instanceof Error ? err.message : String(err) });
    } finally {
      try {
        await deps.stampAllocationCheck?.(receipt.id);
      } catch (err) {
        errors.push({ id: receipt.id, error: `stamp allocation check: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }
  return { repaired, errors };
}

/** The per-tick scan bound for the late-link repair: an org with many genuine on-account receipts must
 *  not turn the pass into an unbounded per-tick ERP read (NFR-ENA-PERF-001, interactive over bulk). */
const UNLINKED_RECEIPT_SCAN_LIMIT = 100;

/** The live wiring of the late-link self-heal for one org. Runs ONLY for an org that owns the revenue
 *  domain (Luna BLOCK 9) — a procurement-only org has no receipts to repair. */
export async function repairInvoiceProjectsLive(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  afterId: string | null,
  cache?: ErpAuthPairCache,
): Promise<{ scanned: number; repaired: number; unresolved: number; failedIds: string[]; nextCursor: string | null; done: boolean }> {
  if (!org.ownedDomains.includes('revenue')) {
    return { scanned: 0, repaired: 0, unresolved: 0, failedIds: [], nextCursor: afterId, done: true };
  }
  const candidateQuery = serviceClient.from('sales_invoices').select('id,si_number,erp_project,erp_modified')
    .eq('org_id', org.orgId).is('project_id', null).eq('pmo_native', false)
    .not('si_number', 'is', null).order('id', { ascending: true }).limit(100);
  const candidateResult = await (afterId ? candidateQuery.gt('id', afterId) : candidateQuery) as unknown as {
    data: Array<{ id: string; si_number: string | null; erp_project: string | null; erp_modified: string | null }> | null;
    error: { message: string; code?: string } | null;
  };
  const { data, error } = candidateResult;
  if (error) throw new AppError(error.message, error.code);
  const rows = data ?? [];
  if (rows.length === 0) {
    return { scanned: 0, repaired: 0, unresolved: 0, failedIds: [], nextCursor: afterId, done: true };
  }
  const refsResult = await serviceClient.from('external_refs').select('pmo_record_id,external_record_id')
    .eq('org_id', org.orgId).eq('domain', 'revenue').in('pmo_record_id', rows.map((row) => row.id)) as unknown as {
      data: Array<{ pmo_record_id: string; external_record_id: string }> | null;
      error: { message: string; code?: string } | null;
    };
  if (refsResult.error) throw new AppError(refsResult.error.message, refsResult.error.code);
  const refs = new Map((refsResult.data ?? []).map((ref) => [ref.pmo_record_id, ref.external_record_id]));
  let erpClient: ErpClientDeps | null = null;
  const getErpClient = async () => erpClient ??= await erpClientForBinding(serviceClient, org, cache);
  const sources: Array<{ row: (typeof rows)[number]; erpProject: string }> = [];
  const failedIds: string[] = [];
  let processed = 0;
  let fetched = 0;
  let unresolved = 0;
  for (const row of rows) {
    if (row.erp_project !== null) {
      sources.push({ row, erpProject: row.erp_project });
      processed++;
      continue;
    }
    const erpName = refs.get(row.id);
    if (!erpName || erpName !== row.si_number) {
      unresolved++;
      processed++;
      continue;
    }
    if (fetched >= 10) break;
    fetched++;
    try {
      const doc = await fetchErpDoc(await getErpClient(), DOCTYPE_REGISTRY['sales-invoice'].doctype, erpName);
      if (doc.name !== erpName || !admitsDocForBindingCompany('sales-invoice', doc, org.company)) {
        unresolved++;
        processed++;
        continue;
      }
      const canonical = DOCTYPE_BODIES['sales-invoice']!.fromDoc(doc);
      const erpProject = typeof canonical.erp_project === 'string' ? canonical.erp_project : null;
      if (erpProject !== null) {
        let hydration = serviceClient.from('sales_invoices').update({ erp_project: erpProject })
          .eq('org_id', org.orgId).eq('id', row.id).is('project_id', null).is('erp_project', null);
        hydration = row.erp_modified === null
          ? hydration.is('erp_modified', null)
          : hydration.eq('erp_modified', row.erp_modified);
        const { data: hydrated, error: hydrationError } = await hydration.select('id') as unknown as {
          data: Array<{ id: string }> | null; error: { message: string; code?: string } | null;
        };
        if (hydrationError) throw new AppError(hydrationError.message, hydrationError.code);
        if (!hydrated?.some((entry) => entry.id === row.id)) {
          unresolved++;
          processed++;
          continue;
        }
        sources.push({ row, erpProject });
      } else {
        unresolved++;
      }
      processed++;
    } catch {
      failedIds.push(row.id);
      break;
    }
  }
  let repaired = 0;
  try {
    const resolution = await resolveInvoiceProjects(serviceClient, org.orgId, sources.map((source) => source.erpProject));
    for (const source of sources) {
      const projectId = resolution.get(source.erpProject);
      if (!projectId) { unresolved++; continue; }
      const { data: filled, error: fillError } = await serviceClient.rpc('fill_sales_invoice_project', {
        p_org_id: org.orgId, p_si_id: source.row.id, p_project_id: projectId, p_erp_project: source.erpProject,
      });
      if (fillError) throw new AppError(fillError.message, fillError.code);
      if (filled === true) repaired++;
      else unresolved++;
    }
  } catch (err) {
    // A persistent fill error is retried next tick; log it so a systematic DB failure is visible.
    console.error('invoice project backfill fill failed', { orgId: org.orgId, error: err instanceof Error ? err.message : String(err) });
    failedIds.push(...sources.map((source) => source.row.id));
  }
  const failed = failedIds.length > 0;
  const capped = fetched >= 10 && processed < rows.length && !failed;
  return {
    scanned: rows.length, repaired, unresolved, failedIds: [...new Set(failedIds)],
    nextCursor: failed ? afterId : capped ? rows[processed - 1]?.id ?? afterId : rows.at(-1)?.id ?? afterId,
    done: !failed && !capped && rows.length < 100,
  };
}

export async function listReceiptRepairCandidates(serviceClient: SupabaseClient, orgId: string): Promise<Array<{ id: string; erpName: string | null }>> {
  // S-06: also receipts whose allocations were never mirrored, or cite an invoice PMO had not adopted then.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const base = () => serviceClient.from('incoming_payments')
    .select('id,allocation_checked_at').eq('org_id', orgId).not('erp_docstatus', 'is', null)
    .or(`allocation_checked_at.is.null,allocation_checked_at.lte.${cutoff}`)
    .order('allocation_checked_at', { ascending: true, nullsFirst: true })
    .limit(UNLINKED_RECEIPT_SCAN_LIMIT);
  const [unlinked, unmirrored, unresolved] = await Promise.all([
    base().is('sales_invoice_id', null),
    base().is('allocation_details', null),
    base().filter('allocation_details', 'cs', '[{"invoice_id":null}]'),
  ]);
  const failed = [unlinked, unmirrored, unresolved].find((r) => r.error);
  if (failed?.error) throw new AppError(failed.error.message, failed.error.code);
  const rows = [...new Map([unlinked, unmirrored, unresolved]
    .flatMap((r) => (r.data as Array<{ id: string; allocation_checked_at: string | null }> | null) ?? []).map((r) => [r.id, r])).values()]
    .sort((a, b) => (a.allocation_checked_at ?? '').localeCompare(b.allocation_checked_at ?? ''))
    .slice(0, UNLINKED_RECEIPT_SCAN_LIMIT);
  if (rows.length === 0) return [];
  // The ERP name lives on external_refs (the mirror row carries no ERP name column).
  const { data: refs, error: refErr } = await serviceClient.from('external_refs')
    .select('pmo_record_id, external_record_id').eq('org_id', orgId).eq('domain', 'revenue')
    .in('pmo_record_id', rows.map((r) => r.id));
  if (refErr) throw new AppError(refErr.message, refErr.code);
  const byId = new Map(((refs as Array<{ pmo_record_id: string; external_record_id: string }> | null) ?? [])
    .map((r) => [r.pmo_record_id, r.external_record_id]));
  return rows.map((row) => ({ id: row.id, erpName: byId.get(row.id) ?? null }));
}

export async function resolveReceiptSalesInvoice(serviceClient: SupabaseClient, orgId: string, siErpName: string): Promise<string | null> {
  return (await salesInvoiceLookup(serviceClient, orgId)(siErpName))?.id ?? null;
}

export async function repairOrgLinksLive(serviceClient: SupabaseClient, org: OrgBinding, cache?: ErpAuthPairCache): Promise<{ repaired: number; error?: string }> {
  if (!org.ownedDomains.includes('revenue')) return { repaired: 0 };
  try {
    const client = await erpClientForBinding(serviceClient, org, cache);
    const result = await repairUnlinkedReceipts({
      listUnlinkedReceipts: () => listReceiptRepairCandidates(serviceClient, org.orgId),
      stampAllocationCheck: async (ipId) => {
        const { error } = await (serviceClient.from('incoming_payments').update({ allocation_checked_at: new Date().toISOString() })
          .eq('org_id', org.orgId).eq('id', ipId) as unknown as Promise<{ error: { message: string; code?: string } | null }>);
        if (error) throw new AppError(error.message, error.code);
      },
      fetchDoc: (erpName) => fetchErpDoc(client, DOCTYPE_REGISTRY['incoming-payment'].doctype, erpName),
      resolveSalesInvoicePmoId: (siErpName) => resolveReceiptSalesInvoice(serviceClient, org.orgId, siErpName),
      mirrorAllocations: async (ipId, allocations) => {
        const details = await buildAllocationDetails(allocations, salesInvoiceLookup(serviceClient, org.orgId));
        const { error } = await (serviceClient.from('incoming_payments').update({ allocation_details: details })
          .eq('org_id', org.orgId).eq('id', ipId) as unknown as Promise<{ error: { message: string; code?: string } | null }>);
        if (error) throw new AppError(error.message, error.code);
      },
      link: async (ipId, salesInvoicePmoId) => {
        const { error } = await (serviceClient.from('incoming_payments').update({ sales_invoice_id: salesInvoicePmoId })
          .eq('org_id', org.orgId).eq('id', ipId) as unknown as Promise<{ error: { message: string; code?: string } | null }>);
        if (error) throw new AppError(error.message, error.code);
      },
    });
    const first = result.errors[0];
    return { repaired: result.repaired, ...(first ? { error: `${first.id}:${first.error}` } : {}) };
  } catch (err) {
    return { repaired: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
