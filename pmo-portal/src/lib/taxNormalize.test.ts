import { expect, it } from 'vitest';
import { normalizeTaxAmount } from './taxNormalize';
import { normalizeTaxAmount as viaTaxTreatment } from './taxTreatment';

it('AC-AIN-014 inclusive 1,110,000 with 110,000 tax re-bases to 1,000,000 before tax; one implementation', () => {
  expect(normalizeTaxAmount(1_110_000, 110_000, 'inclusive', 'exclusive')).toBe(1_000_000);
  expect(normalizeTaxAmount(1_000_000, 110_000, 'exclusive', 'exclusive')).toBe(1_000_000);
  expect(normalizeTaxAmount(10, 20, 'inclusive', 'exclusive')).toBeNull();
  expect(viaTaxTreatment).toBe(normalizeTaxAmount);
});
