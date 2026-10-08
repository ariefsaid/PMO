/**
 * #916 [Deno] — the doctype walk is BOUNDED per tick: a document budget AND a whole-tick time budget,
 * with the per-doctype watermark (`external_sync_watermarks`) as the persisted cursor.
 *
 * The defect, end to end: `sweepOrgDoctypesLive` walked EVERY doctype's full modified-poll (page until
 * a short page, then apply every change) inside ONE invocation. On a bench holding a full year of
 * books (a few hundred documents) the tick hit the edge runtime's CPU hard limit ("CPU time hard
 * limit reached", HTTP 546) mid-pass — and a production sweep that dies mid-pass leaves actuals /
 * Paid status / receipts silently stale until someone notices.
 *
 * The fix shape (this file pins it): each doctype's poll lists at most a small page quantum per tick
 * and the WHOLE walk stops once the tick's document budget or elapsed-time budget is spent. The
 * watermark advanced after each bounded walk IS the resume cursor: the listing order is the TOTAL
 * order `modified asc, name asc` and the next tick filters `modified >= cursor` (INCLUSIVE), so an
 * interrupted walk resumes exactly where it stopped — no document skipped, none double-applied (the
 * per-row source-mod guard re-applies an equal stamp idempotently; every writer is an idempotent
 * upsert). The first sweep after a reset or a new binding (cursor NULL → full backfill, oldest
 * first) is therefore resumable by construction, not one pass.
 *
 * The kind under test is `employee` (registry order: the empty `Timesheet` walk first, then
 * `Employee`): its mapper pins the ERP name as the canonical id, so the `external_refs` claims are
 * per-document and the no-duplicates assertion actually bites, and it is a legitimate sweep ADOPTER
 * (the adopted Employee master, FR-TSP-090). (⚑ The `supplier`/`customer` mappers return
 * `id: 'placeholder'`, so the SWEEP-side adopt of a party collapses onto one external ref — a REAL
 * defect, but a DIFFERENT one (#916 is "only how much per tick", never what/how); these tests
 * deliberately do not build on it. Procurement kinds are likewise unusable here: a native
 * procurement doc is dispatch-owned by design (acked-and-skipped, never sweep-adopted).)
 *
 * These tests drive the SHIPPED handler (`sweepOrgDoctypesLive` from `./index.ts`) with a PAGED fake
 * ERP (it honors `filters`/`limit_start`/`limit_page_length` like real Frappe) and a STATEFUL fake
 * Supabase (watermarks persist across ticks; `external_refs` resolves, so a re-listed boundary doc
 * follows the idempotent UPDATE path, never a duplicate adopt) — the
 * `scripts/check-edge-fn-test-binding.mjs` pattern (shipped handler + mocked `globalThis.fetch`).
 *
 * Verify: deno test --config supabase/functions/erpnext-sweep/deno.json supabase/functions/erpnext-sweep/sweepTickBudget.test.ts
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { sweepOrgDoctypesLive, SWEEP_LIST_MAX_PAGES, SWEEP_TICK_MAX_DOCS, SWEEP_TICK_TIME_BUDGET_MS } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OURS = 'PMO Smoke Co';
const SECRET_REF = 'tick-budget-bench';

function stubEnv() {
  const original = Deno.env.get;
  const values: Record<string, string> = { TICK_BUDGET_BENCH_KEY: 'k', TICK_BUDGET_BENCH_SECRET: 's' };
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = (k: string) => values[k];
  return { restore: () => { (Deno.env as unknown as { get: unknown }).get = original; } };
}

function orgBinding(ownedDomains: string[]) {
  return {
    orgId: ORG,
    siteUrl: 'https://erp.example.test',
    secretRef: SECRET_REF,
    company: OURS,
    config: {},
    ownedDomains,
    versionMajor: 15,
  };
}

/** Frappe `modified` string, `secondsFromBase` seconds after 2025-01-01 UTC. Uniform
 *  `YYYY-MM-DD HH:MM:SS` so lexicographic order == chronological order (what the poll relies on). */
