/** purchase-order.revise (v1) — a PMO revision is applied to the ERP order once and adopts the same order on replay. */
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
    it('AC-OPP-016 / AC-OPP-017 applies a revision once and adopts that order on replay', async () => {
      const r = revise();
      const first = await r.post(REVISION);
      const replay = await r.post(REVISION);

      expect(replay.externalId).toBe(first.externalId);
      expect(r.documents()).toEqual([{ externalId: first.externalId, key: REVISION.key }]);
    });
  });
}
