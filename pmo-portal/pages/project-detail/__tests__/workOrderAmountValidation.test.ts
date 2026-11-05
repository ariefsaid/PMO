import { describe, it, expect } from 'vitest';
import { validateWorkOrderAmount as v } from '../workOrderAmountValidation';

describe('validateWorkOrderAmount (#1549 OE07-001)', () => {
  it('accepts scale-2 non-negative value with a treatment and tax', () => {
    expect(v('1000.50', 'exclusive', '10')).toEqual({});
    expect(v('0', 'exclusive', '0')).toEqual({});
  });
  it('rejects invalid, negative and scale-3 values', () => {
    expect(v('', 'exclusive', '0').value).toBe('value');
    expect(v('-1', 'exclusive', '0').value).toBe('value');
    expect(v('1.005', 'exclusive', '0').value).toBe('value');
  });
  it('requires a treatment, and a tax amount once one is chosen', () => {
    expect(v('10', '', '').taxTreatment).toBe('treatmentRequired');
    expect(v('10', 'exclusive', '').taxAmount).toBe('taxAmount');
  });
  it('inclusive tax may equal but not exceed the value', () => {
    expect(v('100', 'inclusive', '100')).toEqual({});
    expect(v('100', 'inclusive', '100.01').taxAmount).toBe('inclusiveTaxTooLarge');
    expect(v('100', 'exclusive', '500')).toEqual({});
  });
});
