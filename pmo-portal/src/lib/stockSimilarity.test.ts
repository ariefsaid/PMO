import { describe, it, expect } from 'vitest';
import {
  MAX_NEAR_DUPLICATES,
  findNearDuplicateItems,
  indexStockItems,
  normalizeStockName,
  typoAllowance,
  type StockNameItem,
} from './stockSimilarity';

const item = (id: string, code: string, name: string, archived_at: string | null = null): StockNameItem => ({ id, code, name, archived_at });

describe('normalizeStockName', () => {
  it('AC-NDI-001 folds case, spaces and punctuation so the same name compares equal', () => {
    expect(normalizeStockName('Cement 50 kg')).toBe('cement50kg');
    expect(normalizeStockName('CEMENT-50KG')).toBe('cement50kg');
    expect(normalizeStockName('  cement   50   kg  ')).toBe('cement50kg');
  });

  it('AC-NDI-001 folds accents to the base letter', () => {
    expect(normalizeStockName('Cémént 50 kg')).toBe('cement50kg');
    expect(normalizeStockName('Besi Bëton')).toBe('besibeton');
  });

  it('AC-NDI-004 returns empty for input with no letters or digits', () => {
    expect(normalizeStockName('   -/  ')).toBe('');
    expect(normalizeStockName('')).toBe('');
  });
});

describe('typoAllowance', () => {
  it('AC-NDI-004 only compares short names for equality', () => {
    expect(typoAllowance(0)).toBe(0);
    expect(typoAllowance(3)).toBe(0);
    expect(typoAllowance(4)).toBe(0);
  });

  it('AC-NDI-002 allows one typo from five characters and two from ten', () => {
    expect(typoAllowance(5)).toBe(1);
    expect(typoAllowance(9)).toBe(1);
    expect(typoAllowance(10)).toBe(2);
    expect(typoAllowance(40)).toBe(2);
  });
});

  // the within-allowance question (`withinDistance`) is answered where the distance is needed (the duplicate finder
  // sorts by it), so there is no boolean wrapper to test here (#2753); the transposition case is pinned below.

describe('indexStockItems', () => {
  it('AC-NDI-003 indexes active items only, with the normalised key', () => {
    const index = indexStockItems([
      item('i1', 'CEM-50', 'Cement 50 kg'),
      item('i2', 'CEM-OLD', 'Cement 50 kgs', '2026-02-01T00:00:00Z'),
    ]);
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ id: 'i1', code: 'CEM-50', name: 'Cement 50 kg', key: 'cement50kg' });
  });
});

describe('findNearDuplicateItems', () => {
  const index = indexStockItems([
    item('i1', 'CEM-50', 'Cement 50 kg'),
    item('i2', 'CEM-40', 'Cement 40 kg'),
    item('i3', 'STL-12', 'Steel bar 12 mm'),
    item('i4', 'AGG', 'Aggregate'),
    item('i5', 'CAT', 'Cat'),
    item('i6', 'CAR', 'Car'),
  ]);

  it('AC-NDI-001 finds the same name written with different case and spacing', () => {
    const found = findNearDuplicateItems('cement 50kg', index);
    expect(found[0].code).toBe('CEM-50');
    expect(found.map((m) => m.code)).not.toContain('STL-12');
  });

  it('AC-NDI-001 also flags a near variant with one different figure, closest first', () => {
    const found = findNearDuplicateItems('Cement 50 kg', index);
    expect(found.map((m) => m.code)).toEqual(['CEM-50', 'CEM-40']);
  });

  it('AC-NDI-002 finds a small typo', () => {
    const found = findNearDuplicateItems('Cemnet 50 kg', index);
    expect(found[0].code).toBe('CEM-50');
  });

  it('AC-NDI-004 leaves short names alone when one letter differs', () => {
    expect(findNearDuplicateItems('Car', index).map((m) => m.code)).toEqual(['CAR']);
  });

  it('AC-NDI-004 returns nothing below three normalised characters or with no close match', () => {
    expect(findNearDuplicateItems('', index)).toEqual([]);
    expect(findNearDuplicateItems('ce', index)).toEqual([]);
    expect(findNearDuplicateItems('Bricks', index)).toEqual([]);
  });

  it('AC-NDI-003 never offers an archived item', () => {
    const withArchived = indexStockItems([item('i9', 'CEM-OLD', 'Cement 50 kg', '2026-02-01T00:00:00Z')]);
    expect(findNearDuplicateItems('Cement 50 kg', withArchived)).toEqual([]);
  });

  it('orders the closest first and caps the list', () => {
    const many = indexStockItems([
      item('a', 'CEM-51', 'Cement 51 kg'),
      item('b', 'CEM-52', 'Cement 50 kg'),
      item('c', 'CEM-53', 'Cement 50 kgs'),
      item('d', 'CEM-54', 'Cement 60 kg'),
    ]);
    const found = findNearDuplicateItems('Cement 50 kg', many, 3);
    expect(found).toHaveLength(MAX_NEAR_DUPLICATES);
    expect(found[0].code).toBe('CEM-52');
  });
});
