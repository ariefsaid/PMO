import { describe, it, expect } from 'vitest';
import { makeRefLookup, refValidate, refId } from '../refLookup';

const companies = [
  { id: 'c1', name: 'Acme Corp' },
  { id: 'c2', name: 'Globex' },
  { id: 'd1', name: 'Dupe' },
  { id: 'd2', name: 'Dupe' },
];

describe('makeRefLookup', () => {
  const lookup = makeRefLookup(companies, 'Company');

  it('resolves an exact name to its id', () => {
    expect(lookup('Acme Corp')).toEqual({ id: 'c1', error: null });
  });

  it('matches case- and whitespace-insensitively', () => {
    expect(lookup('  acme corp ')).toEqual({ id: 'c1', error: null });
  });

  it('treats an empty cell as null (no error)', () => {
    expect(lookup('   ')).toEqual({ id: null, error: null });
  });

  it('fails a non-empty unmatched name', () => {
    const r = lookup('Nope Ltd');
    expect(r.id).toBeNull();
    expect(r.error).toMatch(/not found/i);
  });

  it('fails an ambiguous (duplicate) name', () => {
    const r = lookup('Dupe');
    expect(r.id).toBeNull();
    expect(r.error).toMatch(/ambiguous/i);
  });
});

describe('refValidate', () => {
  const lookup = makeRefLookup(companies, 'Company');

  it('required + empty → error', () => {
    expect(refValidate(lookup, true)('')).toMatch(/required/i);
  });
  it('optional + empty → ok', () => {
    expect(refValidate(lookup, false)('')).toBeNull();
  });
  it('non-empty no-match → error (even when optional)', () => {
    expect(refValidate(lookup, false)('Nope')).toMatch(/not found/i);
  });
  it('hit → ok', () => {
    expect(refValidate(lookup, true)('Globex')).toBeNull();
  });
});

describe('refId', () => {
  const lookup = makeRefLookup(companies, 'Company');
  it('returns the id for a hit, null for empty', () => {
    expect(refId(lookup, 'Globex')).toBe('c2');
    expect(refId(lookup, '')).toBeNull();
  });
});
