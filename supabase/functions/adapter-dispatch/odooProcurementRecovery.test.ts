import { assertEquals } from '@std/assert';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { DispatchMoneyWriteDeps, OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';
import {
  buildOdooProcurementRecoveryDeps,
  odooProcurementAnchoredElsewhere,
  odooProcurementHoldCommitted,
  procurementRecoveryStartIndex,
  reconcileOdooProcurementCandidates,
  type OdooProcurementCandidate,
} from './odooProcurementRecovery.ts';
import { reconcileOdooRevenueCandidates, type OdooRevenueCandidate } from './odooRevenueRecovery.ts';

const row = (id: string, state: OutboxRow['state'] = 'quarantined', domain = 'procurement'): OutboxRow => ({
  id, domain, pmoRecordId: `record-${id}`, idempotencyKey: `key-${id}`, state,
  externalRecordId: null, canonical: null, claimGeneration: 1, payloadDigest: null,
});

const candidate = (
  id: string,
  payload: Record<string, unknown>,
  over: Partial<OdooProcurementCandidate> = {},
): OdooProcurementCandidate => ({
  row: row(id), externalTier: 'odoo', operation: 'create', payload,
  updatedAt: new Date(Date.UTC(2026, 10, Number(id))).toISOString(),
  ...over,
});

const deps = {} as DispatchMoneyWriteDeps;
const procurement = (id: string) => candidate(id, { erp_doc_kind: 'purchase-order' });
const sharedBudget = (capacity: number) => {
  let remaining = capacity;
  return {
    left: () => remaining > 0,
    canSpend: (calls = 1) => Number.isInteger(calls) && calls >= 0 && calls <= remaining,
    spend: (calls = 1) => {
      if (!Number.isInteger(calls) || calls < 0 || calls > remaining) return false;
      remaining -= calls;
      return true;
    },
    refund: (calls = 1) => { remaining += calls; },
    remaining: () => remaining,
  };
};

Deno.test('AC-OPP-062 procurement recovery dispatches only Odoo procurement document commands in oldest-first order', async () => {
  const seen: string[] = [];
  const result = await reconcileOdooProcurementCandidates([
    procurement('2'),
    candidate('3', { erp_doc_kind: 'sales-invoice' }),
    candidate('4', { erp_doc_kind: 'purchase-order' }, { externalTier: 'erpnext' }),
    candidate('5', { erp_doc_kind: 'purchase-order' }, { row: row('5', 'held') }),
    procurement('1'),
  ], { orgId: 'org-a', ownsProcurement: true, maxCandidates: 2, candidateStartIndex: 0 }, async (item) => {
    seen.push(item.row.id);
    return deps;
  }, async () => false, async () => ({}));

  assertEquals(seen, ['1', '2']);
  assertEquals(result, { reconciled: 2, skipped: 0, budgetExhausted: false, errors: [] });
});

Deno.test('AC-OPP-062 a recovery cursor rotates past repeatedly failing oldest rows', async () => {
  const seen: string[] = [];
  await reconcileOdooProcurementCandidates(
    [procurement('1'), procurement('2'), procurement('3'), procurement('4')],
    { orgId: 'org-a', ownsProcurement: true, maxCandidates: 2, candidateStartIndex: 2 },
    async (item) => { seen.push(item.row.id); return deps; },
    async () => false,
    async () => ({}),
  );

  assertEquals(seen, ['3', '4']);
});

Deno.test('AC-OPP-062 the procurement recovery cursor advances once per five-minute tick', () => {
  const fiveMinutes = 5 * 60_000;
  const firstTick = Date.UTC(2026, 10, 5, 0, 0, 0);
  const starts = Array.from({ length: 5 }, (_, tick) => procurementRecoveryStartIndex(firstTick + tick * fiveMinutes, 5));
  assertEquals(starts.slice(1).map((start, index) => (start - starts[index] + 5) % 5), [1, 1, 1, 1]);
  assertEquals(new Set(starts).size, 5);
});

Deno.test('AC-OPP-062 a payment candidate gets the first procurement recovery slot', async () => {
  const seen: string[] = [];
  await reconcileOdooProcurementCandidates([
    procurement('0'),
    candidate('1', { erp_doc_kind: 'payment' }),
  ], { orgId: 'org-a', ownsProcurement: true, candidateStartIndex: 0 }, async (item) => {
    return { row: item } as unknown as DispatchMoneyWriteDeps;
  }, async () => false, async (written) => {
    seen.push((written as unknown as { row: OdooProcurementCandidate }).row.row.id);
    return {};
  });

  assertEquals(seen[0], '1');
});

Deno.test('AC-OPP-062 procurement recovery reports a held command and continues to the next candidate', async () => {
  const seen: string[] = [];
  const result = await reconcileOdooProcurementCandidates([procurement('1'), procurement('2')], {
    orgId: 'org-a', ownsProcurement: true, candidateStartIndex: 0,
  }, async (item) => {
    seen.push(item.row.id);
    return deps;
  }, async () => false, async () => {
    if (seen.at(-1) === '1') throw new AppError('held for review', 'command-held');
    return {};
  });

  assertEquals(seen, ['1', '2']);
  assertEquals(result, { reconciled: 1, skipped: 0, budgetExhausted: false, errors: [{ id: '1', error: 'command-held' }] });
});

Deno.test('AC-OPP-062 procurement recovery stops when the recorded actor is no longer authorized', async () => {
  let dispatches = 0;
  const result = await reconcileOdooProcurementCandidates([procurement('1')], {
    orgId: 'org-a', ownsProcurement: true,
  }, async () => { throw new AppError('recovery authorization refused', 'commit-rejected'); }, async () => false, async () => {
    dispatches += 1;
    return {};
  });

  assertEquals(dispatches, 0);
  assertEquals(result.errors, [{ id: '1', error: 'commit-rejected' }]);
});

Deno.test('AC-OPP-062 procurement recovery leaves candidates untouched when the shared call budget is exhausted', async () => {
  let builds = 0;
  let dispatches = 0;
  const result = await reconcileOdooProcurementCandidates([procurement('1')], {
    orgId: 'org-a', ownsProcurement: true, callBudget: { left: () => false, spend: () => false },
  }, async () => {
    builds += 1;
    return deps;
  }, async () => false, async () => {
    dispatches += 1;
    return {};
  });

  assertEquals([builds, dispatches], [0, 0]);
  assertEquals(result, { reconciled: 0, skipped: 0, budgetExhausted: true, errors: [] });
});

Deno.test('AC-OPP-062 procurement recovery does not build a candidate when its full reservation is unavailable', async () => {
  let remaining = 1;
  let builds = 0;
  const budget = {
    left: () => remaining > 0,
    canSpend: (units = 1) => units <= remaining,
    spend: (units = 1) => {
      if (units > remaining) return false;
      remaining -= units;
      return true;
    },
    refund: (units = 1) => { remaining += units; },
  };
  const result = await reconcileOdooProcurementCandidates([
    candidate('1', { erp_doc_kind: 'payment' }),
  ], { orgId: 'org-a', ownsProcurement: true, callBudget: budget }, async () => {
    builds += 1;
    return deps;
  }, async () => false, async () => ({}));

  assertEquals([builds, remaining], [0, 1], 'an unaffordable candidate does not enter the recovery path or consume partial budget');
  assertEquals(result.budgetExhausted, true);
});

Deno.test('AC-OPP-062 a pre-claim refusal costs zero and does not block the next candidate', async () => {
  const budget = sharedBudget(24);
  const seen: string[] = [];
  const result = await reconcileOdooProcurementCandidates([procurement('1'), procurement('2')], {
    orgId: 'org-a', ownsProcurement: true, candidateStartIndex: 0, callBudget: budget,
  }, async (item, candidateBudget) => {
    if (item.row.id === '1') throw new AppError('recovery authorization refused', 'commit-rejected');
    assertEquals(candidateBudget?.spend(2), true);
    return { row: item, budget: candidateBudget } as unknown as DispatchMoneyWriteDeps;
  }, async () => false, async (written) => {
    const built = written as unknown as { row: OdooProcurementCandidate; budget?: { spend: (calls?: number) => boolean } };
    assertEquals(built.budget?.spend(), true);
    seen.push(built.row.row.id);
    return {};
  });

  assertEquals(seen, ['2']);
  assertEquals(budget.remaining(), 21, 'the refused candidate spent no shared Odoo-call capacity');
  assertEquals(result.errors, [{ id: '1', error: 'commit-rejected' }]);
});

Deno.test('AC-OPP-062 refunds unused reservations so several cheap probes fit in one tick', async () => {
  const budget = sharedBudget(24);
  const seen: string[] = [];
  const result = await reconcileOdooProcurementCandidates([procurement('1'), procurement('2'), procurement('3')], {
    orgId: 'org-a', ownsProcurement: true, candidateStartIndex: 0, callBudget: budget,
  }, async (item, candidateBudget) => {
    assertEquals(candidateBudget?.spend(2), true);
    return { row: item, budget: candidateBudget } as unknown as DispatchMoneyWriteDeps;
  }, async () => false, async (written) => {
    const built = written as unknown as { row: OdooProcurementCandidate; budget?: { spend: (calls?: number) => boolean } };
    assertEquals(built.budget?.spend(), true);
    seen.push(built.row.row.id);
    return {};
  });

  assertEquals(seen, ['1', '2', '3']);
  assertEquals(budget.remaining(), 15, 'three candidates used three Odoo calls each');
  assertEquals(result.reconciled, 3);
});

Deno.test('AC-OPP-062 a revenue candidate cannot consume the payment recovery share for the tick', async () => {
  const budget = sharedBudget(24);
  const paid: string[] = [];
  const invoiced: string[] = [];
  const payment = candidate('1', { erp_doc_kind: 'payment' });
  const proc = await reconcileOdooProcurementCandidates([payment], {
    orgId: 'org-a', ownsProcurement: true, callBudget: budget,
  }, async (item, candidateBudget) => {
    assertEquals(candidateBudget?.spend(2), true);
    return { row: item, budget: candidateBudget } as unknown as DispatchMoneyWriteDeps;
  }, async () => false, async (item) => {
    const built = item as unknown as { row: OdooProcurementCandidate; budget?: { spend: (calls?: number) => boolean } };
    assertEquals(built.budget?.spend(), true);
    paid.push(built.row.row.id);
    return {};
  });
  const revenues: OdooRevenueCandidate[] = ['2', '3'].map((id) => ({
    row: { ...row(id), domain: 'revenue' }, externalTier: 'odoo', operation: 'create',
    payload: { erp_doc_kind: 'sales-invoice', verb: 'submit' },
    updatedAt: new Date(Date.UTC(2026, 10, Number(id))).toISOString(),
  }));
  const revenue = await reconcileOdooRevenueCandidates(revenues, {
    orgId: 'org-a', ownsRevenue: true, callBudget: budget,
  }, async (item, candidateBudget) => {
    assertEquals(candidateBudget?.spend(2), true);
    return { row: item, budget: candidateBudget } as unknown as DispatchMoneyWriteDeps;
  }, async (item) => {
    const built = item as unknown as { row: OdooRevenueCandidate; budget?: { spend: (calls?: number) => boolean } };
    assertEquals(built.budget?.spend(), true);
    invoiced.push(built.row.row.id);
    return {};
  });

  assertEquals(paid, ['1'], 'procurement recovery runs first and dispatches the payment candidate');
  assertEquals(invoiced.length, 2, 'unused candidate reservations return capacity to revenue recovery');
  assertEquals(proc.reconciled, 1);
  assertEquals(revenue.reconciled, 2);
});

Deno.test('AC-OPP-062 procurement recovery reports when a candidate exhausts the shared call budget mid-probe', async () => {
  let available = true;
  const result = await reconcileOdooProcurementCandidates([procurement('1')], {
    orgId: 'org-a', ownsProcurement: true, callBudget: { left: () => available, spend: () => available },
  }, async () => deps, async () => false, async () => {
    available = false;
    throw new AppError('probe stopped at the call limit', 'external-unreachable');
  });

  assertEquals(result, { reconciled: 0, skipped: 0, budgetExhausted: true, errors: [{ id: '1', error: 'external-unreachable' }] });
});

Deno.test('AC-OPP-062 committed rows with a foreign anchor are skipped without spending the recovery budget', async () => {
  let builds = 0;
  let dispatches = 0;
  let remaining = 20;
  const result = await reconcileOdooProcurementCandidates([candidate('1', { erp_doc_kind: 'purchase-order' }, { row: row('1', 'committed') })], {
    orgId: 'org-a', ownsProcurement: true,
    callBudget: {
      left: () => remaining > 0,
      spend: (calls = 1) => { if (calls > remaining) return false; remaining -= calls; return true; },
    },
  }, async () => {
    builds += 1;
    return deps;
  }, async () => true, async () => {
    dispatches += 1;
    return {};
  });

  assertEquals([builds, dispatches], [0, 0]);
  assertEquals(remaining, 20, 'a foreign-anchor skip does not consume Odoo-call capacity');
  assertEquals(result, { reconciled: 0, skipped: 1, budgetExhausted: false, errors: [] });
});

Deno.test('AC-OPP-062 a committed row with a foreign anchor is held with a stable reason through the fenced transition', async () => {
  const holds: Array<[string, number, string]> = [];
  const result = await reconcileOdooProcurementCandidates([candidate('1', { erp_doc_kind: 'purchase-order' }, { row: row('1', 'committed') })], {
    orgId: 'org-a', ownsProcurement: true,
    holdCommitted: async (item, reason) => { holds.push([item.row.id, item.row.claimGeneration, reason]); return 1; },
  }, async () => deps, async () => true, async () => ({}));

  assertEquals(holds, [['1', 1, 'committed-anchor-owned-elsewhere: the Odoo document is anchored to another PMO record']]);
  assertEquals(result, { reconciled: 0, skipped: 1, budgetExhausted: false, errors: [] });
});

Deno.test('AC-OPP-062 a failed hold of a foreign-anchored committed row is reported and the pass continues', async () => {
  const seen: string[] = [];
  const result = await reconcileOdooProcurementCandidates([
    candidate('1', { erp_doc_kind: 'purchase-order' }, { row: row('1', 'committed') }),
    procurement('2'),
  ], {
    orgId: 'org-a', ownsProcurement: true, candidateStartIndex: 0,
    holdCommitted: async () => { throw new AppError('rpc down', 'external-unreachable'); },
  }, async (item) => { seen.push(item.row.id); return deps; }, async (item) => item.row.state === 'committed', async () => ({}));

  assertEquals(seen, ['2']);
  assertEquals(result.errors, [{ id: '1', error: 'external-unreachable' }]);
  assertEquals(result.reconciled, 1);
});

Deno.test('AC-OPP-062 the default hold calls the fenced committed-to-held RPC with the row generation', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const sc = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return { data: 1, error: null }; } };
  const hold = odooProcurementHoldCommitted(sc as never);
  const n = await hold(candidate('1', { erp_doc_kind: 'purchase-order' }, { row: { ...row('1', 'committed'), claimGeneration: 4 } }), 'committed-anchor-owned-elsewhere: x');
  assertEquals(n, 1);
  assertEquals(calls, [['hold_committed_outbox', { p_id: '1', p_generation: 4, p_reason: 'committed-anchor-owned-elsewhere: x' }]]);
});

