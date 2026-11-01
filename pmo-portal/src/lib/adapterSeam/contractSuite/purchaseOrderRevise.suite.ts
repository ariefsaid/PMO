/**
 * purchase-order.revise (v1) — the effective lines of one PMO revision reach the ERP once, by key (#1513, AC-SCA-011):
 * a retry after a lost answer never makes a second revision. No tier declares it supported yet (#1505), so this suite
 * runs only once a tier's harness has revise().
 */
import { describe, expect, it } from 'vitest';
import { purchaseOrderReviseKey, type PurchaseOrderRevise } from '../purchaseOrderRevise.ts';
import type { ErpHarness, ReviseHarness, Suite } from './harness.ts';

const PO = '15130000-0000-0000-0000-000000000101';
const REVISE: PurchaseOrderRevise = {
  key: purchaseOrderReviseKey(PO, 2), poId: PO, revision: 2,
  lines: [{ itemRef: 'L1', quantity: '120.000', rate: '100000.00', unit: 'm3' }],
};

function reviseOf(h: ErpHarness): ReviseHarness {
  if (!h.revise) throw new Error(`${h.tier} declares purchase-order.revise supported but its harness has no revise()`);
  return h.revise();
}

export const purchaseOrderReviseSuite: Suite = (h) => describe(`purchase-order.revise (${h.tier})`, () => {
  it('AC-SCA-011 one revision posts one document under its key', async () => {
    const r = reviseOf(h);
    const { externalId } = await r.post(REVISE);
    expect(r.documents()).toEqual([{ externalId, key: REVISE.key }]);
  });

  it('AC-SCA-011 posting the same key again adopts the first document: no second revision', async () => {
    const r = reviseOf(h);
    const first = await r.post(REVISE);
    expect(await r.post(REVISE)).toEqual(first);
    expect(r.documents()).toHaveLength(1);
  });

  it('AC-SCA-011 a lost answer then a retry leaves exactly one document', async () => {
    const r = reviseOf(h);
    r.failNextWrite('lost-response');
    await expect(r.post(REVISE)).rejects.toMatchObject({ code: 'external-unreachable' });
    const retry = await r.post(REVISE);
    const docs = r.documents();
    expect(docs).toHaveLength(1);
    expect(docs[0].externalId).toBe(retry.externalId);
  });
});
