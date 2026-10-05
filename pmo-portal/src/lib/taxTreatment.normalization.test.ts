import { normalizeTaxAmount } from './taxTreatment';

describe('stored tax basis normalization', () => {
  it('AC-UNB-003: normalizes stored invoice amounts to the comparison basis', () => {
    expect(normalizeTaxAmount(1_100, 100, 'exclusive', 'inclusive')).toBe(1_200);
    expect(normalizeTaxAmount(1_100, 100, 'inclusive', 'exclusive')).toBe(1_000);
    expect(normalizeTaxAmount(1_100, 100, 'inclusive', 'inclusive')).toBe(1_100);
  });

  it('AC-UNB-003: refuses amounts whose stored tax facts cannot support a comparison', () => {
    expect(normalizeTaxAmount(1_000, 1_001, 'inclusive', 'exclusive')).toBeNull();
    expect(normalizeTaxAmount(1_000, 0, 'unknown', 'exclusive')).toBeNull();
    expect(normalizeTaxAmount(Number.NaN, 0, 'exclusive', 'inclusive')).toBeNull();
  });
});
