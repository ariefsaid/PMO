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
