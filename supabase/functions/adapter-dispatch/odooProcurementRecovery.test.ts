import { assertEquals } from '@std/assert';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { DispatchMoneyWriteDeps, OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';
import {
  buildOdooProcurementRecoveryDeps,
  odooProcurementAnchoredElsewhere,
  reconcileOdooProcurementCandidates,
  type OdooProcurementCandidate,
} from './odooProcurementRecovery.ts';

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

Deno.test('AC-OPP-062 procurement recovery reserves a payment probe, commit and read-back before claiming the candidate', async () => {
  let remaining = 1;
  const seen: string[] = [];
  const budget = {
    left: () => remaining > 0,
    spend: (units = 1) => {
      if (units > remaining) return false;
      remaining -= units;
      return true;
    },
  };
  const result = await reconcileOdooProcurementCandidates([
    candidate('1', { erp_doc_kind: 'payment' }),
  ], { orgId: 'org-a', ownsProcurement: true, callBudget: budget }, async (item) => {
    seen.push(item.row.id);
    return deps;
  }, async () => false, async () => ({}));

  assertEquals([seen, remaining], [[], 1], 'an unaffordable candidate does not enter the recovery path or consume partial budget');
  assertEquals(result.budgetExhausted, true);
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
  const sc = { from: (name: string) => {
    table = name;
    return { select: () => {
      const chain = {
        eq: () => chain,
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
  owners.push({ pmo_record_id: 'other-po' });
  assertEquals(await check(po), true);
});
