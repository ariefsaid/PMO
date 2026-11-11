import '../_shared/testing/publicErpDns.ts';
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
    'ACC-PAY-0001': { name: 'ACC-PAY-0001', references: [{ reference_doctype: 'Sales Invoice', reference_name: 'ACC-SINV-0007' }] },
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

Deno.test('S-06: stamps successful and failed attempts so the sweep can defer them', async () => {
  const stamped: string[] = [];
  const result = await repairUnlinkedReceipts({
    listUnlinkedReceipts: async () => [{ id: 'failed', erpName: 'bad' }, { id: 'good', erpName: 'good' }],
    fetchDoc: async (name) => { if (name === 'bad') throw new Error('upstream error'); return { references: [] }; },
    resolveSalesInvoicePmoId: async () => null,
    link: async () => {},
    stampAllocationCheck: async (id) => { stamped.push(id); },
  });
  assert(stamped.join(',') === 'failed,good', `each attempt stamped: ${stamped}`);
  assert(result.errors.length === 1, 'upstream failure is reported');
});

Deno.test('S-06: a bounded oldest-first batch reaches later candidates on the next run', async () => {
  const checked = new Set<string>();
  const reached: string[][] = [];
  for (let run = 0; run < 2; run++) {
    const batch = ['oldest', 'next', 'newest'].filter((id) => !checked.has(id)).slice(0, 2);
    reached.push(batch);
    await repairUnlinkedReceipts({
      listUnlinkedReceipts: async () => batch.map((id) => ({ id, erpName: id })),
      fetchDoc: async () => ({ references: [] }),
      resolveSalesInvoicePmoId: async () => null,
      link: async () => {},
      stampAllocationCheck: async (id) => { checked.add(id); },
    });
  }
  assert(reached[0].join(',') === 'oldest,next' && reached[1].join(',') === 'newest',
    `later candidates reached: ${JSON.stringify(reached)}`);
});

Deno.test('repair resolves the first mapped Sales Invoice allocation and retains all allocations', async () => {
  const linked: string[] = [];
  let mirrored: unknown;
  const result = await repairUnlinkedReceipts({
    listUnlinkedReceipts: async () => [{ id: 'receipt', erpName: 'PE' }],
    fetchDoc: async () => ({ references: [
      { reference_doctype: 'Sales Order', reference_name: 'SO' },
      { reference_doctype: 'Sales Invoice', reference_name: 'SI-A', allocated_amount: 1 },
      { reference_doctype: 'Sales Invoice', reference_name: 'SI-B', allocated_amount: 2 },
    ] }),
    resolveSalesInvoicePmoId: async (name) => name === 'SI-B' ? 'invoice-b' : null,
    link: async (_id, invoice) => { linked.push(invoice); },
    mirrorAllocations: async (_id, allocations) => { mirrored = allocations; },
  });
  assert(result.repaired === 1 && linked.join() === 'invoice-b', `links ${linked}`);
  assert(Array.isArray(mirrored) && mirrored.length === 2, 'both invoice allocations remain');
});

Deno.test('repair stamps missing references and continues to the next candidate', async () => {
  const stamped: string[] = [];
  const reached: string[] = [];
  await repairUnlinkedReceipts({
    listUnlinkedReceipts: async () => [...Array.from({ length: 100 }, (_, i) => ({ id: `missing-${i}`, erpName: null })), { id: 'valid', erpName: 'PE' }],
    fetchDoc: async (name) => { reached.push(name); return { references: [] }; },
    resolveSalesInvoicePmoId: async () => null,
    link: async () => {},
    stampAllocationCheck: async (id) => { stamped.push(id); },
  });
  assert(stamped.length === 101 && reached.join() === 'PE', 'every candidate rotates and only referenced receipts are fetched');
});

Deno.test('candidate selection retains missing references in a saturated page', async () => {
  const { listReceiptRepairCandidates } = await import('./index.ts');
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, allocation_checked_at: null }));
  const client = {
    from(table: string) {
      const query = {
        select: () => query, eq: () => query, not: () => query, or: () => query,
        order: () => query, limit: () => query, is: () => query, filter: () => query, in: () => query,
        then: (resolve: (result: unknown) => void) => resolve({ data: table === 'incoming_payments' ? rows : [], error: null }),
      };
      return query;
    },
  };
  const candidates = await listReceiptRepairCandidates(client as never, 'org');
  assert(candidates.length === 100 && candidates.every((row) => row.erpName === null), 'all missing-reference candidates remain eligible to rotate');
});

