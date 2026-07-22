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

/**
 * @param mirrorBudgetName what `budget_version_erp_mirror.erp_budget_name` records for this version —
 *   i.e. the ERP `Budget` PMO's own last push produced. MED-1 uses it as the OWNERSHIP PROOF for an
 *   orphan draft. `null` models a version PMO has never successfully pushed.
 */
function serviceClient(mirrorBudgetName: string | null = null): DispatchServiceClient {
  return {
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () =>
            table === 'external_org_bindings'
              ? { data: BINDING, error: null }
              : table === 'budget_version_erp_mirror'
                ? { data: mirrorBudgetName ? { erp_budget_name: mirrorBudgetName } : null, error: null }
                : { data: { org_id: 'org-1' }, error: null },
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
/**
 * The ERPNext user PMO's own API credentials authenticate as — what
 * `GET /api/method/frappe.auth.get_logged_user` returns on the bench for our key/secret pair, and
 * therefore the `owner` stamped on every document PMO itself creates. ⚑ LOW-1: this is the ONLY fact
 * that distinguishes a draft PMO authored from a draft a human authored in the Desk.
 */
const INTEGRATION_USER = 'pmo-integration@erp.example.com';
/** A human accountant working in the ERPNext Desk — never PMO. */
const DESK_USER = 'accountant@client.test';

interface BudgetDoc {
  name: string;
  company: string;
  project: string;
  fiscal_year: string;
  docstatus: number;
  /** Frappe stamps the authenticated user on every document at creation; it is not client-settable. */
  owner: string;
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
  let childSeq = 0;
  /** Frappe's server-generated `Budget Account` row name (a 10-char hash — never client-settable). */
  const childName = () => `ba${(childSeq += 1).toString().padStart(8, '0')}`;

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

    // Frappe's "who am I" RPC — the identity PMO's credentials authenticate as (LOW-1's ownership proof).
    if (href.includes('/api/method/frappe.auth.get_logged_user')) {
      return new Response(JSON.stringify({ message: INTEGRATION_USER }), { status: 200 });
    }

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
      // ⚑ ROUND 7, LIVE-BENCH-VERIFIED (frappe 15.96.0 / erpnext 15.94.3): Frappe generates each child
      // row's own `name` server-side on insert — a client never supplies one, and the spike's §10(g)
      // claim that a bare `{account, budget_amount}` child 404s could not be reproduced in any of five
      // request shapes (the spike has since been corrected). Modelling the child rows AT ALL is the
      // round-7 lesson: while this handler discarded them, the one ERP-side fact that decides whether a
      // client is protected — what ERPNext actually ends up ENFORCING — was unobservable, and every
      // assertion about it could only inspect the outgoing request. `enforcedAmounts` reads this.
      // ⚑ Built into a NEW array — never mutate `b`, which is the very object recorded in `calls` and
      // read back by the request-shape assertions.
      const storedAccounts = (b.accounts ?? []).map((row) => ({ ...(row as object), name: childName() }));
      // `owner` is SERVER-stamped from the authenticated session, never taken from the body — so a doc
      // this bench creates for PMO is owned by PMO, exactly as the real bench behaves.
      const created: BudgetDoc = {
        ...b,
        name,
        docstatus: 0,
        owner: INTEGRATION_USER,
        accounts: storedAccounts,
        modified: '2026-07-22 10:00:00',
      };
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
    /**
     * The figures ERPNext would actually ENFORCE for a document — read from bench state AFTER the
     * write, never from the request that asked for it. A request body only says what PMO intended.
     */
    enforcedAmounts: (name: string) =>
      ((docs.find((d) => d.name === name)?.accounts ?? []) as Array<{ account: string; budget_amount: string }>).map(
        ({ account, budget_amount }) => ({ account, budget_amount }),
      ),
    draftsOnGrain: () => docs.filter((d) => d.docstatus === 0).map((d) => d.name),
    writes: () => calls.filter((c) => c.method !== 'GET'),
  };
}

function budgetDoc(name: string, docstatus: number, amendedFrom?: string, owner: string = INTEGRATION_USER): BudgetDoc {
  return {
    name,
    company: 'PMO Smoke Co',
    project: 'PROJ-0001',
    fiscal_year: '2026',
    docstatus,
    owner,
    modified: '2026-07-20 10:00:00',
    ...(amendedFrom ? { amended_from: amendedFrom } : {}),
  };
}

async function pushBudget(
  bench: ReturnType<typeof fakeBench>,
  mirrorBudgetName: string | null = null,
  record: Record<string, unknown> = VERSION_RECORD,
) {
  const adapter = await resolveErpDispatchAdapter({
    serviceClient: serviceClient(mirrorBudgetName),
    orgId: 'org-1',
    command: { domain: 'budget', operation: 'create', record } as never,
    fetchImpl: bench.fetchImpl,
    apiKey: 'k',
    apiSecret: 's',
    doctypeBodies: DOCTYPE_BODIES,
  });
  return await adapter.commit({
    domain: 'budget',
    operation: 'create',
    record,
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
    // ⚑ ROUND 7 — read the BENCH, not the request. A request body only says what PMO asked for; the
    // question that decides whether a client is protected is what ERPNext ends up ENFORCING. The fake's
    // PUT/POST handlers used to ignore `accounts` entirely, so this could not be asserted anywhere.
    expect(
      occupied.enforcedAmounts(result.externalRecordId),
      'the replacement ERPNext now enforces carries the current figures',
    ).toEqual([
      { account: 'Salary - PSC', budget_amount: '80000.00' },
      { account: 'Cost of Goods Sold - PSC', budget_amount: '20000.00' },
    ]);
  });

  /**
   * ⚑ ROUND 7 REGRESSION GUARD. The one child-row failure mode that reproduces on the live bench is a
   * client-supplied child `name` matching no existing row: the PUT returns 200 and the SUBMIT then
   * raises a raw, unclassifiable 500. PMO is safe from it structurally — `budgetToBody` emits bare
   * `{account, budget_amount}` rows and lets Frappe generate the names — and that property is worth
   * pinning, because the round-7 audit very nearly had us start round-tripping child names on the
   * strength of a spike finding that turned out to be unreproducible. Round-tripping names is the only
   * way our own code could reach that 500, so this test makes that route go red.
   */
  it('round-7 PMO never sends a child-row `name` — the one shape that can 500 on submit stays unreachable', async () => {
    const occupied = fakeBench([budgetDoc('BUDGET-2026-00007', 1)]);
    await pushBudget(occupied);

    const childRows = occupied.calls
      .filter((c) => Array.isArray((c.body as { accounts?: unknown[] } | undefined)?.accounts))
      .flatMap((c) => (c.body as { accounts: Array<Record<string, unknown>> }).accounts);
    expect(childRows.length, 'the push really did carry child rows').toBeGreaterThan(0);
    for (const row of childRows) {
      expect(Object.keys(row).sort(), 'a child row is exactly {account, budget_amount} — never a `name`').toEqual([
        'account',
        'budget_amount',
      ]);
    }
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

/**
 * ⚑ ROUND 7 RULING — AUTO-ADOPTION OF AN ORPHAN DRAFT IS GONE. EVERY draft on the grain is refused.
 *
 * Round 6 added a branch that adopted a lone draft when `amended_from` matched the ERP `Budget` name
 * recorded on our own mirror row, intending to recover window B (create OK, submit FAILS) without a
 * human. Round 7 established two things that together retire it:
 *
 *  1. **The case it was BUILT for is unreachable.** `budget_version_erp_mirror.erp_budget_name` has
 *     exactly ONE writer — the SUCCESS path (`readModelWriters.ts`) — and `activate_budget_version`
 *     admits only a Draft version (`0005`/`0139`), so a version is activated once, pushed under one
 *     idempotency key, and its mirror row carries a name only AFTER a push succeeded. In window B the
 *     push did NOT succeed, so the name is null and the branch cannot fire.
 *  2. **The only case it COULD fire on was the destructive one.** A Desk user who cancels our
 *     successfully-pushed Budget (name recorded) and hand-starts its amendment produces a draft whose
 *     `amended_from` IS that name — so PMO would PUT its own figures over the accountant's work and
 *     submit it. Live-bench-verified: both calls return 200. `amended_from` identifies a draft's
 *     PARENT and never its AUTHOR.
 *
 * So the branch was structurally incapable of recovering anything, and its one reachable path was the
 * one FR-BUD-142 forbids outright. Round 5's position stands and is money-safe: window B ends in a
 * NAMED, operator-actionable refusal (`budget-draft-rival-on-grain`) that tells the human which
 * document to submit or delete — never silence, and never a write onto somebody else's document.
 *
 * These tests are the guard against re-adding it. See `resolveBudgetRefs` for what a real automatic
 * recovery would require.
 */
describe('⚑ round 7 — every DRAFT on the grain is refused by name, whoever authored it', () => {
  const OLD = 'BUDGET-2026-00007';

  /** Drives window B to completion: cancel(OLD) → create(replacement) → submit FAILS. */
  async function strandOrphan() {
    const bench = fakeBench([budgetDoc(OLD, 1)], { failSubmit: true });
    await pushBudget(bench, OLD).catch(() => undefined);
    expect(bench.liveOnGrain(), 'precondition: ERPNext is enforcing NO budget').toEqual([]);
    expect(bench.draftsOnGrain()).toHaveLength(1);
    return bench;
  }

  it('round-7 our OWN window-B orphan is refused BY NAME with zero writes — auto-adoption is not attempted', async () => {
    const stranded = await strandOrphan();
    const orphan = stranded.draftsOnGrain()[0];

    const retry = fakeBench(stranded.docs, {});
    const err = (await pushBudget(retry, OLD).catch((e: unknown) => e)) as Error & { code?: string };

    expect(err.code, 'the named, operator-actionable refusal — never a silent strand').toBe('budget-draft-rival-on-grain');
    expect(err.message, 'it names the document the human must submit or delete').toContain(orphan);
    expect(
      err.message.toLowerCase(),
      'and it says the money part out loud: nothing is being enforced right now',
    ).toMatch(/no live budget|enforcing no/);
    expect(retry.writes(), 'a blocked grain issues ZERO ERP writes').toEqual([]);
    expect(retry.docs.find((d) => d.name === orphan)!.docstatus, 'the draft is left exactly as it was').toBe(0);
  });

  /**
   * ⚑ THE GUARD THAT MATTERS MOST if anyone revisits automatic recovery. `amended_from` proves a
   * draft's PARENT, never its AUTHOR — so it is not, and never was, an ownership proof. A future
   * recovery must additionally prove authorship (the draft's server-stamped `owner` is the integration
   * user PMO's credentials authenticate as, readable in the same grain list query). This scenario is
   * the one that would silently overwrite an accountant's work if that were forgotten.
   */
  it('LOW-1 a DESK author\'s amendment of OUR OWN Budget is refused — `amended_from` proves the parent, never the author', async () => {
    const bench = fakeBench([budgetDoc(`${OLD}-2`, 0, OLD, DESK_USER)]);

    const err = (await pushBudget(bench, OLD).catch((e: unknown) => e)) as Error & { code?: string };

    expect(err.code).toBe('budget-draft-rival-on-grain');
    expect(err.message, 'the operator is told WHICH document blocks them').toContain(`${OLD}-2`);
    expect(bench.writes(), "the accountant's draft is never written to").toEqual([]);
    // The decisive oracle: their work survives untouched and unsubmitted, with THEIR figures.
    expect(bench.docs.find((d) => d.name === `${OLD}-2`)!.docstatus, 'never submitted on their behalf').toBe(0);
  });

  it("round-7 a Desk author's WIP draft (no lineage at all) is refused with zero writes", async () => {
    const bench = fakeBench([budgetDoc('BUDGET-DESK-WIP', 0, undefined, DESK_USER)]);
    const err = (await pushBudget(bench, OLD).catch((e: unknown) => e)) as Error & { code?: string };
    expect(err.code).toBe('budget-draft-rival-on-grain');
    expect(bench.writes()).toEqual([]);
  });

  it('round-7 a draft amended from some OTHER document is refused too', async () => {
    const bench = fakeBench([budgetDoc('BUDGET-2026-99999-2', 0, 'BUDGET-2026-99999')]);
    const err = (await pushBudget(bench, OLD).catch((e: unknown) => e)) as Error & { code?: string };
    expect(err.code).toBe('budget-draft-rival-on-grain');
    expect(bench.writes()).toEqual([]);
  });

  it('round-7 a draft is refused whether or not a mirror row exists — the mirror is no longer consulted at all', async () => {
    const bench = fakeBench([budgetDoc(`${OLD}-2`, 0, OLD)]);
    const err = (await pushBudget(bench, null).catch((e: unknown) => e)) as Error & { code?: string };
    expect(err.code).toBe('budget-draft-rival-on-grain');
    expect(bench.writes()).toEqual([]);
  });
});