function frappeModified(secondsFromBase: number): string {
  const d = new Date(Date.UTC(2025, 0, 1, 0, 0, secondsFromBase));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

interface ListRequest { doctype: string; limitStart: number; pageLength: number }

/** A Frappe-shaped fake ERP: filters each doctype's master list (`modified >=` / scalar `=`), then
 *  slices it by `limit_start`/`limit_page_length` — paging works ONLY if the caller pages honestly.
 *  `onPage` fires after each served page (the injected-clock hook for the time-budget test). */
function stubErpPages(
  docsByDoctype: Record<string, Array<Record<string, unknown>>>,
  onPage?: (doctype: string) => void,
) {
  const original = globalThis.fetch;
  const requests: ListRequest[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const path = url.split('/api/resource/')[1] ?? '';
    const [doctypePart, query] = path.split('?');
    const doctype = decodeURIComponent(doctypePart);
    if (query === undefined) {
      // A full-doc GET (the child-table hydrate path) — not exercised by these kinds.
      return Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    }
    const params = new URLSearchParams(query);
    const pageLength = Number(params.get('limit_page_length') ?? 500);
    const limitStart = Number(params.get('limit_start') ?? 0);
    let rows = docsByDoctype[doctype] ?? [];
    const filters = JSON.parse(params.get('filters') ?? '[]') as Array<[string, string, string]>;
    for (const [field, op, value] of filters) {
      if (op === '>=' && field === 'modified') rows = rows.filter((r) => String(r.modified) >= String(value));
      else if (op === '=') rows = rows.filter((r) => String(r[field]) === String(value));
      else rows = [];
    }
    requests.push({ doctype, limitStart, pageLength });
    onPage?.(doctype);
    return Promise.resolve(
      new Response(JSON.stringify({ data: rows.slice(limitStart, limitStart + pageLength) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return {
    requests,
    of: (doctype: string) => requests.filter((r) => r.doctype === doctype),
    restore: () => { globalThis.fetch = original; },
  };
}

/** A STATEFUL Supabase stand-in: `external_sync_watermarks` persists across ticks (the cursor store
 *  under test — cursor AND the `updated_at` recency stamp the fair-order read sorts by),
 *  `external_refs` resolves an upserted mapping (so a re-listed boundary doc applies as an UPDATE,
 *  never a duplicate adopt), and every claim is recorded for the no-duplicates proof. */
function statefulFakeDb() {
  const watermarks = new Map<string, string | null>();
  // Recency stamps: a strictly-increasing value per upsert (real clocks can tie two upserts inside
  // one tick; the ORDER between ticks is what the fair-order test pins, not the wall time).
  let stampSeq = 0;
  const wmUpdatedAt = new Map<string, string>();
  const refsByExternal = new Map<string, string>();
  const refUpserts: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const b: any = { cols: {} as Record<string, string>, inDomains: null as string[] | null };
      b.select = () => b;
      b.eq = (col: string, val: string | number) => { b.cols[col] = String(val); return b; };
      b.in = (col: string, vals: unknown[]) => { if (col === 'domain') b.inDomains = vals.map(String); return b; };
      b.is = () => b;
      b.not = () => b;
      b.order = () => b;
      b.contains = () => b;
      b.gt = () => b;
      b.lt = () => b;
      b.ilike = () => b;
      b.insert = () => Promise.resolve({ data: null, error: null });
      b.update = () => b;
      b.upsert = (payload: unknown) => {
        if (table === 'external_sync_watermarks') {
          const p = payload as { domain: string; watermark_cursor: string | null };
          watermarks.set(p.domain, p.watermark_cursor);
          wmUpdatedAt.set(p.domain, new Date(Date.UTC(2026, 0, 1, 0, 0, stampSeq++)).toISOString());
        }
        if (table === 'external_refs') {
          const p = payload as { domain: string; external_record_id: string; pmo_record_id: string };
          refUpserts.push(payload as Record<string, unknown>);
          refsByExternal.set(`${p.domain}\u0000${p.external_record_id}`, p.pmo_record_id);
        }
        return Promise.resolve({ data: null, error: null });
      };
      b.limit = () => Promise.resolve({ data: [], error: null });
      b.maybeSingle = () => {
        if (table === 'external_sync_watermarks') {
          const domain = b.cols.domain;
          const row = domain !== undefined && watermarks.has(domain)
            ? { watermark_cursor: watermarks.get(domain) }
            : null;
          return Promise.resolve({ data: row, error: null });
        }
        if (table === 'external_refs') {
          const pmo = refsByExternal.get(`${b.cols.domain}\u0000${b.cols.external_record_id}`);
          return Promise.resolve({ data: pmo !== undefined ? { pmo_record_id: pmo } : null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      b.then = (resolve: (v: unknown) => void) => {
        if (table === 'external_sync_watermarks') {
          // The LIST-shaped read (the fair-order recency load — the per-doctype cursor read goes
          // through `maybeSingle` above): serve domain + updated_at for the requested domains.
          const rows = [...wmUpdatedAt.entries()]
            .filter(([domain]) => b.inDomains === null || b.inDomains.includes(domain))
            .map(([domain, updated_at]) => ({ domain, updated_at }));
          resolve({ data: rows, error: null });
          return;
        }
        resolve({ data: [], error: null });
      };
      return b;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { client: client as unknown as SupabaseClient, watermarks, refUpserts };
}

const employeeDoc = (i: number) => ({
  name: `EMP-${String(i + 1).padStart(6, '0')}`,
  employee_name: `Worker ${i + 1}`,
  prefered_email: `worker${i + 1}@example.test`,
  user_id: null,
  status: 'Active',
  company: OURS,
  modified: frappeModified(i),
  docstatus: 1,
  amended_from: null,
});

/** A Timesheet-shaped list row: the mapper reads only tolerant fields, and `company` is what the
 *  company-scoped poll's per-row admission gate reads. A native Timesheet is never ADOPTED
 *  (FR-TSP-082 acks it) — but listing it is real work the tick pays for. */
const timesheetDoc = (i: number) => ({
  name: `TS-${String(i + 1).padStart(6, '0')}`,
  company: OURS,
  total_hours: '2.00',
  total_costing_amount: '100.00',
  modified: frappeModified(i),
  docstatus: 1,
  amended_from: null,
});

/** A Desk-created Budget row: never adopted (FR-BUD-140 acks it) — but it IS work the poll must
 *  REACH: the doctype walks, lists it, and advances its watermark past it. */
const deskBudgetDoc = (name: string, modified: string) => ({
  name,
  company: OURS,
  fiscal_year: '2026',
  modified,
  docstatus: 1,
  amended_from: null,
});

// ── The bounding test: more documents than the per-tick budget ─────────────────────────────────────

Deno.test('#916: tick 1 stops at the doc budget and persists a cursor; tick 2 resumes and finishes; union = full set, no duplicates', async () => {
  const TOTAL = 1100; // > the default per-doctype listing quantum (2 pages × 500)
  const docs = Array.from({ length: TOTAL }, (_, i) => employeeDoc(i));
  const db = statefulFakeDb();
  const env = stubEnv();
  const erp = stubErpPages({ Employee: docs });
  try {
    // Tick 1 — the fresh-org backfill (cursor NULL, oldest first) stops at the budget.
    const tick1 = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets']));
    assert(tick1.error === undefined, `a budget stop is normal operation, not a sweep error: ${tick1.error}`);
    assert(
      erp.of('Employee').length === 2,
      `tick 1 must stop at the per-doctype listing quantum (2 pages of 500), fetched ${erp.of('Employee').length} pages`,
    );
    assert(tick1.applied === 1000, `tick 1 applied ${tick1.applied}, expected exactly the 1000-doc budget`);
    assert(
      db.watermarks.get('timesheets::Employee') === docs[999].modified,
      `the persisted cursor must be the max modified SEEN (doc #1000), not the tail — got ${JSON.stringify(db.watermarks.get('timesheets::Employee'))}`,
    );

    // Tick 2 — resumes EXACTLY at the inclusive boundary: the boundary doc re-lists (idempotent), the
    // remaining 100 apply, and the doctype DRAINS on a short page.
    const employeePagesBefore = erp.of('Employee').length;
    const tick2 = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets']));
    assert(tick2.error === undefined, `tick 2 must be clean: ${tick2.error}`);
    assert(tick2.applied === 101, `tick 2 applied ${tick2.applied}, expected 101 (boundary re-apply + 100 remaining)`);
    assert(
      erp.of('Employee').length - employeePagesBefore === 1,
      'tick 2 drains the remainder on ONE short page (the cursor really was persisted — a lost cursor would re-list from doc #1)',
    );
    assert(
      db.watermarks.get('timesheets::Employee') === docs[TOTAL - 1].modified,
      'the cursor must now sit at the true tail of the doctype',
    );

    // Tick 3 — steady state: only the inclusive boundary doc re-lists; nothing new, nothing duplicated.
    const tick3 = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets']));
    assert(tick3.applied === 1, `tick 3 must re-apply ONLY the inclusive boundary doc, applied ${tick3.applied}`);

    // THE INVARIANT: every document adopted exactly once — the union is the full set, no duplicates.
    assert(db.refUpserts.length === TOTAL, `expected exactly ${TOTAL} external_refs claims, got ${db.refUpserts.length}`);
    const distinct = new Set(db.refUpserts.map((r) => r.external_record_id));
    assert(distinct.size === TOTAL, `expected ${TOTAL} DISTINCT claimed documents, got ${distinct.size} (a duplicate is a double-apply)`);
  } finally {
    erp.restore();
    env.restore();
  }
});

// ── The tick document budget, distinct from the per-doctype page quantum ──────────────────────

Deno.test('#916: the tick DOCUMENT budget (not the page quantum) stops the walk before the next doctype', async () => {
  // Employee holds 600 docs = two pages (500 + short 100) — WITHIN the per-doctype page quantum
  // (2 pages), so ONLY the tick-level document budget can explain the next doctype being skipped.
  // Registry order walks Timesheet → Employee → Budget, so Budget is the doctype the spent budget skips.
  const db = statefulFakeDb();
  const env = stubEnv();
  const docs = Array.from({ length: 600 }, (_, i) => employeeDoc(i));
  const erp = stubErpPages({ Employee: docs });
  const opts = { nowMs: () => 0, tickStartMs: 0, tickTimeBudgetMs: 60_000, tickMaxDocs: 500 };
  try {
    const tick1 = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets', 'budget']), undefined, opts);
    assert(tick1.error === undefined, `tick 1 must be clean: ${tick1.error}`);
    assert(erp.of('Employee').length === 2, 'Employee walks its full (2-page) quantum: 600 docs');
    assert(tick1.applied === 600, `tick 1 applies all 600: ${tick1.applied}`);
    assert(erp.of('Budget').length === 0, 'the spent tick doc budget (600 ≥ 500) must stop the walk before Budget');

    // Next tick: the budget is fresh — the skipped doctype gets its walk.
    const tick2 = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets', 'budget']), undefined, opts);
    assert(tick2.error === undefined, `tick 2 must be clean: ${tick2.error}`);
    assert(erp.of('Budget').length >= 1, 'the skipped doctype is walked on the next tick — nothing is skipped permanently');
  } finally {
    erp.restore();
    env.restore();
  }
});

// ── The time-budget test: an exhausted whole-tick budget stops the walk ────────────────────────────

Deno.test('#916: an exhausted whole-tick time budget stops the walk; the skipped doctype resumes next tick', async () => {
  const db = statefulFakeDb();
  const env = stubEnv();
  // The injected clock (the `nowMs: number = Date.now()` default-param pattern): the first served
  // page trips it past the budget. Registry order walks `Timesheet` (empty here) first, so it
  // completes its walk harmlessly — and `Employee`, with a pending document, must be left for the
  // next tick.
  let clockMs = 0;
  let tripped = false;
  const empModified = frappeModified(31_536_000);
  const erp = stubErpPages(
    {
      Employee: [{
        name: 'EMP-000001', employee_name: 'Worker 1', prefered_email: 'worker1@example.test',
        user_id: null, status: 'Active', company: OURS, modified: empModified, docstatus: 1, amended_from: null,
      }],
    },
    () => {
      if (!tripped) {
        tripped = true;
        clockMs = 25_000;
      }
    },
  );
  try {
    const tick1 = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets']), undefined, {
      nowMs: () => clockMs,
      tickStartMs: 0,
      tickTimeBudgetMs: 5_000,
    });
    assert(tick1.error === undefined, `a budget stop is normal operation, not a sweep error: ${tick1.error}`);
    assert(erp.of('Timesheet').length === 1, 'the first doctype (Timesheet) walks within the budget');
    assert(tick1.applied === 0, 'the first doctype lists no changes and completes its walk harmlessly');
    assert(erp.of('Employee').length === 0, 'the exhausted time budget must stop the walk before the next doctype');
    assert(
      db.watermarks.get('timesheets::Employee') === undefined,
      'the skipped doctype must be left byte-for-byte (its cursor untouched) for the next tick',
    );

    // Next tick — the clock is back within budget: the skipped doctype resumes and finishes.
    clockMs = 0;
    const tick2 = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets']), undefined, {
      nowMs: () => clockMs,
      tickStartMs: 0,
      tickTimeBudgetMs: 5_000,
    });
    assert(tick2.error === undefined, `tick 2 must be clean: ${tick2.error}`);
    assert(tick2.applied === 1, `tick 2 adopts the skipped doctype's pending document, got ${tick2.applied}`);
    assert(
      db.watermarks.get('timesheets::Employee') === empModified,
      'the skipped doctype resumed and persisted its own cursor — nothing is skipped permanently',
    );
  } finally {
    erp.restore();
    env.restore();
  }
});

// ── The shipped budget VALUES (nothing type-checks their relationship — the money-path-primer rule) ─

Deno.test('#916: a repeatedly halted 3000-row doctype yields to a healthy sibling by tick 2', async () => {
  const backlog = Array.from({ length: 3000 }, (_, i) => timesheetDoc(i));
  const db = statefulFakeDb();
  const env = stubEnv();
  let activeDoctype = '';
  const erp = stubErpPages({ Timesheet: backlog, Employee: [employeeDoc(0)] }, (doctype) => { activeDoctype = doctype; });
  const originalFrom = db.client.from.bind(db.client);
  (db.client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
    if (table === 'external_ref_lineage' && activeDoctype === 'Timesheet') {
      // deno-lint-ignore no-explicit-any
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.limit = () => Promise.resolve({ data: null, error: { message: 'transient failure', code: '08006' } });
      return b;
    }
    return originalFrom(table);
  };
  try {
    const opts = { nowMs: () => 0, tickStartMs: 0, tickTimeBudgetMs: 60_000, tickMaxDocs: 1000 };
    const first = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets']), undefined, opts);
    assert(!!first.error, 'the first doctype attempt should report its persistent apply failure');
    assert(erp.of('Employee').length === 0, 'the listed backlog consumes the first tick budget');
    const second = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets']), undefined, opts);
    assert(erp.of('Employee').length > 0, 'the healthy Employee doctype runs by tick 2 instead of being starved');
    assert(!!second.error, 'the failed Timesheet is still surfaced when it gets its later turn');
  } finally {
    erp.restore();
    env.restore();
  }
});

Deno.test('#916: the shipped tick budgets are coherent and well under the edge CPU limit', () => {
  assert(SWEEP_LIST_MAX_PAGES === 2, `the per-doctype listing quantum is 2 pages (≤1000 docs), got ${SWEEP_LIST_MAX_PAGES}`);
  assert(
    SWEEP_TICK_MAX_DOCS === 1_000,
    `the tick document budget equals one doctype's quantum (1000) — a walk never stops mid-doctype for the doc budget, got ${SWEEP_TICK_MAX_DOCS}`,
  );
  assert(
    SWEEP_TICK_TIME_BUDGET_MS === 20_000 && SWEEP_TICK_TIME_BUDGET_MS < 60_000,
    `the whole-tick wall-clock budget is 20s — far under any CPU hard limit, got ${SWEEP_TICK_TIME_BUDGET_MS}`,
  );
});

// ── #916 fix round: the budget counts rows LISTED, not rows APPLIED ───────────────────────────────

Deno.test('#916: a failing apply still consumes the tick budget (the walk counts LISTED rows, not applied outcomes)', async () => {
  // 600 Timesheet docs LIST (two pages, within the per-doctype quantum) but the apply HALTS on the
  // FIRST change (the superseded-name lineage read — the apply's first DB touch — fails transiently,
  // the same shape sweepWedge proves halts). Counting only SUCCESSFULLY APPLIED rows leaves the
  // tick's document budget at zero for that doctype and lets the walk continue to Employee/Budget —
  // the tick pays twice for work it already did. The 600 LISTED rows alone must spend the 500 budget.
  const docs = Array.from({ length: 600 }, (_, i) => timesheetDoc(i));
  const db = statefulFakeDb();
  const env = stubEnv();
  const erp = stubErpPages({
    Timesheet: docs,
    Employee: [employeeDoc(0)],
    Budget: [deskBudgetDoc('BUDGET-DESK-009', frappeModified(31_536_000))],
  });
  // The transient apply failure: the lineage read errors for EVERY change (halt — not an ack).
  const originalFrom = db.client.from.bind(db.client);
  (db.client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
    if (table === 'external_ref_lineage') {
      // deno-lint-ignore no-explicit-any
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.limit = () => Promise.resolve({ data: null, error: { message: 'connection terminated', code: '08006' } });
      return b;
    }
    return originalFrom(table);
  };
  const opts = { nowMs: () => 0, tickStartMs: 0, tickTimeBudgetMs: 60_000, tickMaxDocs: 500 };
  try {
    const tick = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets', 'budget']), undefined, opts);
    assert(!!tick.error, `the transient apply failure must surface as a sweep error (halt), got ${JSON.stringify(tick)}`);
    assert(tick.applied === 0, `nothing applied — the first apply halted, got ${tick.applied}`);
    assert(
      erp.of('Employee').length === 0,
      `the failed doctype LISTED 600 rows — the 500 budget is spent and Employee must NOT walk this tick (walked ${erp.of('Employee').length} pages)`,
    );
    assert(
      erp.of('Budget').length === 0,
      `Budget must NOT walk this tick either (walked ${erp.of('Budget').length} pages)`,
    );
  } finally {
    erp.restore();
    env.restore();
  }
});

// ── #916 fix round: FAIR doctype order across ticks (a busy doctype cannot starve its siblings) ────

Deno.test('#916: a doctype the budget keeps skipping is walked FIRST once its siblings have run (least-recently-completed order)', async () => {
  // Timesheet holds a backlog wider than three ticks (3000 docs = 1000 listed/tick — every doc is
  // acked-and-skipped, FR-TSP-082, so the backlog never drains and the watermark ALWAYS advances).
  // Budget holds ONE doc. Registry order restarts at Timesheet every tick and stops at the spent
  // budget: Budget would NEVER run. The fix orders each tick's doctypes least-recently-completed
  // first — by their `external_sync_watermarks.updated_at` asc, never-run first — so tick 2 gives
  // Budget (and the never-run Employee) the walk before the just-swept Timesheet.
  const backlog = Array.from({ length: 3000 }, (_, i) => timesheetDoc(i));
  const budgetModified = frappeModified(31_536_000);
  const db = statefulFakeDb();
  const env = stubEnv();
  const erp = stubErpPages({ Timesheet: backlog, Budget: [deskBudgetDoc('BUDGET-DESK-001', budgetModified)] });
  try {
    // Tick 1 — every doctype never-run: registry order (stable), so Timesheet walks first and spends
    // the whole doc budget; Budget (registry-last) is skipped. This is the OLD behavior and stays true.
    const tick1 = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets', 'budget']));
    assert(tick1.error === undefined, `tick 1 must be clean: ${tick1.error}`);
    assert(erp.of('Budget').length === 0, 'tick 1: Budget (registry-last) is skipped behind the busy Timesheet');
    assert(
      db.watermarks.has('timesheets::Timesheet'),
      'tick 1: the Timesheet watermark advanced (its recency stamp is now the freshest)',
    );

    // Tick 2 — Timesheet completed most recently; Budget and Employee NEVER ran: they must go first.
    const tick2 = await sweepOrgDoctypesLive(db.client, orgBinding(['timesheets', 'budget']));
    assert(tick2.error === undefined, `tick 2 must be clean: ${tick2.error}`);
    assert(
      erp.of('Budget').length >= 1,
      `STARVATION: the always-busy first doctype must not starve Budget — by tick 2 the never-run Budget walk must run (walked ${erp.of('Budget').length} pages)`,
    );
    assert(
      db.watermarks.get('budget::Budget') === budgetModified,
      `tick 2: Budget completed its walk and persisted its own cursor, got ${JSON.stringify(db.watermarks.get('budget::Budget'))}`,
    );
  } finally {
    erp.restore();
    env.restore();
  }
});
