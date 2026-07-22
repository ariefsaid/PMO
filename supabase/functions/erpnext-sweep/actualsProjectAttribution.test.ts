/**
 * ⚑ NEW-1 (Luna audit round 4, 2026-07-22) [Deno] — THE SWEEP MUST HAND THE REFRESH A REAL PROJECT MAP.
 *
 * `refreshOrgAccountingLive` is the ONLY production caller of the actuals refresh, and it passed a
 * literal `actualsScope: {}`. `refreshActuals` then stamped `project_id = scope.projectId ?? null`, so
 * EVERY `erp_actuals_snapshot` row in production carried `project_id = NULL` — while
 * `0141_get_budget_projection.sql` joins `s.project_id = p_project_id`, which never matches NULL.
 * "Actuals to date" was therefore structurally 0.00 for every project with real posted GL spend, with
 * variance = the entire budget, on the primary money screen, silently.
 *
 * The fix reads the dimension ERP itself states on the GL row (`erp_gl_entry_mirror.project`) and
 * resolves it through the org binding's `config.project_map` — the SAME (and only) seam
 * `dispatchFactory.ts` already uses to resolve `ctx.refs.project` for the budget push and every
 * timesheet entry. These tests drive the SHIPPED `refreshOrgAccountingLive` (real refreshers, fake DB,
 * stubbed `globalThis.fetch`) and assert the row that actually lands in `erp_actuals_snapshot` — so a
 * regression to a caller-supplied scope, or a dropped `project_map`, goes red here.
 *
 * Verify: deno test supabase/functions/erpnext-sweep/ --config supabase/functions/erpnext-sweep/deno.json
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { refreshOrgAccountingLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const PROJ_A = '11111111-1111-4111-8111-111111111111';
const PROJ_B = '22222222-2222-4222-8222-222222222222';
const SECRET_REF = 'attrib-bench';

function stubEnv() {
  const original = Deno.env.get;
  const values: Record<string, string> = { ATTRIB_BENCH_KEY: 'k', ATTRIB_BENCH_SECRET: 's' };
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = (k: string) => values[k];
  return { restore: () => { (Deno.env as unknown as { get: unknown }).get = original; } };
}

/** The aging report RPC returns an empty result set — this suite is about the ACTUALS attribution. */
function stubFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: { result: [], columns: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; } };
}

interface Insert { table: string; rows: Record<string, unknown>[] }

/** A Supabase stand-in: chainable THENABLE builders (the real PostgrestFilterBuilder shape), seeded
 *  per-table reads, and every insert recorded so the snapshot row itself is observable. */
