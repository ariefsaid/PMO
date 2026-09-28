import { afterEach, describe, expect, it } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { parseTaxFacts } from './taxTreatment';

const EN = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

afterEach(() => resetActiveLocale());

describe('tax-fact parsing and target scale', () => {
  it('AC-PLC-009: an on-screen tax amount follows the selected number locale and scale-2 target', () => {
    setActiveLocale(ID);
    expect(parseTaxFacts('inclusive', '1.234')).toEqual({ taxTreatment: 'inclusive', taxAmount: 1234 });

    setActiveLocale(EN);
    expect(parseTaxFacts('inclusive', '1.234')).toBeNull();
    expect(parseTaxFacts('inclusive', '1.23')).toEqual({ taxTreatment: 'inclusive', taxAmount: 1.23 });
  });

});
