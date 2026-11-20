import { describe, expect, it } from 'vitest';
import { financeTestI18n, financeTestI18nReady } from '@/test/financeI18nTestInstance';
import { threeWayMatchHeldMessage } from './threeWayMatchError';

describe('AC-TWM-016 the three-way match hold is named, not "Update failed" (#2622)', () => {
  it('names the hold for MH001 or its detail, in English and Bahasa Indonesia; any other error is not claimed', async () => {
    await financeTestI18nReady;
    await financeTestI18n.changeLanguage('en');
    const t = financeTestI18n.t.bind(financeTestI18n);
    expect(threeWayMatchHeldMessage({ code: 'MH001', message: 'held' }, t)?.headline).toBe('Payment held by the three-way match');
    expect(threeWayMatchHeldMessage({ code: 'P0001', details: 'three-way-match-held' }, t)?.detail).toMatch(/approve an exception/);
    expect(threeWayMatchHeldMessage({ code: '42501' }, t)).toBeNull();
    expect(threeWayMatchHeldMessage(null, t)).toBeNull();
    await financeTestI18n.changeLanguage('id');
    expect(threeWayMatchHeldMessage({ code: 'MH001' }, t)?.headline).toBe('Pembayaran ditahan oleh pencocokan tiga arah');
    await financeTestI18n.changeLanguage('en');
  });
});