function fakeDb(glRows: Record<string, unknown>[], reads: Record<string, unknown[]> = {}) {
  const inserts: Insert[] = [];
  const client = {
    from(table: string) {
      const data = table === 'erp_gl_entry_mirror' ? glRows : (reads[table] ?? []);
      // deno-lint-ignore no-explicit-any
      const builder: any = Promise.resolve({ data, error: null });
      for (const m of ['select', 'eq', 'in', 'is', 'not', 'order', 'limit', 'contains', 'delete', 'maybeSingle', 'single']) {
        builder[m] = () => builder;
      }
      builder.insert = (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        inserts.push({ table, rows: Array.isArray(rows) ? rows : [rows] });
        return Promise.resolve({ data: null, error: null });
      };
      builder.update = () => builder;
      builder.upsert = () => builder;
      return builder;
    },
    /**
     * ⚑ Audit round 10 (HIGH-1). A snapshot generation is no longer published as `delete()` + `insert()`
     * — that was two round trips, so two overlapping sweeps could leave TWO generations of the same
     * money in the table (and `get_budget_projection`, which had no `snapshot_id` predicate, summed
     * both). It is now ONE `replace_erp_snapshot` statement (migration 0142). Record what it published
     * as this table's write, so every assertion below still observes the row that actually lands.
     */
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === 'replace_erp_snapshot') {
        inserts.push({ table: String(args.p_table), rows: (args.p_rows as Record<string, unknown>[]) ?? [] });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { client: client as unknown as SupabaseClient, inserts };
}

function orgBinding(config: Record<string, unknown>) {
  return {
    orgId: ORG,
    siteUrl: 'https://erp.example.test',
    secretRef: SECRET_REF,
    company: 'PMO Smoke Co',
    config,
    ownedDomains: ['budget'],
    versionMajor: 15,
  };
}

function snapshotRows(inserts: Insert[]): Record<string, unknown>[] {
  return inserts.filter((i) => i.table === 'erp_actuals_snapshot').flatMap((i) => i.rows);
}

Deno.test("NEW-1: the sweep passes the binding's project_map — a GL row's project lands as a real PMO project_id", async () => {
  const env = stubEnv();
  const net = stubFetch();
  try {
    const { client, inserts } = fakeDb([
      { project: 'PROJ-0001', cost_center: 'Main - PSC', account: '5100 - Direct Costs - PSC', fiscal_year: '2026', debit: 600000, credit: 0 },
    ]);
    const result = await refreshOrgAccountingLive(client, orgBinding({ project_map: { [PROJ_A]: 'PROJ-0001' } }));
    assert(!result.error, `expected a clean refresh, got: ${result.error}`);
    const rows = snapshotRows(inserts);
    assert(rows.length === 1, `expected 1 snapshot row, got ${rows.length}`);
    assert(
      rows[0].project_id === PROJ_A,
      `expected project_id ${PROJ_A} (the PMO project the binding maps 'PROJ-0001' to), got ${JSON.stringify(rows[0].project_id)} — ` +
        'a NULL here is the NEW-1 defect: get_budget_projection joins s.project_id = p_project_id and would report 0.00 actuals',
    );
    assert(rows[0].net === 600000, `expected net 600000, got ${JSON.stringify(rows[0].net)}`);
  } finally {
    net.restore();
    env.restore();
  }
});

Deno.test('NEW-1: two projects on the same account+fiscal year stay in SEPARATE snapshot rows', async () => {
  const env = stubEnv();
  const net = stubFetch();
  try {
    const { client, inserts } = fakeDb([
      { project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: '2026', debit: 100, credit: 0 },
      { project: 'PROJ-0002', cost_center: null, account: '5100', fiscal_year: '2026', debit: 40, credit: 0 },
    ]);
    await refreshOrgAccountingLive(client, orgBinding({ project_map: { [PROJ_A]: 'PROJ-0001', [PROJ_B]: 'PROJ-0002' } }));
    const rows = snapshotRows(inserts);
    assert(rows.length === 2, `expected 2 rows (one per project), got ${rows.length}`);
    const a = rows.find((r) => r.project_id === PROJ_A);
    const b = rows.find((r) => r.project_id === PROJ_B);
    assert(a?.net === 100, `expected PROJ_A net 100, got ${JSON.stringify(a?.net)}`);
    assert(b?.net === 40, `expected PROJ_B net 40, got ${JSON.stringify(b?.net)}`);
  } finally {
    net.restore();
    env.restore();
  }
});

Deno.test('NEW-1: a binding with NO project_map attributes nothing — it never guesses a project', async () => {
  const env = stubEnv();
  const net = stubFetch();
  try {
    const { client, inserts } = fakeDb([
      { project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: '2026', debit: 100, credit: 0 },
    ]);
    await refreshOrgAccountingLive(client, orgBinding({}));
    const rows = snapshotRows(inserts);
    assert(rows.length === 1 && rows[0].project_id === null, `expected an unattributed row, got ${JSON.stringify(rows[0])}`);
  } finally {
    net.restore();
    env.restore();
  }
});

/**
 * The undated fiscal year. `erp_actuals_snapshot.fiscal_year` is nullable (0101) and BOTH readers match
 * it by equality (`get_budget_projection` selects `s.fiscal_year = p_fiscal_year`;
 * `list_budget_fiscal_years` deliberately never OFFERS a null year), so a GL row whose fiscal year
 * ERPNext never stated is money that is invisible under EVERY year. PMO does not own the client's
 * fiscal calendar and must never invent a year for it — so the row keeps its honest NULL and the sweep
 * RAISES it to the org's Admin/Finance inbox. A visible gap beats a plausible guess.
 */
Deno.test('NEW-1: undated GL money is stored under its honest NULL year AND surfaced to an operator', async () => {
  const env = stubEnv();
  const net = stubFetch();
  try {
    const { client, inserts } = fakeDb(
      [
        { project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: '2026', debit: 100, credit: 0 },
        { project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: null, debit: 4200, credit: 0 },
      ],
      { profiles: [{ id: 'admin-1' }], notifications: [] },
    );
    await refreshOrgAccountingLive(client, orgBinding({ project_map: { [PROJ_A]: 'PROJ-0001' } }));
    // stored, never dropped, never folded into the dated bucket
    const rows = snapshotRows(inserts);
    const undated = rows.find((r) => r.fiscal_year === null);
    assert(undated?.net === 4200, `expected the undated money stored under a NULL year, got ${JSON.stringify(undated)}`);
    assert(rows.find((r) => r.fiscal_year === '2026')?.net === 100, 'the dated bucket must not absorb the undated money');
    // and raised to a human, because no screen can select it
    const notes = inserts.filter((i) => i.table === 'notifications').flatMap((i) => i.rows);
    assert(notes.length > 0, 'expected an action-required notification for the undated GL money');
    assert(
      notes.every((n) => (n.metadata as Record<string, unknown>)?.action_required === 'erp-actuals-undated-fiscal-year'),
      `expected the undated-fiscal-year reason, got ${JSON.stringify(notes.map((n) => n.metadata))}`,
    );
  } finally {
    net.restore();
    env.restore();
  }
});

Deno.test('NEW-1: no undated GL rows ⇒ no action-required notification (signal, not noise)', async () => {
  const env = stubEnv();
  const net = stubFetch();
  try {
    const { client, inserts } = fakeDb(
      [{ project: 'PROJ-0001', cost_center: null, account: '5100', fiscal_year: '2026', debit: 100, credit: 0 }],
      { profiles: [{ id: 'admin-1' }], notifications: [] },
    );
    await refreshOrgAccountingLive(client, orgBinding({ project_map: { [PROJ_A]: 'PROJ-0001' } }));
    const notes = inserts.filter((i) => i.table === 'notifications');
    assert(notes.length === 0, `expected no notification when every GL row states its year, got ${JSON.stringify(notes)}`);
  } finally {
    net.restore();
    env.restore();
  }
});
