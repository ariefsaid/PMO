import { assertEquals, assertStringIncludes } from '@std/assert';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { DispatchMoneyWriteDeps, OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { OdooOutboxRecoveryCandidate } from '../_shared/odooOutboxRecovery.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { odooOwnsRevenueTier, odooOwnsStockTier } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ownership.ts';
import { reconcileOdooRevenueOutbox } from './odooRevenueRecovery.ts';
import { buildOdooProcurementRecoveryDeps, reconcileOdooProcurementOutbox } from './odooProcurementRecovery.ts';
import { reconcileOdooStockOutbox } from './odooStockRecovery.ts';
import { STOCK_DOC_KIND } from './odooStock.ts';
import { INVENTORY_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/stockAdapter.ts';
import { buildOdooReplayDeps, type OdooReplaySpec } from './odooReplayDeps.ts';

function client(stored: Record<string, unknown>) {
  const tables: string[] = [];
  const sc = {
    from: (table: string) => {
      tables.push(table);
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: table === 'external_command_outbox' ? stored : null, error: null }),
        limit: () => Promise.resolve({ data: table === 'external_domain_ownership' ? [{ id: 'own-1' }] : [], error: null }),
      };
      return chain;
    },
    rpc: () => { throw new Error('unexpected rpc'); },
  };
  return { sc: sc as never, tables };
}

/**
 * Client for the reissue re-check tests: the outbox row read plus the two authorization RPCs
 * (`checkOutboxReplayAuthorization` re-runs against the REAL guard here — revenue and stock pass no
 * `authorizeReplay` seam), recording every rpc so the tests can prove the re-check ran before the
 * money gate.
 */
function replayClient(stored: Record<string, unknown>, actorState: { role: string; active: boolean } = { role: 'Admin', active: true }) {
  const rpcCalls: string[] = [];
  const sc = {
    from: (table: string) => {
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: table === 'external_command_outbox' ? stored : null, error: null }),
      };
      return chain;
    },
    rpc: (fn: string, _args: Record<string, unknown>) => {
      rpcCalls.push(fn);
      if (fn === 'domain_owned_by_tier') return Promise.resolve({ data: true, error: null });
      if (fn === 'actor_authorization_state') return Promise.resolve({ data: actorState, error: null });
      return Promise.resolve({ data: null, error: { code: 'unexpected-rpc', message: `unexpected rpc ${fn}` } });
    },
  };
  return { sc: sc as never, rpcCalls };
}

function candidate(domain: string, pmoRecordId: string, payload: Record<string, unknown>): OdooOutboxRecoveryCandidate {
  const row: OutboxRow = {
    id: `row-${domain}`, domain, pmoRecordId, idempotencyKey: `key-${domain}`, state: 'pending',
    externalRecordId: null, canonical: null, claimGeneration: 1, payloadDigest: null,
  } as OutboxRow;
  return { row, externalTier: 'odoo', operation: 'create', payload, updatedAt: '2026-11-15T00:00:00Z' };
}

const stored = (domain: string, pmoRecordId: string, payload: Record<string, unknown>, state = 'pending', actor: string | null = null) => ({
  external_tier: 'odoo', domain, pmo_record_id: pmoRecordId, operation: 'create', state, payload, actor_user_id: actor,
});

const countingMoney = (): { money: DispatchMoneyWriteDeps['money']; count: () => number } => {
  let reauthorizations = 0;
  const money = {
    reauthorizeRecoveryReissue: async () => { reauthorizations += 1; return { ok: true, message: 'money-gate-passed' }; },
  } as unknown as DispatchMoneyWriteDeps['money'];
  return { money, count: () => reauthorizations };
};

// Mirrors REVENUE_REPLAY (odooRevenueRecovery.ts): the production spec is module-private, and the
// behavior under test is the builder's reissue wrap, not adapter selection — so the resolvers are fakes.
const revenueSpec = (money: DispatchMoneyWriteDeps['money']): OdooReplaySpec => ({
  label: 'invoice', domain: 'revenue', ownsTier: odooOwnsRevenueTier,
  isFrozen: (stored, payload) => stored.operation === 'create' && payload.erp_doc_kind === 'sales-invoice' && payload.verb === 'submit',
  command: (_stored, payload) => ({ domain: 'revenue', operation: 'transition', record: payload as AdapterCommand['record'] }),
  resolveAdapter: async () => ({}) as DispatchMoneyWriteDeps['adapter'],
  resolveMoney: async () => money as DispatchMoneyWriteDeps['money'],
});

