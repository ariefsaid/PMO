import { describe, expect, it } from 'vitest';
import { PROCUREMENT_MODELS, procurementCapabilityGap } from './capabilities.ts';

const full = {
  later: { 'purchase.order': true, 'purchase.order.line': true, 'stock.picking': true, 'stock.move': true, 'account.move': true, 'account.payment': true },
  models: { 'account.journal': { exists: true, read: true } },
};

describe('AC-OPP-001 procurement capability gap', () => {
  it('names the seven models a purchase needs', () => {
    expect([...PROCUREMENT_MODELS].sort()).toEqual(['account.journal', 'account.move', 'account.payment', 'purchase.order', 'purchase.order.line', 'stock.move', 'stock.picking']);
  });
  it('finds nothing missing in a full snapshot', () => {
    expect(procurementCapabilityGap(full)).toBeNull();
  });
  it.each(['purchase.order', 'purchase.order.line', 'stock.picking', 'stock.move', 'account.move', 'account.payment'])('AC-OPP-001 names %s when it is absent or unreadable', (model) => {
    expect(procurementCapabilityGap({ ...full, later: { ...full.later, [model]: false } })).toBe(model);
    const { [model]: _gone, ...rest } = full.later as Record<string, boolean>;
    expect(procurementCapabilityGap({ ...full, later: rest })).toBe(model);
  });
  it('AC-OPP-001 names the journal when it is absent or unreadable', () => {
    expect(procurementCapabilityGap({ ...full, models: { 'account.journal': { exists: true, read: false } } })).toBe('account.journal');
    expect(procurementCapabilityGap({ ...full, models: {} })).toBe('account.journal');
  });
  it('fails closed on no snapshot at all', () => {
    expect(procurementCapabilityGap(undefined)).toBe('purchase.order');
    expect(procurementCapabilityGap(null)).toBe('purchase.order');
    expect(procurementCapabilityGap({})).toBe('purchase.order');
  });
});
