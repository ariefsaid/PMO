/**
 * dispatchFactory.budgetRecovery.test.ts — ⚑ HIGH-1 (money-safety audit round 5): THE BUDGET UPSERT'S
 * FAILURE WINDOW MUST BE RECOVERABLE.
 *
 * FR-BUD-121's upsert routes a revision onto the grain's existing live Budget, and — because ERP locks
 * a Budget's money fields post-submit (spike §6) — that is `cancel(old) → create(new) → submit(new)`.
 * The pair is NOT atomic and cannot be made atomic (Frappe has no cross-document transaction, and the
 * duplicate guard refuses a create while the old document is still live, so create-then-cancel is not
 * available either). Two windows follow:
 *
 *   A. cancel OK, create FAILS  ⇒ ERPNext now holds ZERO live Budget for the grain: every overspend
 *      control is silently OFF. Before the upsert existed, a failed budget push left the OLD budget live
 *      and enforcing — benign. The upsert turned a benign failure into a DESTRUCTIVE one.
 *   B. create OK, submit FAILS  ⇒ an orphan DRAFT that a `docstatus = 1` grain read cannot see, and that
 *      ERPNext's own duplicate guard then uses to refuse EVERY future push for that grain.
 *
 * So the design goal is RECOVERABLE, not atomic:
 *   (i)   old cancelled + nothing on the grain      ⇒ a plain re-create is safe (ERP's duplicate guard
 *         does not fire against a tombstone) and must actually happen;
 *   (ii)  a DRAFT rival on the grain                ⇒ NAMED, operator-actionable refusal with ZERO
 *         writes — never a cancel that we already know ERP will refuse to replace;
 *   (iii) genuine ambiguity (>1 live)               ⇒ fail closed, zero writes (unchanged).
 *
 * These tests drive the REAL `resolveErpDispatchAdapter(...).commit(...)` against a STATEFUL fake bench
 * that models the ERP invariants the design leans on — the (company, project, fiscal_year) uniqueness
 * guard over `docstatus < 2`, docstatus transitions, and the list filter — so "the recovery works" is
 * asserted as OBSERVED ERP-SIDE STATE before and after, not as an intention.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory';
import { DOCTYPE_BODIES } from './doctypeBodies';

const MAP_ROWS = [
  { category: 'Labor', erp_account: 'Salary - PSC' },
  { category: 'Materials', erp_account: 'Cost of Goods Sold - PSC' },
];

const BINDING = {
  site_url: 'https://erp.example.com',
  version_major: 15,
  activated_at: '2026-07-11T00:00:00.000Z',
  config: { company: 'PMO Smoke Co', project_map: { 'proj-1': 'PROJ-0001' } },
};

function serviceClient(): DispatchServiceClient {
  return {
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () =>
            table === 'external_org_bindings' ? { data: BINDING, error: null } : { data: { org_id: 'org-1' }, error: null },
          then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
            resolve({ data: table === 'budget_category_account_map' ? MAP_ROWS : [], error: null }),
        };
        return chain;
      },
    }),
  } as unknown as DispatchServiceClient;
}

const VERSION_RECORD = {
  id: 'ver-2',
  erp_doc_kind: 'budget',
  projectId: 'proj-1',
  fiscal_year: '2026',
  line_items: [
    { category: 'Labor', budgeted_amount: '80000.00' },
    { category: 'Materials', budgeted_amount: '20000.00' },
  ],
};

// ────────────────────────────────────────────────────────────────────────────────────────────────
// A STATEFUL fake ERPNext `Budget` bench.
//
// It is stateful on purpose: the whole HIGH-1 question is "what does ERP HOLD after a mid-amend
// failure, and can the next attempt converge from there?", which a stub that answers each call in
// isolation cannot express. It models the three invariants the design depends on:
//   • the duplicate guard fires against any doc on the grain with `docstatus < 2` (live OR draft) —
//     which is precisely why an orphan draft poisons the grain;
//   • `docstatus` transitions 0 → 1 (submit) and → 2 (cancel), and a cancelled doc is a tombstone;
//   • the list endpoint filters server-side on the requested predicates.
// ────────────────────────────────────────────────────────────────────────────────────────────────
interface BudgetDoc {
  name: string;
  company: string;
  project: string;
  fiscal_year: string;
  docstatus: number;
  amended_from?: string;
  accounts?: unknown[];
  modified: string;
}

interface BenchFaults {
  /** Fail the create POST (a transient 5xx — the cancel-OK/create-FAIL window). */
  failCreate?: boolean;
  /** Fail the submit PUT (the create-OK/submit-FAIL window ⇒ an orphan draft). */
  failSubmit?: boolean;
}

