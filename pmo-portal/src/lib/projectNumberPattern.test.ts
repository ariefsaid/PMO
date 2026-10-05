import { describe, expect, it } from 'vitest';
import { validateProjectNumberPattern } from './projectNumberPattern';

describe('AC-CODE-001 project-number pattern grammar', () => {
  it('accepts the system default', () => {
    expect(validateProjectNumberPattern('PRJ-{YY}-{SEQ4}')).toEqual({ valid: true });
  });

  it('accepts literal text with each required token exactly once', () => {
    expect(validateProjectNumberPattern('RIS-{CLIENT}-{YY}-P-{SEQ4}')).toEqual({ valid: true });
  });

  it.each([
    ['{YY}-{SEQ4}', /CLIENT/],
    ['{CLIENT}-{SEQ4}', /YY/],
    ['{CLIENT}-{YY}', /SEQ4/],
    ['{CLIENT}-{CLIENT}-{YY}-{SEQ4}', /once/],
    ['{CLIENT}-{YY}-{SEQ4}-{SEQ4}', /once/],
    ['{CLIENT}-{YY}-{SEQ4}-{UNKNOWN}', /unknown/i],
    ['{CLIENT}-{YY}-{SEQ4', /brace/i],
    ['CLIENT}-{YY}-{SEQ4}', /brace/i],
    ['  ', /empty/i],
  ])('rejects invalid pattern %s with an actionable reason', (pattern, reason) => {
    const result = validateProjectNumberPattern(pattern);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(reason);
  });
});
