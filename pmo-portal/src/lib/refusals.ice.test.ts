import { describe, it, expect } from 'vitest';
import en from '../../public/locales/en/refusals.json';
import id from '../../public/locales/id/refusals.json';
import { parseRefusal, refusalText } from '@/src/lib/refusals';

const CODES = ['ICE_PERIOD', 'ICE_SPLIT_OVER_LINE', 'ICE_WO_CANCELLED', 'ICE_WO_PROJECT'] as const;

describe('AC-CAE-014 cash estimate refusals', () => {
  it('AC-CAE-014 each code has an English and a Bahasa Indonesia sentence that says what to do next', () => {
    for (const c of CODES) {
      const e = (en as Record<string, string>)[c];
      const i = (id as Record<string, string>)[c];
      expect(e, c).toMatch(/\S/);
      expect(i, c).toMatch(/\S/);
      expect(i, c).not.toBe(e);
      expect(e.split('. ').length, `${c} en names a next step`).toBeGreaterThan(1);
      expect(i.split('. ').length, `${c} id names a next step`).toBeGreaterThan(1);
    }
  });
  it('AC-CAE-014 a database refusal parses to its code', () => {
    const r = parseRefusal({ message: 'ICE_SPLIT_OVER_LINE: the splits would add up to 1 against a line of 0' });
    expect(r?.family).toBe('ICE');
    expect(r?.code).toBe('ICE_SPLIT_OVER_LINE');
    expect(refusalText).toBeDefined();
  });
});
