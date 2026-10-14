(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { resolveInvoiceProjects, sweepOrgDoctypesLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';
import { contactDb } from '../_shared/erpnextContacts.fixtures.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';
const P3 = '00000000-0000-4000-8000-0000000000a3';

function mappingDb() {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => { filters[column] = value; return builder; },
        not: (column: string, operator: string, value: unknown) => {
          filters[`${column}:${operator}`] = value;
          return builder;
        },
        in: (column: string, values: unknown[]) => {
          filters[column] = values;
          return Promise.resolve({ data: values.filter((id) => id === P1).map((id) => ({ id })), error: null });
        },
        maybeSingle: () => Promise.resolve({
          data: { config: { project_map: { [P1]: 'ERP-A', [P2]: 'ERP-DUP', [P3]: 'ERP-DUP', bad: 17 } } },
          error: null,
        }),
      };
      calls.push({ table, filters });
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

Deno.test('AC-PFIN-001/002 live project resolver maps only unique same-org UUID targets', async () => {
  const { client, calls } = mappingDb();
  const result = await resolveInvoiceProjects(client, ORG, ['ERP-A', 'ERP-DUP', 'ERP-UNKNOWN', 7]);
  assert(result.get('ERP-A') === P1, 'unique mapped same-org target resolves');
  assert(result.get('ERP-DUP') === null, 'duplicate ERP names are unresolved');
  assert(result.get('ERP-UNKNOWN') === null, 'unknown ERP name is unresolved');
  assert(result.size === 3, 'non-string names are ignored');
  assert(calls.some((call) => call.table === 'external_org_bindings' && call.filters.org_id === ORG),
    'binding lookup is org-scoped');
  const projectLookup = calls.find((call) => call.table === 'projects');
  assert(projectLookup?.filters.org_id === ORG, 'project validation is same-org');
  assert(JSON.stringify(projectLookup?.filters.id) === JSON.stringify([P1]), 'only unique UUID candidates are queried');
});

Deno.test('AC-PFIN-002 project resolver returns no targets when binding is absent', async () => {
  const client = {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      if (table === 'external_org_bindings') return builder;
      throw new Error('must not query projects without a binding');
    },
  } as unknown as SupabaseClient;
  const result = await resolveInvoiceProjects(client, ORG, ['ERP-A']);
  assert(result.get('ERP-A') === null, 'absent binding resolves ERP name to no PMO project');
});

Deno.test('AC-PFIN-001/002 Sales Invoice adoption stores its resolved project after claiming and skips unassigned notice', async () => {
  const db = contactDb({
    external_org_bindings: [{ org_id: ORG, external_tier: 'erpnext', activated_at: '2026-10-01', config: { project_map: { [P1]: 'ERP-A' } } }],
    projects: [{ id: P1, org_id: ORG }],
    profiles: [{ id: 'finance-user', org_id: ORG, status: 'active', role: 'Finance' }],
    notifications: [],
  });
  const originalEnv = Deno.env.get;
  const originalFetch = globalThis.fetch;
  (Deno.env as unknown as { get: (key: string) => string | undefined }).get = (key) =>
    ({ PROJECT_FINANCE_KEY: 'synthetic-key', PROJECT_FINANCE_SECRET: 'synthetic-secret' } as Record<string, string>)[key];
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const data = url.pathname.endsWith('/Sales%20Invoice') || url.pathname.endsWith('/Sales Invoice')
      ? [{ name: 'SINV-ATTR-1', modified: '2026-10-10 09:00:00', docstatus: 1, company: 'Example Company', project: 'ERP-A', grand_total: '125.00', outstanding_amount: '25.00', currency: 'USD' }]
      : [];
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await sweepOrgDoctypesLive(db.client, {
      orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: 'project-finance', company: 'Example Company',
      config: { project_map: { [P1]: 'ERP-A' } }, ownedDomains: ['revenue'], versionMajor: 15,
    });
    assert(!result.error, `Sales Invoice adoption succeeds: ${result.error}`);
    const invoice = db.rows.sales_invoices.find((row) => row.si_number === 'SINV-ATTR-1');
    assert(invoice?.project_id === P1, `adopted invoice carries resolved PMO project; got ${invoice?.project_id}`);
    assert(invoice?.erp_project === 'ERP-A', 'adoption retains ERP project provenance');
    const claimIndex = db.writes.findIndex((write) => write.table === 'external_refs' && write.op === 'insert');
    const invoiceIndex = db.writes.findIndex((write) => write.table === 'sales_invoices' && write.op === 'insert');
    assert(claimIndex >= 0 && invoiceIndex > claimIndex, 'external reference claim precedes invoice insert');
    assert(db.rows.notifications.length === 0, 'resolved adoption does not raise unassigned-project notification');
  } finally {
    globalThis.fetch = originalFetch;
    (Deno.env as unknown as { get: unknown }).get = originalEnv;
  }
});
