// S-06 (RF-030/031) — the shared receipt-allocation builder. Synthetic fixtures only.
// Verify: cd supabase/functions/_shared && deno test receiptAllocations.test.ts
import { buildAllocationDetails, type InvoiceLookup } from './receiptAllocations.ts';

function assertEquals(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${msg}\n actual:   ${JSON.stringify(actual)}\n expected: ${JSON.stringify(expected)}`);
}
const known: Record<string, { id: string; currency: string }> = { 'SINV-A': { id: 'pmo-a', currency: 'IDR' }, 'SINV-B': { id: 'pmo-b', currency: 'IDR' } };
const lookup: InvoiceLookup = async (name) => known[name] ?? null;

Deno.test('RF-030 a multi-invoice receipt keeps every allocation, resolved to the PMO invoice and its currency', async () => {
  assertEquals(await buildAllocationDetails([
    { reference_name: 'SINV-A', allocated_amount: '25000.00' },
    { reference_name: 'SINV-B', allocated_amount: '30000.00' },
  ], lookup), [
    { invoice_id: 'pmo-a', invoice_number: 'SINV-A', amount: '25000.00', currency: 'IDR' },
    { invoice_id: 'pmo-b', invoice_number: 'SINV-B', amount: '30000.00', currency: 'IDR' },
  ], 'both allocations resolved');
});

Deno.test('RF-030 an invoice PMO has not adopted yet keeps its ERP number, with no link and no currency (unknown, not guessed)', async () => {
  assertEquals(await buildAllocationDetails([{ reference_name: 'SINV-NEW', allocated_amount: '10.00' }], lookup),
    [{ invoice_id: null, invoice_number: 'SINV-NEW', amount: '10.00', currency: null }], 'unresolved invoice');
});

Deno.test('RF-030 an allocation amount the ERP did not state stays null — never "0.00"', async () => {
  assertEquals(await buildAllocationDetails([{ reference_name: 'SINV-A', allocated_amount: null }], lookup),
    [{ invoice_id: 'pmo-a', invoice_number: 'SINV-A', amount: null, currency: 'IDR' }], 'unknown amount');
});

Deno.test('RF-031 an on-account receipt (empty references) is a KNOWN empty list; absent references leave the column untouched', async () => {
  assertEquals(await buildAllocationDetails([], lookup), [], 'known none');
  assertEquals(await buildAllocationDetails(undefined, lookup), undefined, 'unknown coverage: do not write');
});

Deno.test('allocation lookup resolves only same-organization invoices and propagates read errors', async () => {
  const { salesInvoiceLookup, allocationDetailsPatch } = await import('./receiptAllocations.ts');
  let mode = 'other';
  const client = { from(table: string) {
    const filters: Record<string, string> = {};
    const q = { select: () => q, eq: (column: string, value: string) => { filters[column] = value; return q; },
      maybeSingle: async () => {
        if (mode === `${table}-error`) return { data: null, error: { message: 'read failed', code: 'XX000' } };
        if (table === 'external_refs') return { data: mode === 'missing' ? null : { pmo_record_id: 'record' }, error: null };
        return { data: mode === 'invoice' && filters.org_id === 'org-a' ? { id: 'record', currency: null } : null, error: null };
      } }; return q;
  } };
  const allocations = [{ reference_name: 'SI', allocated_amount: '10.00' }];
  assertEquals(await allocationDetailsPatch(client as never, 'org-a', {}), {}, 'missing source leaves column alone');
  assertEquals(await allocationDetailsPatch(client as never, 'org-a', { allocations: [] }), { allocation_details: [] }, 'empty source is known on-account');
  const resolve = salesInvoiceLookup(client as never, 'org-a');
  assertEquals(await buildAllocationDetails(allocations, resolve), [{ invoice_id: null, invoice_number: 'SI', amount: '10.00', currency: null }], 'non-invoice remains unresolved');
  mode = 'invoice';
  assertEquals(await resolve('SI'), { id: 'record', currency: null }, 'unknown currency retains invoice');
  assertEquals(await salesInvoiceLookup(client as never, 'org-b')('SI'), null, 'other organization remains unresolved');
  mode = 'missing';
  assertEquals(await resolve('SI'), null, 'absent mapping remains unresolved');
  for (mode of ['external_refs-error', 'sales_invoices-error']) {
    let failed = false;
    try { await allocationDetailsPatch(client as never, 'org-a', { allocations }); } catch (error) { failed = error instanceof Error && error.message.includes('read failed'); }
    assertEquals(failed, true, `${mode} propagates`);
  }
});