Deno.test('AC-OPP-062 recovery re-checks authorization using the actor persisted on the outbox row', async () => {
  const actor = 'recorded-actor';
  const stored = {
    external_tier: 'odoo', domain: 'procurement', pmo_record_id: 'record-1', operation: 'create', state: 'failed',
    payload: { id: 'record-1', erp_doc_kind: 'purchase-order' }, actor_user_id: actor,
  };
  let selectedColumns = '';
  const sc = {
    from: (table: string) => ({
      select: (columns: string) => {
        selectedColumns = `${table}.${columns}`;
        const chain = {
          eq: () => chain,
          maybeSingle: async () => ({ data: stored, error: null }),
        };
        return chain;
      },
    }),
  };
  const seen: unknown[] = [];
  const error = await buildOdooProcurementRecoveryDeps(
    sc as never, 'org-a', { ...procurement('1'), row: row('1', 'quarantined') }, undefined,
    async (_client, orgId, command) => {
      seen.push([orgId, command.actorUserId, command.state, command.domain, command.operation]);
      return { ok: false, status: 403, message: 'recorded actor is no longer allowed' };
    },
  ).catch((cause) => cause);

  assertEquals(selectedColumns, 'external_command_outbox.external_tier,domain,pmo_record_id,operation,state,payload,actor_user_id');
  assertEquals(seen, [['org-a', actor, 'failed', 'procurement', 'create']]);
  assertEquals(seen.length, 1, 'the recorded actor is checked before any Odoo adapter is resolved');
  assertEquals(error instanceof AppError && error.code, 'commit-rejected');
});

