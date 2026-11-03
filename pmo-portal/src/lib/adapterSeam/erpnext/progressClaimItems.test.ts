import { describe, expect, it } from 'vitest';
import { progressClaimItems, type ProgressClaimRecord } from './progressClaimItems.ts';

const DP: ProgressClaimRecord = {
  id: 'claim-dp', kind: 'down_payment', project_id: 'proj-1', work_order_id: null,
  down_payment_amount: '200000.00', dp_recovery_amount: '0.00', dp_item_code: 'DP-ITEM', withdrawn_at: null,
};
const PROGRESS: ProgressClaimRecord = { ...DP, id: 'claim-1', kind: 'progress', down_payment_amount: null, dp_recovery_amount: '40000.00' };
describe('progressClaimItems', () => {
  it('AC-PB-006 a down payment is one line on its down payment item at its amount', () => {
    expect(progressClaimItems(DP)).toEqual([{ item_code: 'DP-ITEM', qty: 1, rate: 200000 }]);
  });

  it('AC-PB-006 leaves progress claim line construction to the signed-claim dispatcher', () => {
    expect(() => progressClaimItems(PROGRESS))
      .toThrow('Progress claim lines must be resolved from the signed claim');
  });

  it('AC-PB-006 a withdrawn claim cannot be invoiced', () => {
    expect(() => progressClaimItems({ ...DP, withdrawn_at: '2026-10-06T00:00:00Z' }))
      .toThrow('This progress claim was withdrawn, so no invoice can be raised for it');
  });
});
