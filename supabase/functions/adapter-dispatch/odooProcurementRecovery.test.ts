import { assertEquals } from '@std/assert';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { DispatchMoneyWriteDeps, OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import {
  buildOdooProcurementRecoveryDeps,
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
  ], { orgId: 'org-a', ownsProcurement: true, maxCandidates: 2 }, async (item) => {
    seen.push(item.row.id);
    return deps;
  }, async () => ({}), async () => false);

  assertEquals(seen, ['1', '2']);
  assertEquals(result, { reconciled: 2, skipped: 0, budgetExhausted: false, errors: [] });
});

Deno.test('AC-OPP-062 procurement recovery reports a held command and continues to the next candidate', async () => {
  const seen: string[] = [];
  const result = await reconcileOdooProcurementCandidates([procurement('1'), procurement('2')], {
    orgId: 'org-a', ownsProcurement: true,
  }, async (item) => {
    seen.push(item.row.id);
    return deps;
  }, async () => {
    if (seen.at(-1) === '1') throw new AppError('held for review', 'command-held');
    return {};
  }, async () => false);

  assertEquals(seen, ['1', '2']);
  assertEquals(result, { reconciled: 1, skipped: 0, budgetExhausted: false, errors: [{ id: '1', error: 'command-held' }] });
});

Deno.test('AC-OPP-062 procurement recovery stops when the recorded actor is no longer authorized', async () => {
  let dispatches = 0;
  const result = await reconcileOdooProcurementCandidates([procurement('1')], {
    orgId: 'org-a', ownsProcurement: true,
  }, async () => { throw new AppError('recovery authorization refused', 'commit-rejected'); }, async () => {
    dispatches += 1;
    return {};
  }, async () => false);

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
  }, async () => {
    dispatches += 1;
    return {};
  }, async () => false);

  assertEquals([builds, dispatches], [0, 0]);
  assertEquals(result, { reconciled: 0, skipped: 0, budgetExhausted: true, errors: [] });
});

Deno.test('AC-OPP-062 procurement recovery reports when a candidate exhausts the shared call budget mid-probe', async () => {
  let available = true;
  const result = await reconcileOdooProcurementCandidates([procurement('1')], {
    orgId: 'org-a', ownsProcurement: true, callBudget: { left: () => available, spend: () => available },
  }, async () => deps, async () => {
    available = false;
    throw new AppError('probe stopped at the call limit', 'external-unreachable');
  }, async () => false);

  assertEquals(result, { reconciled: 0, skipped: 0, budgetExhausted: true, errors: [{ id: '1', error: 'external-unreachable' }] });
});

Deno.test('AC-OPP-062 procurement recovery skips a document already anchored to another PMO row', async () => {
  let builds = 0;
  let dispatches = 0;
  const result = await reconcileOdooProcurementCandidates([procurement('1')], {
    orgId: 'org-a', ownsProcurement: true,
  }, async () => {
    builds += 1;
    return deps;
  }, async () => {
    dispatches += 1;
    return {};
  }, async () => true);

  assertEquals([builds, dispatches], [0, 0]);
  assertEquals(result, { reconciled: 0, skipped: 1, budgetExhausted: false, errors: [] });
});

Deno.test('AC-OPP-062 recovery re-checks authorization using the actor persisted on the outbox row', async () => {
  const actor = 'recorded-actor';
  const stored = {
    external_tier: 'odoo', domain: 'procurement', pmo_record_id: 'record-1', operation: 'create',
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
    sc as never, 'org-a', { ...procurement('1'), row: row('1', 'pending') }, undefined,
    async (_client, orgId, command) => {
      seen.push([orgId, command.actorUserId, command.state, command.domain, command.operation]);
      return { ok: false, status: 403, message: 'recorded actor is no longer allowed' };
    },
  ).catch((cause) => cause);

  assertEquals(selectedColumns, 'external_command_outbox.external_tier,domain,pmo_record_id,operation,payload,actor_user_id');
  assertEquals(seen, [['org-a', actor, 'pending', 'procurement', 'create']]);
  assertEquals(seen.length, 1, 'the recorded actor is checked before any Odoo adapter is resolved');
  assertEquals(error instanceof AppError && error.code, 'commit-rejected');
});
