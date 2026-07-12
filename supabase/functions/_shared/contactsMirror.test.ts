// task 3.10 (FR-ENA-095) — the ERPNext `contacts` table writer (registered ahead of the slice-8
// sweep/webhook ingress that will call it; inert until then). Deno-native test, no vitest import.
// Verify: cd supabase/functions/_shared && deno test contactsMirror.test.ts

import { createErpContactsTableWriter } from './erpnextMirrorDeps.ts';

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** A minimal fake service-role client, matching the shape createErpContactsTableWriter needs. */
function makeFakeClient(rows: Record<string, unknown> = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  function selectChain(table: string) {
    const chain = {
      eq(column: string, value: string) {
        calls.push({ table, method: 'eq', args: [column, value] });
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
  name: 'contacts table writer: mintMirror inserts full_name/email/phone/company_id (native), never title/notes/archived_at',
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = createErpContactsTableWriter(client as never, 'org-1');
    const id = await writer.mintMirror({ id: 'placeholder', full_name: 'Jane Doe', email: 'jane@acme.test', phone: '+62-800', company_id: 'pmo-co-1' }, '2026-07-11 10:00:00');
    assert(typeof id === 'string' && id.length > 0, 'expected a minted uuid');
    const insertCall = calls.find((c) => c.method === 'insert');
    assert(insertCall !== undefined, 'expected an insert call');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.org_id, 'org-1');
    assertEquals(row.company_id, 'pmo-co-1');
    assertEquals(row.full_name, 'Jane Doe');
    assertEquals(row.email, 'jane@acme.test');
    assertEquals(row.phone, '+62-800');
    assert(!('title' in row) && !('notes' in row) && !('archived_at' in row), 'must never set the enhancement columns');
  },
});

Deno.test({
  name: 'contacts table writer: mintMirror rejects a canonical with no resolved company_id',
  fn: async () => {
    const { client } = makeFakeClient();
    const writer = createErpContactsTableWriter(client as never, 'org-1');
    let threw = false;
    try {
      await writer.mintMirror({ id: 'placeholder', full_name: 'Jane Doe' }, '2026-07-11 10:00:00');
    } catch {
      threw = true;
    }
    assert(threw, 'expected mintMirror to throw without a resolved company_id');
  },
});

Deno.test({
  name: 'contacts table writer: updateMirror patches only full_name/email/phone, never title/notes/archived_at',
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = createErpContactsTableWriter(client as never, 'org-1');
    await writer.updateMirror('pmo-contact-1', { id: 'pmo-contact-1', full_name: 'Jane Doe Renamed', email: null, phone: null }, '2026-07-11 10:00:00');
    const updateCall = calls.find((c) => c.method === 'update');
    assert(updateCall !== undefined, 'expected an update call');
    const patch = updateCall!.args[0] as Record<string, unknown>;
    assertEquals(Object.keys(patch).sort(), ['email', 'full_name', 'phone']);
    const eqCalls = calls.filter((c) => c.method === 'update.eq');
    assertEquals(eqCalls.length, 2, 'expected two scoping .eq() calls (org_id, id)');
  },
});

Deno.test({
  name: 'contacts table writer: readMirrorErpModified always returns null (contacts have no erp_modified mirror col, spec §7)',
  fn: async () => {
    const { client } = makeFakeClient();
    const writer = createErpContactsTableWriter(client as never, 'org-1');
    const result = await writer.readMirrorErpModified('pmo-contact-1');
    assertEquals(result, null);
  },
});

Deno.test({
  name: 'contacts table writer: resolvePmoRecordId resolves via external_refs domain="contacts"',
  fn: async () => {
    const { client } = makeFakeClient({ external_refs: { pmo_record_id: 'pmo-contact-1' } });
    const writer = createErpContactsTableWriter(client as never, 'org-1');
    const result = await writer.resolvePmoRecordId('Contact:jane@acme.test');
    assertEquals(result, 'pmo-contact-1');
  },
});