function fakeBench(seed: BudgetDoc[] = [], faults: BenchFaults = {}) {
  const docs: BudgetDoc[] = seed.map((d) => ({ ...d }));
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  let seq = docs.length;

  const matches = (doc: BudgetDoc, filters: Array<[string, string, unknown]>): boolean =>
    filters.every(([field, op, value]) => {
      const actual = (doc as unknown as Record<string, unknown>)[field];
      if (op === '=') return String(actual) === String(value);
      if (op === '<') return Number(actual) < Number(value);
      if (op === '!=') return String(actual) !== String(value);
      /* c8 ignore next */
      throw new Error(`fake bench: unsupported filter operator ${op}`);
    });

  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const href = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, url: href, body });

    if (method === 'GET' && href.includes('filters=')) {
      const filters = JSON.parse(decodeURIComponent(new URL(href).searchParams.get('filters')!)) as Array<[string, string, unknown]>;
      const fields = new URL(href).searchParams.get('fields');
      const hit = docs.filter((d) => matches(d, filters));
      const projected = hit.map((d) =>
        fields
          ? Object.fromEntries((JSON.parse(decodeURIComponent(fields)) as string[]).map((f) => [f, (d as unknown as Record<string, unknown>)[f]]))
          : { name: d.name },
      );
      return new Response(JSON.stringify({ data: projected }), { status: 200 });
    }

    if (method === 'POST') {
      if (faults.failCreate) return new Response(JSON.stringify({ message: 'simulated ERP outage' }), { status: 503 });
      const b = body as unknown as BudgetDoc;
      // ⚑ ERPNext's own duplicate guard (spike §8): at most one Budget per grain across docstatus < 2 —
      // a DRAFT rival blocks a create exactly as a submitted one does. Atomic, server-side, 417.
      const rival = docs.find(
        (d) => d.company === b.company && d.project === b.project && d.fiscal_year === b.fiscal_year && d.docstatus < 2,
      );
      if (rival) {
        return new Response(
          JSON.stringify({ message: `DuplicateBudgetError: Another Budget record '${rival.name}' already exists` }),
          { status: 417 },
        );
      }
      seq += 1;
      const name = b.amended_from ? `${b.amended_from}-${seq}` : `BUDGET-2026-0000${seq}`;
      const created: BudgetDoc = { ...b, name, docstatus: 0, modified: '2026-07-22 10:00:00' };
      docs.push(created);
      return new Response(JSON.stringify({ data: created }), { status: 200 });
    }

    if (method === 'PUT') {
      const name = decodeURIComponent(href.split('/').pop()!);
      const doc = docs.find((d) => d.name === name)!;
      if (body?.docstatus === 1) {
        if (faults.failSubmit) return new Response(JSON.stringify({ message: 'simulated ERP outage' }), { status: 503 });
        doc.docstatus = 1;
      } else if (body?.docstatus === 2) {
        doc.docstatus = 2;
      }
      return new Response(JSON.stringify({ data: doc }), { status: 200 });
    }

    // single GET
    const name = decodeURIComponent(href.split('?')[0].split('/').pop()!);
    const doc = docs.find((d) => d.name === name);
    if (!doc) return new Response(JSON.stringify({ message: 'DoesNotExistError' }), { status: 404 });
    return new Response(JSON.stringify({ data: doc }), { status: 200 });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    docs,
    calls,
    /** What ERP HOLDS for the grain right now — the oracle every recovery assertion reads. */
    liveOnGrain: () => docs.filter((d) => d.docstatus === 1).map((d) => d.name),
    draftsOnGrain: () => docs.filter((d) => d.docstatus === 0).map((d) => d.name),
    writes: () => calls.filter((c) => c.method !== 'GET'),
  };
}

