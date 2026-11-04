/** purchase-order.revise (v1) — the fake ERP applies a revision once and adopts the same order on replay. */
import { describe, expect, it } from 'vitest';
import { purchaseOrderReviseKey, type PurchaseOrderRevise } from '../purchaseOrderRevise.ts';
import type { ErpHarness } from './harness.ts';

const PO_ID = '123e4567-e89b-42d3-a456-426614174000';
const REVISION: PurchaseOrderRevise = {
  key: purchaseOrderReviseKey(PO_ID, 2),
  poId: PO_ID,
  revision: 2,
  lines: [{ itemRef: 'Cable tray', quantity: '5.000', rate: '12.00', unit: '' }],
};

export function purchaseOrderReviseSuite(h: ErpHarness): void {
  const revise = h.revise ?? (() => { throw new Error(`${h.tier} declares purchase-order.revise supported but has no revise()`); });
  describe(`purchase-order.revise (${h.tier})`, () => {
    it('applies a revision once and adopts that order on replay', async () => {
      const r = revise();
      const first = await r.post(REVISION);
      const replay = await r.post(REVISION);

      expect(replay.externalId).toBe(first.externalId);
      expect(r.documents()).toEqual([{ externalId: first.externalId, key: REVISION.key }]);
    });

    it('adopts the same order after Odoo applies a revision but its response is lost', async () => {
      const r = revise();
      const first = await r.post(REVISION);
      const nextRevision: PurchaseOrderRevise = {
        ...REVISION,
        key: purchaseOrderReviseKey(PO_ID, 3),
        revision: 3,
        lines: [{ itemRef: 'Cable tray', quantity: '6.000', rate: '12.00', unit: '' }],
      };

      r.failNextWrite('lost-response');
      await expect(r.post(nextRevision)).rejects.toThrow(/unreachable/);
      const replay = await r.post(nextRevision);

      expect(replay.externalId).toBe(first.externalId);
      expect(r.documents()).toEqual([
        { externalId: first.externalId, key: REVISION.key },
        { externalId: first.externalId, key: nextRevision.key },
      ]);
    });
  });
}