Deno.test('AC-OPP-062 quarantined order reissue re-authorizes the recorded actor before the money gate', async () => {
  const stored = {
    external_tier: 'odoo', domain: 'procurement', pmo_record_id: 'record-1', operation: 'create', state: 'quarantined',
    payload: { id: 'record-1', erp_doc_kind: 'purchase-order' }, actor_user_id: 'actor-1',
  };
  const sc = { from: () => ({ select: () => {
    const chain = { eq: () => chain, maybeSingle: async () => ({ data: stored, error: null }) };
    return chain;
  } }) };
  let moneyReauthorizations = 0;
  const money = {
    probeByRemarksKey: async () => null,
    reauthorizeRecoveryReissue: async () => { moneyReauthorizations += 1; return { ok: true, message: '' }; },
  } as unknown as DispatchMoneyWriteDeps['money'];
  let authorizationStates: string[] = [];
  const allowInitialButRefuseReissue = async (_client: unknown, _orgId: string, command: { state: string }) => {
    authorizationStates.push(command.state);
    return command.state === 'quarantined'
      ? { ok: true, status: 200, message: '' }
      : { ok: false, status: 403, message: 'recorded actor is no longer allowed' };
  };
  const result = await buildOdooProcurementRecoveryDeps(sc as never, 'org-a', {
    ...candidate('1', { id: 'record-1', erp_doc_kind: 'purchase-order' }), row: row('1', 'quarantined'),
  }, undefined, allowInitialButRefuseReissue as never, {
    resolveAdapter: async () => ({}) as never,
    resolveMoneyOutboxDeps: async () => money as never,
  });
  const refused = await result.money.reauthorizeRecoveryReissue?.();

  assertEquals(authorizationStates, ['quarantined', 'failed']);
  assertEquals(refused, { ok: false, message: 'recorded actor is no longer allowed' });
  assertEquals(moneyReauthorizations, 0, 'the lower-level money gate is not consulted after authorization fails');
});

