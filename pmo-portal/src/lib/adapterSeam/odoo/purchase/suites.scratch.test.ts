import { createOdooHarness } from '../contract.harness.ts';
import { purchasePushSuite, billPushSuite, vendorPaymentPushSuite, purchaseLinkExistingSuite } from '../../contractSuite/procurement.suite.ts';
import { cutoverPurchaseSuite } from '../../contractSuite/cutoverPurchase.suite.ts';
import { cutoverSuite } from '../../contractSuite/cutover.suite.ts';
const h = createOdooHarness();
purchasePushSuite(h); billPushSuite(h); vendorPaymentPushSuite(h); purchaseLinkExistingSuite(h); cutoverPurchaseSuite(h); cutoverSuite(h);
import { expect, it } from 'vitest';
import { purchaseOrderReviseKey } from '../../purchaseOrderRevise.ts';
it('replays an interrupted revision once', async () => {
  const r = h.revise!();
  const poId = '123e4567-e89b-12d3-a456-426614174000';
  const command = { key: purchaseOrderReviseKey(poId, 2), poId, revision: 2, lines: [{ itemRef: '1', quantity: '2', rate: '10', unit: 'each' }] };
  r.failNextWrite('lost-response');
  await expect(r.post(command)).rejects.toThrow();
  await r.post(command);
  expect(r.documents()).toHaveLength(1);
});
