import { describe, expect, it } from 'vitest';
import { purchaseAttribution } from './purchaseAttribution';

describe('JOB-PU2 purchaseAttribution', () => {
  it('starts a receipt or bill on the order\'s work order and discipline', () => {
    expect(purchaseAttribution({ work_order_id: 'wo-header', discipline_id: null, purchase_orders: [{ work_order_id: 'wo-order', discipline_id: 'd-1' }] }))
      .toEqual({ workOrderId: 'wo-order', disciplineId: 'd-1' });
  });
  it('falls back to the purchase itself when no order names one', () => {
    expect(purchaseAttribution({ work_order_id: 'wo-header', discipline_id: 'd-2', purchase_orders: [{ work_order_id: null, discipline_id: null }] }))
      .toEqual({ workOrderId: 'wo-header', disciplineId: 'd-2' });
  });
  it('is project level when nothing was chosen', () => {
    expect(purchaseAttribution({})).toEqual({ workOrderId: null, disciplineId: null });
  });
});