Deno.test('candidate selection reaches a referenced receipt after rotating a full page', async () => {
  const { listReceiptRepairCandidates } = await import('./index.ts');
  const checked = new Set<string>();
  const ids = [...Array.from({ length: 100 }, (_, i) => `missing-${i}`), 'valid'];
  const client = {
    from(table: string) {
      let wanted: string[] = [];
      const query = {
        select: () => query, eq: () => query, not: () => query, or: () => query,
        order: () => query, limit: () => query, is: () => query, filter: () => query,
        in: (_column: string, values: string[]) => { wanted = values; return query; },
        then: (resolve: (result: unknown) => void) => resolve({ data: table === 'incoming_payments'
          ? ids.filter((id) => !checked.has(id)).slice(0, 100).map((id) => ({ id, allocation_checked_at: null }))
          : wanted.includes('valid') ? [{ pmo_record_id: 'valid', external_record_id: 'PE' }] : [], error: null }),
      };
      return query;
    },
  };
  const fetched: string[] = [];
  for (let run = 0; run < 2; run++) await repairUnlinkedReceipts({
    listUnlinkedReceipts: () => listReceiptRepairCandidates(client as never, 'org'),
    stampAllocationCheck: async (id) => { checked.add(id); },
    fetchDoc: async (name) => { fetched.push(name); return { references: [] }; },
    resolveSalesInvoicePmoId: async () => null, link: async () => {},
  });
  assert(fetched.join() === 'PE' && checked.size === 101, 'the referenced receipt is reached on the next scan');
});

Deno.test('repair ignores malformed and non-invoice references', async () => {
  const d = deps({ unlinked: [{ id: 'receipt', erpName: 'PE' }], docs: { PE: { references: [
    { reference_name: 'SI' }, { reference_doctype: 'Sales Order', reference_name: 'SI' },
  ] } }, mapped: { SI: 'invoice' } });
  const result = await repairUnlinkedReceipts(d);
  assert(result.repaired === 0 && d.links.length === 0, 'only typed Sales Invoice references may link');
});

Deno.test('live resolver accepts only a Sales Invoice in the same organization', async () => {
  const { resolveReceiptSalesInvoice } = await import('./index.ts');
  const filters: Array<[string, string, string]> = [];
  let invoiceExists = true;
  const client = {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: (column: string, value: string) => { filters.push([table, column, value]); return chain; },
        maybeSingle: async () => ({ data: table === 'external_refs' ? { pmo_record_id: 'record' } : invoiceExists ? { id: 'record' } : null, error: null }),
      };
      return chain;
    },
  };
  assert(await resolveReceiptSalesInvoice(client as never, 'org-a', 'SI') === 'record', 'mapped invoice is resolved');
  assert(filters.some(([table, column, value]) => table === 'sales_invoices' && column === 'org_id' && value === 'org-a'), 'invoice lookup is org scoped');
  invoiceExists = false;
  assert(await resolveReceiptSalesInvoice(client as never, 'org-a', 'SI') === null, 'mapping without an invoice is not linked');
});

Deno.test('live resolver leaves absent references unresolved and propagates lookup errors', async () => {
  const { resolveReceiptSalesInvoice } = await import('./index.ts');
  let mode: 'missing' | 'ref-error' | 'invoice-error' = 'missing';
  const client = { from(table: string) {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({
      data: table === 'external_refs' && mode === 'invoice-error' ? { pmo_record_id: 'record' } : null,
      error: (table === 'external_refs' && mode === 'ref-error') || (table === 'sales_invoices' && mode === 'invoice-error') ? { message: 'read failed', code: 'XX000' } : null,
    }) }; return chain;
  } };
  assert(await resolveReceiptSalesInvoice(client as never, 'org', 'SI') === null, 'unknown reference remains unresolved');
  for (mode of ['ref-error', 'invoice-error'] as const) {
    let failed = false;
    try { await resolveReceiptSalesInvoice(client as never, 'org', 'SI'); } catch (error) { failed = error instanceof Error && error.message.includes('read failed'); }
    assert(failed, `${mode} reaches the caller`);
  }
});

