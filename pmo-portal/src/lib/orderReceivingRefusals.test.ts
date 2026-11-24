import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { refusalText } from './refusals';
import { formatDay } from './format';
import en from '@/public/locales/en/refusals.json';
import id from '@/public/locales/id/refusals.json';

describe('receipt exchange-rate refusal', () => {
  for (const lang of ['en', 'id']) it(`AC-RGO-006 names the pair and formatted day in ${lang}`, async () => {
    const instance = i18next.createInstance();
    await instance.init({ lng: lang, resources: { en: { refusals: en }, id: { refusals: id } } });
    const result = refusalText({ message: 'RGO_FX_MISSING: No exchange rate for USD/IDR on 2026-11-24.', details: JSON.stringify({ base: 'USD', quote: 'IDR', date: '2026-11-24' }) }, instance.t.bind(instance));
    expect(result.known).toBe(true);
    expect(result.headline).toContain('USD/IDR');
    expect(result.headline).toContain(formatDay('2026-11-24'));
    expect(result.headline).not.toContain('2026-11-24');
  });
});
