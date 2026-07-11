// Task 1.6 — multi-domain read-model writer registry + resolver (replaces the dispatch if-chain).
// Deno-native test (no vitest import — plain assert helpers, matches agent-chat's
// actions.queryEntity.test.ts idiom).
// Verify: cd supabase/functions/adapter-dispatch && deno test readModelWriters.test.ts

import { READ_MODEL_WRITERS, getReadModelWriter } from './readModelWriters.ts';
import { resolveExternalRef, findPmoRecordId } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** A minimal fake service-role client recording every call, structurally matching supabase-js'
 *  .from(table).{insert,update,upsert,select} chain shape used by the writers/resolvers below. */
function makeFakeClient(rows: Record<string, unknown> = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const eqFilters: Record<string, string> = {};

  function selectChain(table: string) {
    const chain = {
      eq(column: string, value: string) {
        calls.push({ table, method: 'eq', args: [column, value] });
        eqFilters[column] = value;
        return chain;
      },
      async maybeSingle() {
        calls.push({ table, method: 'maybeSingle', args: [] });
        return { data: rows[table] ?? null, error: null };
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      return {
        insert: async (row: unknown) => {
          calls.push({ table, method: 'insert', args: [row] });
          return { error: null };
        },
        upsert: async (row: unknown, options: unknown) => {
          calls.push({ table, method: 'upsert', args: [row, options] });
          return { error: null };
        },
        update: (patch: unknown) => {
          calls.push({ table, method: 'update', args: [patch] });
          const updateChain = {
            eq(column: string, value: string) {
              calls.push({ table, method: 'update.eq', args: [column, value] });
              return updateChain;
            },
            then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
          };
          return updateChain;
        },
        select(columns: string) {
          calls.push({ table, method: 'select', args: [columns] });
          return selectChain(table);
        },
      };
    },
  };
  return { client, calls };
}

Deno.test({
  name: "READ_MODEL_WRITERS['tasks'].upsert writes a task row via insert on create (moved ClickUp writer)",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('tasks');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-1', name: 'Task A', status: 'open', project_id: 'proj-1' },
      { domain: 'tasks', operation: 'create', record: { id: 'pmo-1', project_id: 'proj-1' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert');
    assert(insertCall !== undefined, 'expected an insert call for a task create');
    assertEquals((insertCall!.args[0] as { org_id: string }).org_id, 'org-1');
    assertEquals((insertCall!.args[0] as { project_id: string }).project_id, 'proj-1');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['tasks'].upsert updates a task row on a non-create operation",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('tasks');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-1', name: 'Task A (renamed)', status: 'closed' },
      { domain: 'tasks', operation: 'update', record: { id: 'pmo-1' } },
    );
    const updateCall = calls.find((c) => c.method === 'update');
    assert(updateCall !== undefined, 'expected an update call for a task update');
    const eqCalls = calls.filter((c) => c.method === 'update.eq');
    assertEquals(eqCalls.length, 2, 'expected two scoping .eq() calls (org_id, id)');
  },
});

Deno.test({
  name: 'an unknown domain throws (no silent skip)',
  fn: () => {
    let threw = false;
    try {
      getReadModelWriter('nonexistent-domain');
    } catch {
      threw = true;
    }
    assert(threw, 'expected getReadModelWriter to throw for an unregistered domain');
  },
});

Deno.test({
  name: "the ERPNext domains ('companies'/'procurement') are registered but not-yet-wired — loud throw, not a silent no-op",
  fn: async () => {
    for (const domain of ['companies', 'procurement']) {
      const writer = READ_MODEL_WRITERS[domain];
      assert(writer !== undefined, `expected a registered (not-yet-wired) writer for '${domain}'`);
      let threw = false;
      try {
        await writer.upsert({ serviceClient: makeFakeClient().client as never, orgId: 'org-1' }, { id: 'pmo-1' }, {
          domain, operation: 'create', record: { id: 'pmo-1' },
        });
      } catch {
        threw = true;
      }
      assert(threw, `expected the not-yet-wired '${domain}' writer to throw rather than silently no-op`);
    }
  },
});

Deno.test({
  name: 'resolveExternalRef returns the external_refs external id, and null when absent',
  fn: async () => {
    const { client: withRow } = makeFakeClient({ external_refs: { external_record_id: 'ext-123' } });
    const found = await resolveExternalRef(withRow as never, 'org-1', 'tasks', 'pmo-1');
    assertEquals(found, 'ext-123');

    const { client: withoutRow } = makeFakeClient({ external_refs: null });
    const missing = await resolveExternalRef(withoutRow as never, 'org-1', 'tasks', 'pmo-missing');
    assertEquals(missing, null);
  },
});

Deno.test({
  name: 'findPmoRecordId is the exact reverse of resolveExternalRef',
  fn: async () => {
    const { client: withRow } = makeFakeClient({ external_refs: { pmo_record_id: 'pmo-1' } });
    const found = await findPmoRecordId(withRow as never, 'org-1', 'tasks', 'ext-123');
    assertEquals(found, 'pmo-1');

    const { client: withoutRow } = makeFakeClient({ external_refs: null });
    const missing = await findPmoRecordId(withoutRow as never, 'org-1', 'tasks', 'ext-missing');
    assertEquals(missing, null);
  },
});
