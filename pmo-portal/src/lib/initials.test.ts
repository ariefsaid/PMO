import { describe, expect, it } from 'vitest';
import { initials } from './initials';

describe('initials (#1459: one helper for every avatar tile)', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Ayu Prasetyo')).toBe('AP');
    expect(initials('  budi   santoso  ')).toBe('BS');
  });

  it('only reads the first two words of a longer name', () => {
    expect(initials('Rina Kartika Dewi')).toBe('RK');
  });

  it('uses the first letter of a single-word name by default', () => {
    expect(initials('Finance')).toBe('F');
  });

  it('can read an entity tile: a single word as two letters, a longer name as first + last', () => {
    expect(initials('Finance', { style: 'tile' })).toBe('FI');
    expect(initials('Ayu Prasetyo', { style: 'tile' })).toBe('AP');
    expect(initials('Rina Kartika Dewi', { style: 'tile' })).toBe('RD');
  });

  it('falls back to "?" for an empty or missing name, or to the caller\'s own marker', () => {
    expect(initials('')).toBe('?');
    expect(initials(null)).toBe('?');
    expect(initials('   ')).toBe('?');
    expect(initials(undefined, { fallback: 'U' })).toBe('U');
    expect(initials('', { fallback: '' })).toBe('');
  });
});
