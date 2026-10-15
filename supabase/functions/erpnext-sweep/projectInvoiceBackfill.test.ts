(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { repairInvoiceProjectsLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

const ORG = '00000000-0000-4000-8000-0000000000aa';
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('AC-PFIN-004 historical candidate scan is capped, keyset ordered, and scoped to current revenue refs', async () => {
  const calls: Array<{ table: string; operation: string; args: unknown[] }> = [];
  const candidates = Array.from({ length: 101 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    si_number: `SINV-${index + 1}`, erp_project: 'ERP-A', erp_modified: null,
  }));
  const client = {
    from(table: string) {
      let limit: number | undefined;
      let after: string | undefined;
      const filters: unknown[] = [];
      const query = {
        select: (columns: string) => { calls.push({ table, operation: 'select', args: [columns] }); return query; },
        eq: (column: string, value: unknown) => { filters.push([column, value]); calls.push({ table, operation: 'eq', args: [column, value] }); return query; },
        is: (column: string, value: unknown) => { filters.push([column, value]); calls.push({ table, operation: 'is', args: [column, value] }); return query; },
        not: (column: string, operator: string, value: unknown) => { filters.push([column, operator, value]); return query; },
        order: (column: string, options: unknown) => { calls.push({ table, operation: 'order', args: [column, options] }); return query; },
        limit: (value: number) => { limit = value; calls.push({ table, operation: 'limit', args: [value] }); return query; },
        gt: (column: string, value: string) => { after = value; calls.push({ table, operation: 'gt', args: [column, value] }); return query; },
        in: (column: string, values: string[]) => { calls.push({ table, operation: 'in', args: [column, values] }); return Promise.resolve({ data: table === 'projects' ? values.filter((id) => id === '00000000-0000-4000-8000-0000000000a1').map((id) => ({ id })) : [], error: null }); },
        maybeSingle: () => Promise.resolve({ data: { config: { project_map: { '00000000-0000-4000-8000-0000000000a1': 'ERP-A' } } }, error: null }),
        then: (resolve: (result: unknown) => void) => resolve({
          data: table === 'sales_invoices' ? candidates.filter((row) => !after || row.id > after).slice(0, limit) : [],
          error: null,
        }),
      };
      return query;
    },
    rpc: () => Promise.resolve({ data: true, error: null }),
  } as unknown as SupabaseClient;
  const result = await repairInvoiceProjectsLive(client, {
    orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: 'synthetic', company: 'Example Company',
    config: {}, ownedDomains: ['revenue'], versionMajor: 15,
  }, candidates[0].id);
  assert(result.scanned === 100, `scan starts after cursor and caps result set; got ${result.scanned}`);
  assert(result.nextCursor === candidates[100].id, 'continuation cursor is stable and is the 100th candidate after cursor');
  assert(!result.done, 'full-sized candidate page requires a follow-up request');
  assert(calls.some((call) => call.table === 'sales_invoices' && call.operation === 'gt'
    && call.args[1] === candidates[0].id), 'candidate query applies UUID keyset cursor');
  assert(calls.some((call) => call.table === 'sales_invoices' && call.operation === 'limit' && call.args[0] === 100),
    'candidate query has a hard 100-row limit');
  const refs = calls.filter((call) => call.table === 'external_refs' && call.operation === 'in');
  assert(refs.length === 1, 'current revenue refs are fetched once for the candidate batch');
  assert(calls.some((call) => call.table === 'external_refs' && call.operation === 'eq'
    && call.args[0] === 'org_id' && call.args[1] === ORG), 'reference lookup is constrained to the requested org');
  assert(calls.some((call) => call.table === 'sales_invoices' && call.operation === 'is'
    && call.args[0] === 'project_id' && call.args[1] === null), 'assigned invoices are excluded');
  assert(calls.every((call) => call.operation !== 'insert'), 'maintenance scan never inserts/adopts invoices');
});

Deno.test('AC-PFIN-004 hydrates current ERP provenance with CAS before resolving and filling an invoice', async () => {
  const invoice = { id: '00000000-0000-4000-8000-000000000101', si_number: 'SINV-HYDRATE', erp_project: null, erp_modified: '2026-10-01T00:00:00.000Z', org_id: ORG, project_id: null, pmo_native: false };
  const writes: Array<{ table: string; row: Record<string, unknown>; filters: Array<[string, unknown, unknown?]> }> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      let action = 'select';
      let payload: Record<string, unknown> = {};
      const filters: Array<[string, unknown, unknown?]> = [];
      const query: Record<string, (...args: never[]) => unknown> = {};
      query.select = ((columns: string) => { void columns; return query; }) as never;
      for (const method of ['eq', 'is', 'not', 'gt', 'in', 'order', 'limit'] as const) {
        query[method] = ((...args: unknown[]) => { if (method === 'eq' || method === 'is') filters.push([args[0] as string, args[1]]); return query; }) as never;
      }
      query.update = ((row: Record<string, unknown>) => { action = 'update'; payload = row; return query; }) as never;
      query.maybeSingle = (async () => table === 'external_org_bindings'
        ? { data: { config: { project_map: { '00000000-0000-4000-8000-0000000000a1': 'ERP-PROJECT' } }, secret_ref: 'synthetic' }, error: null }
        : { data: null, error: null }) as never;
      query.then = ((resolve: (value: unknown) => void) => {
        if (action === 'update') {
          writes.push({ table, row: payload, filters });
          if (table === 'sales_invoices') Object.assign(invoice, payload);
          resolve({ data: [{ id: invoice.id }], error: null });
          return;
        }
        if (table === 'sales_invoices') resolve({ data: [invoice], error: null });
        else if (table === 'external_refs') resolve({ data: [{ org_id: ORG, domain: 'revenue', pmo_record_id: invoice.id, external_record_id: 'SINV-HYDRATE' }], error: null });
        else if (table === 'projects') resolve({ data: [{ id: '00000000-0000-4000-8000-0000000000a1' }], error: null });
        else resolve({ data: [], error: null });
      }) as never;
      return query;
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'fill_sales_invoice_project') rpcCalls.push({ name, args });
      return Promise.resolve({ data: name === 'fill_sales_invoice_project' ? true : null, error: null });
    },
  } as unknown as SupabaseClient;
  const originalGet = Deno.env.get;
  const originalFetch = globalThis.fetch;
  (Deno.env as unknown as { get: (key: string) => string | undefined }).get = (key) => ({
    EXTERNAL_CONNECT_ENABLED: 'true', PROJECT_FINANCE_KEY: 'synthetic-key', PROJECT_FINANCE_SECRET: 'synthetic-secret',
  } as Record<string, string>)[key];
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: {
    name: 'SINV-HYDRATE', modified: '2026-10-01 00:00:00', company: 'Example Company', project: 'ERP-PROJECT',
  } }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    const result = await repairInvoiceProjectsLive(client, {
      orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: 'project-finance', company: 'Example Company',
      config: {}, ownedDomains: ['revenue'], versionMajor: 15,
    }, null);
    assert(result.repaired === 1 && result.unresolved === 0, `current ERP project is repaired: ${JSON.stringify(result)}`);
    const hydration = writes.find((write) => write.table === 'sales_invoices');
    assert(hydration?.row.erp_project === 'ERP-PROJECT', 'ERP provenance is hydrated from the referenced source document');
    assert(hydration?.filters.some(([column, value]) => column === 'erp_modified' && value === invoice.erp_modified), 'hydration compares the previously read ERP watermark');
    assert(hydration?.filters.some(([column, value]) => column === 'erp_project' && value === null), 'hydration is compare-and-set against missing provenance');
    assert(rpcCalls.length === 1 && rpcCalls[0].name === 'fill_sales_invoice_project', 'successful hydration resolves through the shared atomic fill RPC');
    assert(rpcCalls[0].args.p_erp_project === 'ERP-PROJECT', 'fill is fenced by hydrated source provenance');
    assert(writes.every((write) => write.table !== 'sales_invoices' || !Object.hasOwn(write.row, 'amount')), 'repair does not alter invoice money');
  } finally {
    globalThis.fetch = originalFetch;
    (Deno.env as unknown as { get: unknown }).get = originalGet;
  }
});