Deno.test('AC-OPP-062 quarantined order reissue reaches the money gate only after current actor authorization passes', async () => {
  const stored = {
    external_tier: 'odoo', domain: 'procurement', pmo_record_id: 'record-1', operation: 'create', state: 'quarantined',
    payload: { id: 'record-1', erp_doc_kind: 'purchase-order' }, actor_user_id: 'actor-1',
  };
  const sc = { from: () => ({ select: () => {
    const chain = { eq: () => chain, maybeSingle: async () => ({ data: stored, error: null }) };
    return chain;
  } }) };
  let moneyReauthorizations = 0;
  const money = {
    probeByRemarksKey: async () => null,
    reauthorizeRecoveryReissue: async () => { moneyReauthorizations += 1; return { ok: true, message: '' }; },
  } as unknown as DispatchMoneyWriteDeps['money'];
  const result = await buildOdooProcurementRecoveryDeps(sc as never, 'org-a', {
    ...candidate('1', { id: 'record-1', erp_doc_kind: 'purchase-order' }), row: row('1', 'quarantined'),
  }, undefined, async () => ({ ok: true, status: 200, message: '' }), {
    resolveAdapter: async () => ({}) as never,
    resolveMoneyOutboxDeps: async () => money as never,
  });
  const allowed = await result.money.reauthorizeRecoveryReissue?.();

  assertEquals(allowed, { ok: true, message: '' });
  assertEquals(moneyReauthorizations, 1);
});

