import { describe, expect, it } from 'vitest';
import { progressClaimItems, type ProgressClaimRecord } from './progressClaimItems.ts';

const DP: ProgressClaimRecord = {
  id: 'claim-dp', kind: 'down_payment', project_id: 'proj-1', work_order_id: null,
  down_payment_amount: '200000.00', dp_recovery_amount: '0.00', dp_item_code: 'DP-ITEM', withdrawn_at: null,
};
const PROGRESS: ProgressClaimRecord = { ...DP, id: 'claim-1', kind: 'progress', down_payment_amount: null, dp_recovery_amount: '40000.00' };
const LINE = { item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: '4.000', rate: '50000.00' };

describe('progressClaimItems', () => {
  it('AC-PB-006 a down payment is one line on its down payment item at its amount', () => {
    expect(progressClaimItems(DP, [])).toEqual([{ item_code: 'DP-ITEM', qty: 1, rate: 200000 }]);
  });

  it('AC-PB-006 a progress claim is its lines plus a negative recovery line on the down payment item', () => {
    expect(progressClaimItems(PROGRESS, [LINE])).toEqual([
      { item_code: 'SURVEY', qty: 4, rate: 50000, description: 'Route survey (km)' },
      { item_code: 'DP-ITEM', qty: 1, rate: -40000 },
    ]);
  });

  it('AC-PB-006 a progress claim that recovers nothing has no recovery line', () => {
    expect(progressClaimItems({ ...PROGRESS, dp_recovery_amount: '0.00', dp_item_code: null }, [LINE])).toEqual([
      { item_code: 'SURVEY', qty: 4, rate: 50000, description: 'Route survey (km)' },
    ]);
  });

  it('AC-PB-006 a withdrawn claim cannot be invoiced', () => {
    expect(() => progressClaimItems({ ...PROGRESS, withdrawn_at: '2026-10-06T00:00:00Z' }, [LINE]))
      .toThrow('This progress claim was withdrawn, so no invoice can be raised for it');
  });

  it('AC-PB-006 a progress claim with no lines cannot be invoiced', () => {
    expect(() => progressClaimItems(PROGRESS, [])).toThrow('This progress claim has no quantity lines');
  });

  it('AC-PB-006 a recovery without a down payment item cannot be invoiced', () => {
    expect(() => progressClaimItems({ ...PROGRESS, dp_item_code: null }, [LINE]))
      .toThrow('This progress claim recovers a down payment but names no down payment item');
  });
});
