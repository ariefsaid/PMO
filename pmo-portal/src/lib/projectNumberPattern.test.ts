import { describe, expect, it } from 'vitest';
import { previewProjectNumber, projectNumberYear, validateProjectNumberPattern } from './projectNumberPattern';

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

describe('AC-UWC-002 organisation-year extraction', () => {
  const instant = new Date('2026-12-31T18:00:00Z');

  it.each([
    ['UTC', 'UTC', 26],
    ['Asia/Jakarta', 'Asia/Jakarta', 27],
  ])('uses %s calendar year for the shared creation instant', (_name, timezone, expected) => {
    expect(projectNumberYear(instant, timezone)).toBe(expected);
  });

  it('returns null for an invalid instant or unusable timezone', () => {
    expect(projectNumberYear(new Date(Number.NaN), 'UTC')).toBeNull();
    expect(projectNumberYear(instant, 'Not/A_Real_Zone')).toBeNull();
  });
});

describe('UX-075 supported-token preview', () => {
  it('expands the system default without a client segment', () => {
    expect(previewProjectNumber('PRJ-{YY}-{SEQ4}', 26)).toBe('PRJ-26-0312');
  });

  it('expands every supported token of a custom pattern, passing literal text through', () => {
    expect(previewProjectNumber('PRE-{CLIENT}-{YY}-P-{SEQ4}', 26)).toBe('PRE-NSN-26-P-0312');
    expect(previewProjectNumber('{CLIENT}{YY}{SEQ4}', 4)).toBe('NSN040312');
  });

  it('pads the two-digit year and is a pure function of its inputs', () => {
    expect(previewProjectNumber('PRJ-{YY}-{SEQ4}', 4)).toBe('PRJ-04-0312');
  });
});