Deno.test('live repair retains unresolved allocation evidence and reports lookup failures', async () => {
  const { repairOrgLinksLive } = await import('./index.ts');
  let mode = 'other';
  let details: unknown = [{ invoice_id: 'existing', invoice_number: 'old', amount: '1', currency: null }];
  let linked: unknown = null;
  const client = { from(table: string) {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    let inValues: string[] = [];
    const q = {
      select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; },
      not: () => q, or: () => q, order: () => q, limit: () => q, is: () => q, filter: () => q,
      in: (_key: string, values: string[]) => { inValues = values; return q; },
      update: (value: Record<string, unknown>) => { patch = value; return q; },
      maybeSingle: async () => {
        if (table === 'external_refs') return { data: { pmo_record_id: 'record' }, error: null };
        if (table === 'sales_invoices' && mode === 'error') return { data: null, error: { message: 'read failed', code: 'XX000' } };
        const invoiceOrg = mode === 'same-org' ? 'org-a' : mode === 'cross-org' ? 'org-b' : null;
        return { data: invoiceOrg && (!filters.org_id || filters.org_id === invoiceOrg) ? { id: 'record', currency: null } : null, error: null };
      },
      then: (resolve: (value: unknown) => void) => {
        if (patch) {
          if ('allocation_details' in patch) details = patch.allocation_details;
          if ('sales_invoice_id' in patch) linked = patch.sales_invoice_id;
          return resolve({ error: null });
        }
        return resolve({ data: table === 'incoming_payments' ? [{ id: 'receipt', allocation_checked_at: null }] : inValues.includes('receipt') ? [{ pmo_record_id: 'receipt', external_record_id: 'PE' }] : [], error: null });
      },
    }; return q;
  } };
  const oldGet = Deno.env.get;
  const oldFetch = globalThis.fetch;
  (Deno.env as unknown as { get: (key: string) => string | undefined }).get = (key) => ({ EXTERNAL_CONNECT_ENABLED: 'true', TEST_KEY: 'key', TEST_SECRET: 'secret' } as Record<string, string>)[key];
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: { references: [{ reference_doctype: 'Sales Invoice', reference_name: 'SI', allocated_amount: 10 }] } }), { status: 200 })) as typeof fetch;
  const org = { orgId: 'org-a', siteUrl: 'https://erp.example.test', secretRef: 'test', company: 'Example', config: {}, ownedDomains: ['revenue'], versionMajor: 15 };
  try {
    const absent = await repairOrgLinksLive(client as never, org);
    assert(!absent.error && linked === null, `unrelated mapping is not linked: ${JSON.stringify(absent)} ${JSON.stringify(linked)}`);
    assert(JSON.stringify(details) === JSON.stringify([{ invoice_id: null, invoice_number: 'SI', amount: '10.00', currency: null }]), 'invoice evidence remains unresolved');
    mode = 'cross-org';
    const crossOrg = await repairOrgLinksLive(client as never, org);
    assert(!crossOrg.error && linked === null && JSON.stringify(details).includes('"invoice_id":null'), 'other organization invoice remains unresolved');
    details = [{ invoice_id: 'existing' }];
    mode = 'error';
    const failed = await repairOrgLinksLive(client as never, org);
    assert(Boolean(failed.error?.includes('read failed')), `lookup failure is reported: ${JSON.stringify(failed)}`);
    assert(JSON.stringify(details) === JSON.stringify([{ invoice_id: 'existing' }]) && linked === null, 'failed read does not replace existing details or link');
    mode = 'same-org';
    const resolved = await repairOrgLinksLive(client as never, org);
    assert(resolved.repaired === 1 && linked === 'record', 'same organization invoice links');
  } finally { globalThis.fetch = oldFetch; (Deno.env as unknown as { get: typeof Deno.env.get }).get = oldGet; }
});