Deno.test('AC-OPP-062 recovery probes query every anchor owner and treat only another PO family as foreign', async () => {
  const stored = {
    external_tier: 'odoo', domain: 'procurement', pmo_record_id: 'po-1', operation: 'update', state: 'quarantined',
    payload: { id: 'revision-2', poId: 'po-1', revision: 2, erp_doc_kind: 'purchase-order' }, actor_user_id: 'actor-1',
  };
  const owners = [{ pmo_record_id: 'po-1' }, { pmo_record_id: 'porev:po-1:1' }];
  let ownerLimit = 0;
  const sc = { from: (_table: string) => ({ select: () => {
    const chain = {
      eq: () => chain,
      maybeSingle: async () => ({ data: stored, error: null }),
      limit: async (limit: number) => { ownerLimit = limit; return { data: owners, error: null }; },
    };
    return chain;
  } }) };
  let context: AdapterSelectContext | undefined;
  const money = { probeByRemarksKey: async () => null } as unknown as DispatchMoneyWriteDeps['money'];
  await buildOdooProcurementRecoveryDeps(sc as never, 'org-a', {
    ...candidate('1', stored.payload, { row: { ...row('1', 'quarantined'), pmoRecordId: 'po-1' } }), operation: 'update',
  }, undefined, async () => ({ ok: true, status: 200, message: '' }), {
    resolveAdapter: async (ctx) => { context = ctx; return {} as never; },
    resolveMoneyOutboxDeps: async () => money as never,
  });

  assertEquals(ownerLimit, 0, 'owner reads occur only when the probe asks about a concrete Odoo ref');
  assertEquals(await context?.odooAnchorOwnedElsewhere?.('purchase.order:77'), false);
  assertEquals(ownerLimit, 101);
  owners.push({ pmo_record_id: 'other-po' });
  assertEquals(await context?.odooAnchorOwnedElsewhere?.('purchase.order:77'), true);
});

