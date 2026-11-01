import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOST_REASON_KEYS, isLostReasonKey, lostReasonLabel, lostReasonValid } from './lostReasons';

const loadCatalogue = (lng: 'en' | 'id') =>
  JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/lostReason.json`), 'utf8'));

describe('lostReasons', () => {
  it('AC-LR-016 / FR-LR-014: the key list is the nine stored keys, in order', () => {
    expect([...LOST_REASON_KEYS]).toEqual([
      'price', 'competitor', 'scope_fit', 'timing', 'capacity', 'relationship', 'client_cancelled', 'no_decision', 'other',
    ]);
  });

  it('FR-LR-002/003: lostReasonValid requires a known key; other needs a note; note max 500', () => {
    expect(lostReasonValid(null, '')).toBe(false);
    expect(lostReasonValid('price', '')).toBe(true);
    expect(lostReasonValid('other', '  ')).toBe(false);
    expect(lostReasonValid('other', 'why')).toBe(true);
    expect(lostReasonValid('bogus', '')).toBe(false);
    expect(lostReasonValid('price', 'x'.repeat(500))).toBe(true);
    expect(lostReasonValid('price', 'x'.repeat(501))).toBe(false);
    expect(isLostReasonKey('timing')).toBe(true);
    expect(isLostReasonKey(undefined)).toBe(false);
  });

  it('FR-LR-014: lostReasonLabel returns the English label per key and "Not recorded" for null', () => {
    const t = (_k: string, d: string) => d;
    expect(LOST_REASON_KEYS.map((k) => lostReasonLabel(t, k))).toEqual([
      'Price', 'Lost to a competitor', 'Scope or fit', 'Timing', 'Our capacity', 'Relationship',
      'Client cancelled or postponed', 'No decision from the client', 'Other',
    ]);
    expect(lostReasonLabel(t, null)).toBe('Not recorded');
    expect(lostReasonLabel(t, 'bogus')).toBe('Not recorded');
  });

  it('AC-LR-016: lostReasonLabel uses the namespaced catalogue keys', () => {
    const seen: string[] = [];
    lostReasonLabel((k, d) => (seen.push(k), d), 'price');
    expect(seen).toEqual(['lostReason:reasons.price']);
  });

  it.each(['en', 'id'] as const)('AC-LR-016: every key has a %s catalogue entry, and the trees match', (lng) => {
    const cat = loadCatalogue(lng);
    for (const k of LOST_REASON_KEYS) expect(cat.reasons[k], `${lng} reasons.${k}`).toBeTruthy();
    expect(cat.notRecorded).toBeTruthy();
    const shape = (o: Record<string, unknown>): string[] =>
      Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? shape(v as Record<string, unknown>).map((s) => `${k}.${s}`) : [k]));
    expect(shape(cat).sort()).toEqual(shape(loadCatalogue('en')).sort());
  });
});
