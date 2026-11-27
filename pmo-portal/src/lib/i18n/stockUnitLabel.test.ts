import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stockUnitCode, stockUnitName } from './stockUnitLabel';

type Catalogue = Record<string, unknown>;
const load = (lng: string): Catalogue => JSON.parse(readFileSync(`public/locales/${lng}/stock.json`, 'utf8')) as Catalogue;
const tFor = (cat: Catalogue) => (key: string, fallback: string): string => {
  const hit = key.split('.').reduce<unknown>((a, p) => (a as Catalogue | undefined)?.[p], cat);
  return typeof hit === 'string' ? hit : fallback;
};

const seeded = [
  { code: 'bag', name: 'Bag' }, { code: 'm', name: 'Metre' }, { code: 'kg', name: 'Kilogram' },
  { code: 'pcs', name: 'Piece' }, { code: 'L', name: 'Litre' },
];

describe('#2445 stock unit names read in the interface language', () => {
  it('shows a Bahasa reader the Bahasa name of every seeded unit, never the English one', () => {
    const t = tFor(load('id'));
    expect(seeded.map((u) => stockUnitName(u, t))).toEqual(['Sak', 'Meter', 'Kilogram', 'Buah', 'Liter']);
  });

  it('shows a Bahasa reader sak and buah beside a quantity of bags and pieces', () => {
    const t = tFor(load('id'));
    expect(seeded.map((u) => stockUnitCode(u.code, t))).toEqual(['sak', 'm', 'kg', 'buah', 'L']);
  });

  it('keeps the English reader on the stored name and code', () => {
    const t = tFor(load('en'));
    expect(seeded.map((u) => stockUnitName(u, t))).toEqual(['Bag', 'Metre', 'Kilogram', 'Piece', 'Litre']);
    expect(seeded.map((u) => stockUnitCode(u.code, t))).toEqual(['bag', 'm', 'kg', 'pcs', 'L']);
  });

  it('leaves a unit the organisation renamed or added exactly as typed', () => {
    const t = tFor(load('id'));
    expect(stockUnitName({ code: 'bag', name: 'Bag (25 kg)' }, t)).toBe('Bag (25 kg)');
    expect(stockUnitName({ code: 'roll', name: 'Roll' }, t)).toBe('Roll');
    expect(stockUnitCode('roll', t)).toBe('roll');
  });
});