Deno.test('AC-OPP-062 the default committed-row owner check uses org-scoped rows and accepts its PO family', async () => {
  const owners = [{ pmo_record_id: 'po-1' }, { pmo_record_id: 'porev:po-1:3' }];
  let table = '';
  let limit = 0;
  const filters: Array<[string, unknown]> = [];
  const sc = { from: (name: string) => {
    table = name;
    return { select: () => {
      const chain = {
        eq: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
        limit: async (value: number) => { limit = value; return { data: owners, error: null }; },
      };
      return chain;
    } };
  } };
  const check = odooProcurementAnchoredElsewhere(sc as never, 'org-a');
  const po = candidate('1', { erp_doc_kind: 'purchase-order', poId: 'po-1' }, {
    row: { ...row('1', 'committed'), pmoRecordId: 'po-1', externalRecordId: 'purchase.order:77' },
  });

  assertEquals(await check(po), false);
  assertEquals([table, limit], ['external_refs', 101]);
  assertEquals(filters, [['org_id', 'org-a'], ['domain', 'procurement'], ['external_tier', 'odoo'], ['external_record_id', 'purchase.order:77']]);
  owners.push({ pmo_record_id: 'other-po' });
  assertEquals(await check(po), true);
});

type Metered = { spend: (calls?: number) => boolean; record: () => void; used: () => number } | undefined;
const revenueCandidate = (id: string): OdooRevenueCandidate => ({
  row: { ...row(id), domain: 'revenue' }, externalTier: 'odoo', operation: 'create',
  payload: { erp_doc_kind: 'sales-invoice', verb: 'submit' }, updatedAt: new Date(Date.UTC(2026, 10, Number(id))).toISOString(),
});

Deno.test('AC-OPP-062 a candidate that drains its reservation while building is charged what it used and stops the pass', async () => {
  const budget = sharedBudget(100);
  let dispatched = 0;
  const result = await reconcileOdooProcurementCandidates([procurement('1'), procurement('2')], {
    orgId: 'org-a', ownsProcurement: true, candidateStartIndex: 0, callBudget: budget,
  }, async (_item, candidateBudget) => {
    for (let i = 0; i < 14; i += 1) assertEquals(candidateBudget?.spend(1), true);
    assertEquals(candidateBudget?.spend(1), false);
    return deps;
  }, async () => false, async () => { dispatched += 1; return {}; });

  assertEquals([dispatched, budget.remaining(), result.budgetExhausted], [0, 86, true]);
  assertEquals(result.errors, [{ id: '1', error: 'external-unreachable' }]);
});