// Mirrors STOCK_REPLAY (odooStockRecovery.ts, including its SWEEP_STATES conjunction) with fake resolvers.
const stockSpec = (money: DispatchMoneyWriteDeps['money']): OdooReplaySpec => ({
  label: 'stock', domain: INVENTORY_DOMAIN, ownsTier: odooOwnsStockTier,
  isFrozen: (stored, payload) => stored.operation === 'create' && payload.erp_doc_kind === STOCK_DOC_KIND
    && payload.stockDocumentId === stored.pmo_record_id && Number.isInteger(payload.documentRevision)
    && ['pending', 'committing', 'quarantined', 'committed'].includes(stored.state),
  command: (stored, payload) => ({
    domain: INVENTORY_DOMAIN, operation: 'create',
    record: { id: stored.pmo_record_id, revision: payload.documentRevision, erp_doc_kind: STOCK_DOC_KIND } as AdapterCommand['record'],
  }),
  resolveAdapter: async () => ({}) as DispatchMoneyWriteDeps['adapter'],
  resolveMoney: async () => money as DispatchMoneyWriteDeps['money'],
});

Deno.test('AC-2283-001 revenue recovery refuses a frozen invoice with no recorded actor before any adapter', async () => {
  const payload = { id: 'inv-1', erp_doc_kind: 'sales-invoice', verb: 'submit' };
  const { sc, tables } = client(stored('revenue', 'inv-1', payload));
  const result = await reconcileOdooRevenueOutbox(sc, 'org-a', { candidates: [candidate('revenue', 'inv-1', payload)] });
  assertEquals(result.reconciled, 0);
  assertStringIncludes(result.errors[0]?.error ?? '', 'no recorded actor');
  assertEquals([...new Set(tables)].sort(), ['external_command_outbox', 'external_domain_ownership']);
});

Deno.test('AC-2283-001 procurement recovery refuses a frozen order with no recorded actor before any adapter', async () => {
  const payload = { id: 'po-1', erp_doc_kind: 'purchase-order' };
  const { sc, tables } = client(stored('procurement', 'po-1', payload));
  const result = await reconcileOdooProcurementOutbox(sc, 'org-a', { candidates: [candidate('procurement', 'po-1', payload)] });
  assertEquals(result.reconciled, 0);
  assertEquals(result.errors, [{ id: 'row-procurement', error: 'commit-rejected' }]);
  assertEquals([...new Set(tables)].sort(), ['external_command_outbox', 'external_domain_ownership']);
  // The pass surfaces only the code (`recoveryErrorCode`), so the specific refusal is asserted at the
  // builder, where both the code and the reason are visible (#2283 review I2).
  const refusal = await buildOdooProcurementRecoveryDeps(sc, 'org-a', candidate('procurement', 'po-1', payload)).catch((error) => error);
  assertEquals(refusal instanceof AppError && refusal.code, 'commit-rejected');
  assertStringIncludes(refusal.message, 'no recorded actor');
});

Deno.test('AC-2283-001 stock recovery refuses a frozen stock post with no recorded actor before any adapter', async () => {
  const payload = { erp_doc_kind: STOCK_DOC_KIND, stockDocumentId: 'doc-1', documentRevision: 1 };
  const { sc, tables } = client(stored(INVENTORY_DOMAIN, 'doc-1', payload));
  const result = await reconcileOdooStockOutbox(sc, 'org-a', { candidates: [candidate(INVENTORY_DOMAIN, 'doc-1', payload)], owns: true });
  assertEquals(result.reconciled, 0);
  assertStringIncludes(result.errors[0]?.error ?? '', 'no recorded actor');
  assertEquals([...new Set(tables)], ['external_command_outbox']);
});

