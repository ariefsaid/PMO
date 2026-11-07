import { assertEquals } from '@std/assert';
import { checkPoRevise, poReviseRecoveryDecision } from './poReviseGuard.ts';
import { reviseCancels, TIER_REVISE_CANCELS } from './dispatchAdapters.ts';
import { purchaseOrderReviseKey } from '../../../pmo-portal/src/lib/adapterSeam/purchaseOrderRevise.ts';

const ORG = '15130000-0000-0000-0000-00000000000a';
const PO = '15130000-0000-0000-0000-000000000101';
function rpcClient(answer: string | null, fail = false) {
  const calls: Array<Record<string, unknown>> = [];
  return { calls, rpc: async (_fn: string, args: Record<string, unknown>) => {
    calls.push(args); return fail ? { data: null, error: { message: 'boom' } } : { data: answer, error: null }; } };
}

Deno.test('AC-SCA-012 a revise that would cancel a PO with a submitted bill is refused before any ERP write', async () => {
  const c = rpcClient('po_has_submitted_bill');
  const r = await checkPoRevise(c, ORG, { poId: PO, revision: 2 }, { reviseCancels: true });
  assertEquals(r, { ok: false, status: 422, message: 'po_has_submitted_bill' });
  assertEquals(c.calls[0], { p_org: ORG, p_po_id: PO, p_revision: 2, p_revise_cancels: true });
});

Deno.test('AC-SCA-012 a stale issued revision is refused as superseded, before any ERP write', async () => {
  const r = await checkPoRevise(rpcClient('revision_superseded'), ORG, { poId: PO, revision: 1 }, { reviseCancels: false });
  assertEquals(r, { ok: false, status: 422, message: 'revision_superseded' });
});

Deno.test('AC-SCA-012 a revise the database allows passes', async () => {
  assertEquals(await checkPoRevise(rpcClient(null), ORG, { poId: PO, revision: 2 }, { reviseCancels: false }),
    { ok: true, status: 200, message: '' });
});

Deno.test('AC-SCA-012 an unanswerable guard refuses (fail closed)', async () => {
  const r = await checkPoRevise(rpcClient(null, true), ORG, { poId: PO, revision: 2 }, { reviseCancels: true });
  assertEquals(r, { ok: false, status: 422, message: 'gate-check-failed' });
});

Deno.test('AC-SCA-012 a command with no readable po or revision is refused without asking', async () => {
  const c = rpcClient(null);
  assertEquals((await checkPoRevise(c, ORG, { poId: '', revision: 2 }, { reviseCancels: true })).ok, false);
  assertEquals((await checkPoRevise(c, ORG, { poId: PO, revision: Number.NaN }, { reviseCancels: true })).ok, false);
  assertEquals(c.calls.length, 0);
});

Deno.test('AC-SCA-011 one PMO revision has one key: a retry after a mid-way failure reuses it', () => {
  assertEquals(purchaseOrderReviseKey(PO, 2), `porev:${PO}:2`);
  assertEquals(purchaseOrderReviseKey(PO, 2), purchaseOrderReviseKey(PO, 2));
});

// AC-SCA-011 scope: #1505 owns the transport, so here the owning test proves the shipped seam module that the
// #1505 dispatch must call (key derivation + recovery decision). #1505's done-condition adds the wiring test that
// dispatch.ts recovery for `purchase-order.revise` calls poReviseRecoveryDecision (spec note 12).
Deno.test('AC-SCA-011 recovery after an inconclusive probe holds, never reissues (at most one ERP revision)', () => {
  assertEquals(poReviseRecoveryDecision({ probe: 'inconclusive' }), 'held');
  assertEquals(poReviseRecoveryDecision({ probe: 'found', key: `porev:${PO}:2`, expectedKey: `porev:${PO}:2` }), 'adopt');
  assertEquals(poReviseRecoveryDecision({ probe: 'found', key: `porev:${PO}:3`, expectedKey: `porev:${PO}:2` }), 'held');
  assertEquals(poReviseRecoveryDecision({ probe: 'absent-conclusive' }), 'reissue');
});

Deno.test('AC-OPP-017 the cancel flag is the tier\'s own: ERPNext cancels and amends, Odoo edits in place, an unknown tier is strict', () => {
  assertEquals(TIER_REVISE_CANCELS, { erpnext: true, odoo: false });
  assertEquals([reviseCancels('erpnext'), reviseCancels('odoo'), reviseCancels('other'), reviseCancels(undefined)], [true, false, true, true]);
});

Deno.test('AC-OPP-017 the flag reaches the database question unchanged: the cancel path is evaluated only when the tier cancels', async () => {
  const erp = rpcClient(null), odoo = rpcClient(null);
  await checkPoRevise(erp, ORG, { poId: PO, revision: 2 }, { reviseCancels: reviseCancels('erpnext') });
  await checkPoRevise(odoo, ORG, { poId: PO, revision: 2 }, { reviseCancels: reviseCancels('odoo') });
  assertEquals([erp.calls[0].p_revise_cancels, odoo.calls[0].p_revise_cancels], [true, false]);
});
