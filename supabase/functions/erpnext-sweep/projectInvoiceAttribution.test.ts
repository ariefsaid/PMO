(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { resolveInvoiceProjects } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

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
