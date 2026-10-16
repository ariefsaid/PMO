// Luna BLOCK 6 (second half) [Deno unit] — the late-link SELF-HEAL.
//
// A Receive Payment Entry adopted BEFORE the Sales Invoice it cites resolves `sales_invoice_id` to
// NULL. Nothing ever repaired it: the PE's own ERP row does not change when the invoice is later
// adopted, so the modified-poll never re-surfaces it, and the mirror stayed permanently unlinked (the
// payment shows against no invoice). This pass re-checks the org's unlinked ERP-sourced receipts each
// tick and links the ones whose invoice has since been mapped.
//
// Verify: cd supabase/functions/erpnext-sweep && deno test repairUnlinkedReceipts.test.ts

(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { repairUnlinkedReceipts } = await import('./index.ts');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function deps(config: {
  unlinked: Array<{ id: string; erpName: string }>;
  docs: Record<string, Record<string, unknown>>;
  mapped: Record<string, string>;
}) {
  const links: Array<{ ipId: string; siPmoId: string }> = [];
  const fetched: string[] = [];
  return {
    links,
    fetched,
    listUnlinkedReceipts: async () => config.unlinked,
    fetchDoc: async (name: string) => { fetched.push(name); return config.docs[name] ?? {}; },
    resolveSalesInvoicePmoId: async (siErpName: string) => config.mapped[siErpName] ?? null,
    link: async (ipId: string, siPmoId: string) => { links.push({ ipId, siPmoId }); },
  };
}

Deno.test('BLOCK 6: a receipt adopted before its invoice is LINKED on a later tick, once the invoice is mapped', async () => {
  const d = deps({
    unlinked: [{ id: 'pmo-ip-1', erpName: 'ACC-PAY-0001' }],
    docs: { 'ACC-PAY-0001': { name: 'ACC-PAY-0001', references: [{ reference_doctype: 'Sales Invoice', reference_name: 'ACC-SINV-0007' }] } },
    mapped: { 'ACC-SINV-0007': 'pmo-si-7' },
  });
  const result = await repairUnlinkedReceipts(d);
  assert(result.repaired === 1, `expected 1 repair, got ${result.repaired}`);
  assert(d.links.length === 1 && d.links[0].ipId === 'pmo-ip-1' && d.links[0].siPmoId === 'pmo-si-7',
    `expected the receipt to be linked to its invoice, got ${JSON.stringify(d.links)}`);
});

Deno.test('BLOCK 6: a receipt whose invoice is STILL unmapped is left alone (retried next tick, never wrongly linked)', async () => {
  const d = deps({
    unlinked: [{ id: 'pmo-ip-1', erpName: 'ACC-PAY-0001' }],
    docs: { 'ACC-PAY-0001': { name: 'ACC-PAY-0001', references: [{ reference_doctype: 'Sales Invoice', reference_name: 'ACC-SINV-0007' }] } },
    mapped: {},
  });
  const result = await repairUnlinkedReceipts(d);
  assert(result.repaired === 0, 'expected no repair while the invoice is unmapped');
  assert(d.links.length === 0, 'expected NO write — a guessed link would be a wrong money attribution');
});

Deno.test('BLOCK 6: a genuine on-account receipt (no references at all) is never linked', async () => {
  const d = deps({
    unlinked: [{ id: 'pmo-ip-2', erpName: 'ACC-PAY-0002' }],
    docs: { 'ACC-PAY-0002': { name: 'ACC-PAY-0002', references: [] } },
    mapped: { 'ACC-SINV-0007': 'pmo-si-7' },
  });
  const result = await repairUnlinkedReceipts(d);
  assert(result.repaired === 0, 'an unreferenced receipt is a valid on-account payment, not a broken link');
  assert(d.links.length === 0, 'expected no link write');
});

Deno.test('BLOCK 6: one unreadable doc does not abort the pass (the other receipts still self-heal)', async () => {
  const docs: Record<string, Record<string, unknown>> = {
    'ACC-PAY-0001': { name: 'ACC-PAY-0001', references: [{ reference_name: 'ACC-SINV-0007' }] },
  };
  const links: Array<{ ipId: string; siPmoId: string }> = [];
  const result = await repairUnlinkedReceipts({
    listUnlinkedReceipts: async () => [{ id: 'pmo-ip-bad', erpName: 'ACC-PAY-BAD' }, { id: 'pmo-ip-1', erpName: 'ACC-PAY-0001' }],
    fetchDoc: async (name: string) => {
      if (name === 'ACC-PAY-BAD') throw new Error('erpnext 404');
      return docs[name] ?? {};
    },
    resolveSalesInvoicePmoId: async (siErpName: string) => (siErpName === 'ACC-SINV-0007' ? 'pmo-si-7' : null),
    link: async (ipId: string, siPmoId: string) => { links.push({ ipId, siPmoId }); },
  });
  assert(result.repaired === 1, `expected the healthy receipt to still be repaired, got ${result.repaired}`);
  assert(result.errors.length === 1, `expected the failure to be recorded, got ${JSON.stringify(result.errors)}`);
  assert(links.length === 1 && links[0].ipId === 'pmo-ip-1', 'expected only the healthy receipt to be linked');
});

Deno.test('BLOCK 6: nothing unlinked ⇒ the pass is a no-op (no ERP round-trips at all)', async () => {
  const d = deps({ unlinked: [], docs: {}, mapped: {} });
  const result = await repairUnlinkedReceipts(d);
  assert(result.repaired === 0 && d.fetched.length === 0, 'expected a clean org to cost nothing');
});

// S-06 (RF-030/031): the same pass heals the invoice-allocation mirror — receipts adopted before this
// column existed, and allocations whose invoice PMO adopted later.
Deno.test('RF-030: a receipt\'s full allocation list is re-mirrored from its ERP document, even when it is already linked', async () => {
  const mirrored: Array<{ ipId: string; allocations: unknown }> = [];
  const result = await repairUnlinkedReceipts({
    listUnlinkedReceipts: async () => [{ id: 'pmo-ip-1', erpName: 'ACC-PAY-0001' }],
    fetchDoc: async () => ({ name: 'ACC-PAY-0001', references: [
      { reference_doctype: 'Sales Invoice', reference_name: 'ACC-SINV-A', allocated_amount: 25 },
      { reference_doctype: 'Sales Invoice', reference_name: 'ACC-SINV-B', allocated_amount: 30 },
    ] }),
    resolveSalesInvoicePmoId: async () => null,
    link: async () => { throw new Error('must not link an unmapped invoice'); },
    mirrorAllocations: async (ipId: string, allocations: unknown) => { mirrored.push({ ipId, allocations }); },
  });
  assert(result.errors.length === 0, `unexpected errors ${JSON.stringify(result.errors)}`);
  assert(mirrored.length === 1 && mirrored[0].ipId === 'pmo-ip-1', `expected one mirror write, got ${JSON.stringify(mirrored)}`);
  assert(JSON.stringify(mirrored[0].allocations) === JSON.stringify([
    { reference_name: 'ACC-SINV-A', allocated_amount: '25.00' },
    { reference_name: 'ACC-SINV-B', allocated_amount: '30.00' },
  ]), `both allocations are carried: ${JSON.stringify(mirrored[0].allocations)}`);
});

Deno.test('RF-031: an on-account receipt mirrors a KNOWN-empty list; a doc without a references table is left unknown', async () => {
  const mirrored: Array<{ ipId: string; allocations: unknown }> = [];
  await repairUnlinkedReceipts({
    listUnlinkedReceipts: async () => [{ id: 'pmo-ip-2', erpName: 'ACC-PAY-0002' }, { id: 'pmo-ip-3', erpName: 'ACC-PAY-0003' }],
    fetchDoc: async (name: string) => (name === 'ACC-PAY-0002' ? { name, references: [] } : { name }),
    resolveSalesInvoicePmoId: async () => null,
    link: async () => {},
    mirrorAllocations: async (ipId: string, allocations: unknown) => { mirrored.push({ ipId, allocations }); },
  });
  assert(mirrored.length === 1 && mirrored[0].ipId === 'pmo-ip-2' && JSON.stringify(mirrored[0].allocations) === '[]',
    `only the documented on-account receipt is written, as []: ${JSON.stringify(mirrored)}`);
});
