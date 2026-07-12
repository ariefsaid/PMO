/**
 * erpnext/actualsSnapshot.ts (task 7.3, AC-ENA-060): refreshActuals — sums MIRRORED erp_gl_entry_mirror
 * rows into erp_actuals_snapshot. ADR-0048: PMO may SUM mirrored ledger rows (ERP truth); it may NEVER
 * invent an accounting figure or read procurement_invoices for actuals.
 *
 * RED until actualsSnapshot.ts exists. Asserts: given a fixed erp_gl_entry_mirror seed, the snapshot
 * holds the exact per-(cost_center, account, fiscal_year) sums (net = debit − credit), a refresh
 * REPLACES the prior scope (single snapshot_id / single as_of), source_report='GL Entry' is stamped,
 * and procurement_invoices is NEVER touched on any path (the FR-ENA-162/ADR-0048 prohibition).
 */
import { describe, expect, it } from 'vitest';
import { refreshActuals } from './actualsSnapshot.ts';

/** A recording structural service client: mirrors the supabase-js `.from(t).select(c).eq().eq()` +
 *  `.delete().eq()` + `.insert([])` shape (thenable filter builders). Every `from(table)` call is
 *  recorded so the test can assert procurement_invoices is never touched. */
interface RecordingClient {
  tables: string[];
  glRows: Record<string, unknown>[];
  deletedScopes: Record<string, string | null>[];
  inserted: Record<string, unknown>[][];
  from(table: string): unknown;
}

function makeClient(glRows: Record<string, unknown>[]): RecordingClient {
  const rec: RecordingClient = { tables: [], glRows, deletedScopes: [], inserted: [] };
  rec.from = (table: string) => {
    rec.tables.push(table);
    if (table === 'erp_gl_entry_mirror') {
      // select + eq chain that resolves to the seeded rows (filters are structural here — the unit
      // test seeds ONLY the org's rows, so an unfiltered return is the exact read-model the refresh
      // consumes in production under RLS org-isolation).
      const selectBuilder = Promise.resolve({ data: [...glRows], error: null });
      Object.assign(selectBuilder, {
        eq: () => selectBuilder,
      });
      return { select: () => selectBuilder };
    }
    if (table === 'erp_actuals_snapshot') {
      return {
        delete: () => {
          const scope: Record<string, string | null> = {};
          const del = Promise.resolve({ error: null });
          Object.assign(del, {
            eq: (col: string, val: string | null) => {
              scope[col] = val;
              return del;
            },
          });
          // resolve records the delete scope when awaited
          void del.then(() => rec.deletedScopes.push(scope));
          return del;
        },
        insert: async (rows: Record<string, unknown>[]) => {
          rec.inserted.push(rows);
          return { error: null };
        },
      };
    }
    throw new Error(`unexpected table access: ${table}`);
  };
  return rec;
}

describe('erpnext/actualsSnapshot — refreshActuals (AC-ENA-060)', () => {
  it('sums mirrored GL rows per (cost_center, account, fiscal_year); net = debit − credit', async () => {
    const client = makeClient([
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Creditors - PSC', fiscal_year: '2026', debit: 0, credit: 50000, is_cancelled: false },
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Stock Received But Not Billed - PSC', fiscal_year: '2026', debit: 50000, credit: 0, is_cancelled: false },
      // a second Creditors row in the SAME group → must ADD into the group sum
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Creditors - PSC', fiscal_year: '2026', debit: 0, credit: 25000, is_cancelled: false },
      // a different fiscal year → its own group
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Creditors - PSC', fiscal_year: '2025', debit: 1000, credit: 0, is_cancelled: false },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', {});
    expect(client.tables).toContain('erp_gl_entry_mirror');
    expect(client.tables).toContain('erp_actuals_snapshot');
    expect(client.inserted).toHaveLength(1);
    const rows = client.inserted[0]!;
    const byKey = Object.fromEntries(rows.map((r) => [`${r.cost_center}|${r.account}|${r.fiscal_year}`, r]));
    expect(byKey['Main - PSC|Creditors - PSC|2026']).toMatchObject({ debit: 0, credit: 75000, net: -75000 });
    expect(byKey['Main - PSC|Stock Received But Not Billed - PSC|2026']).toMatchObject({ debit: 50000, credit: 0, net: 50000 });
    expect(byKey['Main - PSC|Creditors - PSC|2025']).toMatchObject({ debit: 1000, credit: 0, net: 1000 });
    expect(rows).toHaveLength(3); // 3 distinct groups
  });

  it('stamps source_report="GL Entry" + a single as_of + a single snapshot_id on every row', async () => {
    const client = makeClient([
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Cash - PSC', fiscal_year: '2026', debit: 100, credit: 0, is_cancelled: false },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', {});
    const rows = client.inserted[0]!;
    expect(rows.every((r) => r.source_report === 'GL Entry')).toBe(true);
    expect(rows.every((r) => typeof r.snapshot_id === 'string')).toBe(true);
    const snapshotIds = new Set(rows.map((r) => r.snapshot_id));
    expect(snapshotIds.size).toBe(1); // single snapshot_id
    const asOfs = new Set(rows.map((r) => r.as_of));
    expect(asOfs.size).toBe(1); // single as_of (coherent snapshot)
  });

  it('a refresh REPLACES the prior scope (delete prior-scope rows THEN insert, single snapshot_id)', async () => {
    const client = makeClient([
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Cash - PSC', fiscal_year: '2026', debit: 1, credit: 0, is_cancelled: false },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', {});
    // a delete for the org's scope happened, scoped by org_id
    expect(client.deletedScopes).toHaveLength(1);
    expect(client.deletedScopes[0]).toMatchObject({ org_id: 'org-1' });
    // exactly one insert (the new snapshot), exactly one snapshot_id
    expect(client.inserted).toHaveLength(1);
  });

  it('NEVER reads or writes procurement_invoices (ADR-0048 / FR-ENA-162 prohibition)', async () => {
    const client = makeClient([
      { org_id: 'org-1', cost_center: 'Main - PSC', account: 'Cash - PSC', fiscal_year: '2026', debit: 1, credit: 0, is_cancelled: false },
    ]);
    await refreshActuals(client as unknown as never, 'org-1', {});
    expect(client.tables).not.toContain('procurement_invoices');
  });

  it('an empty mirror (no GL rows) still snapshot-replaces → a single empty insert (scope cleared)', async () => {
    const client = makeClient([]);
    await refreshActuals(client as unknown as never, 'org-1', {});
    expect(client.deletedScopes).toHaveLength(1);
    expect(client.inserted).toHaveLength(1);
    expect(client.inserted[0]).toEqual([]); // no rows, but the scope was replaced (cleared)
  });

  it('propagates a service-role read error (never silently swallows a mirror read failure)', async () => {
    const client: RecordingClient = { tables: [], glRows: [], deletedScopes: [], inserted: [], from: () => { throw new Error('boom'); } };
    await expect(refreshActuals(client as unknown as never, 'org-1', {})).rejects.toThrow('boom');
  });
});