Deno.test('AC-OPP-062 a build that fails after some Odoo calls is charged for them and the next candidate still runs', async () => {
  const budget = sharedBudget(100);
  const seen: string[] = [];
  const result = await reconcileOdooProcurementCandidates([procurement('1'), procurement('2')], {
    orgId: 'org-a', ownsProcurement: true, candidateStartIndex: 0, callBudget: budget,
  }, async (item, candidateBudget) => {
    if (item.row.id === '1') {
      assertEquals(candidateBudget?.spend(3), true);
      throw new AppError('probe failed', 'commit-rejected');
    }
    return deps;
  }, async () => false, async () => { seen.push('dispatched'); return {}; });

  assertEquals([seen.length, budget.remaining(), result.budgetExhausted], [1, 97, false]);
  assertEquals(result.errors, [{ id: '1', error: 'commit-rejected' }]);
});

Deno.test('AC-OPP-062 adapter traffic beyond the reservation is charged to the tick and ends the pass', async () => {
  const budget = sharedBudget(100);
  let dispatched = 0;
  const result = await reconcileOdooProcurementCandidates([procurement('1'), procurement('2')], {
    orgId: 'org-a', ownsProcurement: true, candidateStartIndex: 0, callBudget: budget,
  }, async (_item, candidateBudget) => ({ budget: candidateBudget }) as unknown as DispatchMoneyWriteDeps,
  async () => false, async (written) => {
    dispatched += 1;
    const metered = (written as unknown as { budget: Metered }).budget!;
    for (let i = 0; i < 15; i += 1) metered.record();
    return {};
  });

  assertEquals([dispatched, budget.remaining(), result.budgetExhausted], [1, 85, true]);
});

Deno.test('AC-OPP-062 revenue recovery charges a failed or exhausted build and refunds a cheap dispatch', async () => {
  const budget = sharedBudget(40);
  const seen: string[] = [];
  const result = await reconcileOdooRevenueCandidates([revenueCandidate('1'), revenueCandidate('2'), revenueCandidate('3')], {
    orgId: 'org-a', ownsRevenue: true, callBudget: budget,
  }, async (item, candidateBudget) => {
    if (item.row.id === '1') {
      assertEquals(candidateBudget?.spend(2), true);
      throw new Error('revenue probe failed');
    }
    if (item.row.id === '3') {
      for (let i = 0; i < 17; i += 1) candidateBudget?.spend(1);
      return deps;
    }
    return { budget: candidateBudget } as unknown as DispatchMoneyWriteDeps;
  }, async (written) => {
    seen.push('dispatched');
    (written as unknown as { budget: Metered }).budget!.record();
    return {};
  });

  assertEquals(seen.length, 1);
  assertEquals(budget.remaining(), 40 - 2 - 1 - 16, 'failed build 2 + cheap dispatch 1 + exhausted build 16');
  assertEquals(result.errors.map((e) => e.id), ['1', '3']);
});

Deno.test('AC-OPP-062 revenue recovery charges adapter traffic beyond the reservation and stops', async () => {
  const budget = sharedBudget(100);
  let dispatched = 0;
  await reconcileOdooRevenueCandidates([revenueCandidate('1'), revenueCandidate('2')], {
    orgId: 'org-a', ownsRevenue: true, callBudget: budget,
  }, async (_item, candidateBudget) => ({ budget: candidateBudget }) as unknown as DispatchMoneyWriteDeps, async (written) => {
    dispatched += 1;
    const metered = (written as unknown as { budget: Metered }).budget!;
    for (let i = 0; i < 17; i += 1) metered.record();
    return {};
  });

  assertEquals([dispatched, budget.remaining()], [1, 83]);
});

Deno.test('AC-OPP-062 a tick that runs out of time while a candidate builds is charged the build calls and does not dispatch', async () => {
  const budget = { ...sharedBudget(100), spend: (calls = 1) => calls <= 3 };
  let dispatched = 0;
  const result = await reconcileOdooProcurementCandidates([procurement('1')], {
    orgId: 'org-a', ownsProcurement: true, callBudget: budget,
  }, async (_item, candidateBudget) => {
    assertEquals(candidateBudget?.spend(2), true);
    return deps;
  }, async () => false, async () => { dispatched += 1; return {}; });

  assertEquals([dispatched, result.budgetExhausted], [0, true]);
});
