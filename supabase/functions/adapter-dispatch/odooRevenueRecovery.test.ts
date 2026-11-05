import { assertEquals } from '@std/assert';
import type { DispatchMoneyWriteDeps, OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { reconcileOdooRevenueCandidates, type OdooRevenueCandidate } from './odooRevenueRecovery.ts';

const row = (id: string): OutboxRow => ({
  id, domain: 'revenue', pmoRecordId: `invoice-${id}`, idempotencyKey: `key-${id}`, state: 'quarantined',
  externalRecordId: null, canonical: null, claimGeneration: 1, payloadDigest: null,
});
const candidate = (id: string, payload: Record<string, unknown>, over: Partial<OdooRevenueCandidate> = {}): OdooRevenueCandidate => ({
  row: row(id), externalTier: 'odoo', operation: 'create', payload, updatedAt: new Date(Date.UTC(2026, 10, Number(id))).toISOString(), ...over,
});
const deps = {} as DispatchMoneyWriteDeps;

Deno.test('C6-T7 Odoo recovery candidates only drive Odoo sales-invoice submit rows, oldest first, and continue after an error', async () => {
  const seen: string[] = [];
  const result = await reconcileOdooRevenueCandidates([
    candidate('2', { erp_doc_kind: 'sales-invoice', verb: 'submit' }),
    candidate('3', { erp_doc_kind: 'incoming-payment', verb: 'create' }),
    candidate('1', { erp_doc_kind: 'sales-invoice', verb: 'submit' }),
    candidate('4', { erp_doc_kind: 'sales-invoice', verb: 'submit' }, { externalTier: 'erpnext' }),
    candidate('5', { erp_doc_kind: 'sales-invoice', verb: 'submit' }, { operation: 'transition' }),
  ], { orgId: 'org-a', ownsRevenue: true, maxCandidates: 2 }, async (candidate) => {
    seen.push(candidate.row.id);
    return deps;
  }, async () => {
    if (seen.at(-1) === '1') throw new Error('probe pending');
    return {};
  });

  assertEquals(seen, ['1', '2']);
  assertEquals(result, { reconciled: 1, errors: [{ id: '1', error: 'probe pending' }] });
});

Deno.test('C6-T7 an unowned revenue domain is not dispatched', async () => {
  let built = false;
  const result = await reconcileOdooRevenueCandidates([
    candidate('1', { erp_doc_kind: 'sales-invoice', verb: 'submit' }),
  ], { orgId: 'org-a', ownsRevenue: false }, async () => {
    built = true;
    return deps;
  });

  assertEquals(built, false);
  assertEquals(result, { reconciled: 0, errors: [{ id: '1', error: 'domain-not-owned' }] });
});

Deno.test('C6-T7 revenue recovery reserves the candidate probe, commit and read-back budget before dispatch', async () => {
  let remaining = 1;
  let dispatched = false;
  const budget = {
    left: () => remaining > 0,
    spend: (units = 1) => {
      if (units > remaining) return false;
      remaining -= units;
      return true;
    },
  };
  const result = await reconcileOdooRevenueCandidates([
    candidate('1', { erp_doc_kind: 'sales-invoice', verb: 'submit' }),
  ], { orgId: 'org-a', ownsRevenue: true, callBudget: budget }, async () => deps, async () => {
    dispatched = true;
    return {};
  });

  assertEquals([dispatched, remaining], [false, 1], 'a tick that cannot reserve the invoice recovery does not start it');
  assertEquals(result.reconciled, 0);
});
