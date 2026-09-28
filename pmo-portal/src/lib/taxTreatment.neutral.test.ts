import { describe, expect, it } from 'vitest';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { parseNeutralTaxFacts } from './taxTreatment';

const EN = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

describe('neutral tax-fact import parsing', () => {
  it('keeps the dot-decimal convention and target precision independent of the active locale', () => {
    for (const locale of [ID, EN]) {
      setActiveLocale(locale);
      expect(parseNeutralTaxFacts('inclusive', '1.23')).toEqual({ taxTreatment: 'inclusive', taxAmount: 1.23 });
      expect(parseNeutralTaxFacts('inclusive', '1,234.56')).toEqual({ taxTreatment: 'inclusive', taxAmount: 1234.56 });
      expect(parseNeutralTaxFacts('inclusive', '1.234')).toBeNull();
      expect(parseNeutralTaxFacts('inclusive', '12,34')).toBeNull();
    }
  });
});