Deno.test('#2283 I1 revenue replay deps re-authorize the stored actor before the money gate on a recovery reissue', async () => {
  const payload = { id: 'inv-1', erp_doc_kind: 'sales-invoice', verb: 'submit' };
  const { sc, rpcCalls } = replayClient(stored('revenue', 'inv-1', payload, 'quarantined', 'actor-1'));
  const { money, count } = countingMoney();
  const deps = await buildOdooReplayDeps(sc, 'org-a', candidate('revenue', 'inv-1', payload), undefined, revenueSpec(money));
  const allowed = await deps.money.reauthorizeRecoveryReissue?.();

  assertEquals(allowed, { ok: true, message: 'money-gate-passed' });
  assertEquals(count(), 1, 'the money gate is consulted only after the actor re-check passes');
  assertEquals(rpcCalls, ['domain_owned_by_tier', 'actor_authorization_state'],
    'the reissue re-check re-runs the REAL replay authorization (tier ownership, then actor standing)');
});

Deno.test('#2283 I1 revenue replay deps refuse a recovery reissue when the actor re-check refuses', async () => {
  const payload = { id: 'inv-1', erp_doc_kind: 'sales-invoice', verb: 'submit' };
  const { sc, rpcCalls } = replayClient(stored('revenue', 'inv-1', payload, 'quarantined', null));
  const { money, count } = countingMoney();
  const deps = await buildOdooReplayDeps(sc, 'org-a', candidate('revenue', 'inv-1', payload), undefined, revenueSpec(money));
  const refused = await deps.money.reauthorizeRecoveryReissue?.();

  assertEquals(refused?.ok, false);
  assertStringIncludes(refused?.message ?? '', 'no recorded actor');
  assertEquals(count(), 0, 'the money gate is not consulted after the actor re-check refuses');
  assertEquals(rpcCalls, [], 'a missing actor refuses before any authorization RPC');
});

Deno.test('#2283 I1 stock replay deps re-authorize the stored actor before the money gate on a recovery reissue', async () => {
  const payload = { erp_doc_kind: STOCK_DOC_KIND, stockDocumentId: 'doc-1', documentRevision: 1 };
  // Inventory's role half is delegated to the DB gate, so any ACTIVE member passes: an Engineer proves it.
  const { sc, rpcCalls } = replayClient(stored(INVENTORY_DOMAIN, 'doc-1', payload, 'quarantined', 'actor-1'), { role: 'Engineer', active: true });
  const { money, count } = countingMoney();
  const deps = await buildOdooReplayDeps(sc, 'org-a', candidate(INVENTORY_DOMAIN, 'doc-1', payload), undefined, stockSpec(money));
  const allowed = await deps.money.reauthorizeRecoveryReissue?.();

  assertEquals(allowed, { ok: true, message: 'money-gate-passed' });
  assertEquals(count(), 1, 'the money gate is consulted only after the actor re-check passes');
  assertEquals(rpcCalls, ['domain_owned_by_tier', 'actor_authorization_state'],
    'the reissue re-check re-runs the REAL replay authorization (tier ownership, then actor standing)');
});

Deno.test('#2283 I1 stock replay deps refuse a recovery reissue when the actor re-check refuses', async () => {
  const payload = { erp_doc_kind: STOCK_DOC_KIND, stockDocumentId: 'doc-1', documentRevision: 1 };
  const { sc, rpcCalls } = replayClient(stored(INVENTORY_DOMAIN, 'doc-1', payload, 'quarantined', null));
  const { money, count } = countingMoney();
  const deps = await buildOdooReplayDeps(sc, 'org-a', candidate(INVENTORY_DOMAIN, 'doc-1', payload), undefined, stockSpec(money));
  const refused = await deps.money.reauthorizeRecoveryReissue?.();

  assertEquals(refused?.ok, false);
  assertStringIncludes(refused?.message ?? '', 'no recorded actor');
  assertEquals(count(), 0, 'the money gate is not consulted after the actor re-check refuses');
  assertEquals(rpcCalls, [], 'a missing actor refuses before any authorization RPC');
});
