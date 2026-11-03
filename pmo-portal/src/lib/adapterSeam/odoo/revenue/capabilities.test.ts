import { describe, expect, it } from 'vitest';
import { REVENUE_MODELS, revenueCapabilityGap } from './capabilities.ts';

const ok = { exists: true, read: true };
const full = {
  later: { 'account.move': true, 'account.move.line': true, 'account.payment': true },
  models: { 'account.journal': ok, 'account.tax': ok, 'account.account': ok },
};

describe('AC-OCI-001 revenue capability gap', () => {
  it('names the six models an invoice and a receipt need', () => {
    expect([...REVENUE_MODELS].sort()).toEqual(['account.account', 'account.journal', 'account.move', 'account.move.line', 'account.payment', 'account.tax']);
  });
  it('finds nothing missing in a full snapshot', () => {
    expect(revenueCapabilityGap(full)).toBeNull();
  });
  it.each(['account.move', 'account.move.line', 'account.payment'])('names %s when it is absent or unreadable', (model) => {
    expect(revenueCapabilityGap({ ...full, later: { ...full.later, [model]: false } })).toBe(model);
    const { [model]: _gone, ...rest } = full.later as Record<string, boolean>;
    expect(revenueCapabilityGap({ ...full, later: rest })).toBe(model);
  });
  it.each(['account.journal', 'account.tax', 'account.account'])('names %s when it is absent or unreadable', (model) => {
    expect(revenueCapabilityGap({ ...full, models: { ...full.models, [model]: { exists: true, read: false } } })).toBe(model);
    expect(revenueCapabilityGap({ ...full, models: { ...full.models, [model]: { exists: false, read: false } } })).toBe(model);
    const { [model]: _gone, ...rest } = full.models as Record<string, typeof ok>;
    expect(revenueCapabilityGap({ ...full, models: rest })).toBe(model);
  });
  it('fails closed on no snapshot at all', () => {
    for (const snapshot of [undefined, null, {}]) expect(revenueCapabilityGap(snapshot)).toBe('account.move');
  });
});
