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
    si_number: `SINV-${index + 1}`, erp_project: null, erp_modified: null,
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
        in: (column: string, values: string[]) => { calls.push({ table, operation: 'in', args: [column, values] }); return Promise.resolve({ data: [], error: null }); },
        then: (resolve: (result: unknown) => void) => resolve({
          data: table === 'sales_invoices' ? candidates.filter((row) => !after || row.id > after).slice(0, limit) : [],
          error: null,
        }),
      };
      return query;
    },
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