function budgetDoc(name: string, docstatus: number, amendedFrom?: string): BudgetDoc {
  return {
    name,
    company: 'PMO Smoke Co',
    project: 'PROJ-0001',
    fiscal_year: '2026',
    docstatus,
    modified: '2026-07-20 10:00:00',
    ...(amendedFrom ? { amended_from: amendedFrom } : {}),
  };
}

async function pushBudget(bench: ReturnType<typeof fakeBench>) {
  const adapter = await resolveErpDispatchAdapter({
    serviceClient: serviceClient(),
    orgId: 'org-1',
    command: { domain: 'budget', operation: 'create', record: VERSION_RECORD } as never,
    fetchImpl: bench.fetchImpl,
    apiKey: 'k',
    apiSecret: 's',
    doctypeBodies: DOCTYPE_BODIES,
  });
  return await adapter.commit({
    domain: 'budget',
    operation: 'create',
    record: VERSION_RECORD,
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
  } as never);
}

describe('⚑ HIGH-1 — the budget upsert leaves a RECOVERABLE failure window, never an unenforced grain', () => {
  it('AC-BUD-032 window A (cancel OK, create FAILS): the operator is told ERPNext is enforcing NO budget, and the failure stays RETRYABLE', async () => {
    const bench = fakeBench([budgetDoc('BUDGET-2026-00007', 1)], { failCreate: true });

    const err = await pushBudget(bench).catch((e: unknown) => e as Error & { code?: string }) as unknown as Error & { code?: string };

    // Retryable classification is what lets the outbox recover at all: the row stays `committing`,
    // quarantines, and the recovery claim re-drives it. A `commit-rejected` here would park it terminal.
    expect(err.code, 'a transient post-cancel failure must stay retryable').toBe('external-unreachable');
    // …and it must NAME the money consequence. "budget push failed" is not the same statement as
    // "the client's overspend control is currently OFF for PROJ-0001 / 2026".
    expect(err.message).toContain('BUDGET-2026-00007');
    expect(err.message.toLowerCase()).toContain('cancelled');
    expect(err.message.toLowerCase()).toMatch(/enforcing no budget|no live budget/);

    // ERP-side state BEFORE the recovery: the old doc is a tombstone and nothing replaced it.
    expect(bench.liveOnGrain()).toEqual([]);
    expect(bench.draftsOnGrain()).toEqual([]);
  });

  it('AC-BUD-032 window A RECOVERS: with the outage over, the very next push plainly RE-CREATES and submits (one live Budget, right figure)', async () => {
    const bench = fakeBench([budgetDoc('BUDGET-2026-00007', 1)], { failCreate: true });
    await pushBudget(bench).catch(() => undefined);
    expect(bench.liveOnGrain(), 'precondition: the grain is unenforced').toEqual([]);

    // The outage clears; the outbox re-drives the SAME command (a fresh factory resolution, exactly as
    // the sweep's recovery claim does).
    const healed = fakeBench(bench.docs, {});
    const result = await pushBudget(healed);

    expect(healed.liveOnGrain(), 'exactly ONE live Budget enforces the grain again').toHaveLength(1);
    expect(result.externalRecordId).toBe(healed.liveOnGrain()[0]);
    // The re-create is a PLAIN create — there is nothing left to cancel, and cancelling a tombstone
    // (or amending from one) would be nonsense.
    const created = healed.calls.find((c) => c.method === 'POST');
    expect(created!.body).not.toHaveProperty('amended_from');
    expect(healed.calls.some((c) => c.method === 'PUT' && c.body?.docstatus === 2), 'nothing to cancel').toBe(false);
    // The figure ERP now enforces is the REVISION's.
    expect((created!.body as { accounts: Array<{ account: string; budget_amount: string }> }).accounts).toEqual([
      { account: 'Salary - PSC', budget_amount: '80000.00' },
      { account: 'Cost of Goods Sold - PSC', budget_amount: '20000.00' },
    ]);
  });

  it('AC-BUD-033 window B (create OK, submit FAILS) leaves an orphan DRAFT — and the NEXT attempt refuses it BY NAME with ZERO writes, never a second cancel', async () => {
    const bench = fakeBench([budgetDoc('BUDGET-2026-00007', 1)], { failSubmit: true });
    await pushBudget(bench).catch(() => undefined);

    // The window B state: old cancelled, replacement stuck as a draft.
    expect(bench.liveOnGrain()).toEqual([]);
    expect(bench.draftsOnGrain()).toHaveLength(1);
    const orphan = bench.draftsOnGrain()[0];

    // ⚑ The retry must NOT walk into ERP's duplicate guard blind. A draft on the grain makes a create
    // CERTAIN to be refused, so attempting one (and, worse, cancelling something first) is a guaranteed
    // destructive act. Refuse before any write, and NAME the document a human has to deal with.
    const retryBench = fakeBench(bench.docs, {});
    const err = await pushBudget(retryBench).catch((e: unknown) => e as Error & { code?: string }) as unknown as Error & { code?: string };
    expect(err.code).toBe('budget-draft-rival-on-grain');
    expect(err.message).toContain(orphan);
    expect(retryBench.writes(), 'a blocked grain issues ZERO ERP writes').toEqual([]);
  });

  it('AC-BUD-033 a Desk-authored DRAFT on the grain refuses the push with zero writes — the live Budget it would have cancelled is left ENFORCING', async () => {
    // The pre-HIGH-1 code resolved `refs.self` from the live doc alone and cancelled it, and only THEN
    // discovered ERP would refuse the replacement because of the draft — leaving the grain unenforced
    // with certainty, not merely by bad luck.
    const bench = fakeBench([budgetDoc('BUDGET-2026-00007', 1), budgetDoc('BUDGET-DESK-WIP', 0)]);

    const err = await pushBudget(bench).catch((e: unknown) => e as Error & { code?: string }) as unknown as Error & { code?: string };

    expect(err.code).toBe('budget-draft-rival-on-grain');
    expect(err.message).toContain('BUDGET-DESK-WIP');
    expect(bench.writes(), 'zero writes').toEqual([]);
    expect(bench.liveOnGrain(), 'the live Budget still enforces — we never cancelled it').toEqual(['BUDGET-2026-00007']);
  });

  it('AC-BUD-031 (regression) an unoccupied grain still plainly creates, and an occupied one still amends — one live Budget either way', async () => {
    const fresh = fakeBench([]);
    await pushBudget(fresh);
    expect(fresh.liveOnGrain()).toHaveLength(1);
    expect(fresh.calls.find((c) => c.method === 'POST')!.body).not.toHaveProperty('amended_from');

    const occupied = fakeBench([budgetDoc('BUDGET-2026-00007', 1)]);
    const result = await pushBudget(occupied);
    expect(occupied.liveOnGrain(), 'the superseded doc is a tombstone; exactly one live Budget remains').toEqual([result.externalRecordId]);
    expect(occupied.docs.find((d) => d.name === 'BUDGET-2026-00007')!.docstatus).toBe(2);
    expect(occupied.calls.find((c) => c.method === 'POST')!.body).toMatchObject({ amended_from: 'BUDGET-2026-00007' });
  });

  it('AC-BUD-031 (regression) TWO live Budgets on one grain still fail CLOSED with zero writes', async () => {
    const bench = fakeBench([budgetDoc('BUDGET-2026-00007', 1), budgetDoc('BUDGET-2026-00008', 1)]);
    const err = await pushBudget(bench).catch((e: unknown) => e as Error & { code?: string }) as unknown as Error & { code?: string };
    expect(err.code).toBe('commit-rejected');
    expect(bench.writes()).toEqual([]);
  });

  it('AC-BUD-033 a CANCELLED tombstone on the grain is invisible to the resolution — it neither blocks nor becomes an upsert target', async () => {
    const bench = fakeBench([budgetDoc('BUDGET-2026-00007', 2)]);
    const result = await pushBudget(bench);
    expect(bench.liveOnGrain()).toEqual([result.externalRecordId]);
    expect(bench.calls.find((c) => c.method === 'POST')!.body).not.toHaveProperty('amended_from');
  });
});
