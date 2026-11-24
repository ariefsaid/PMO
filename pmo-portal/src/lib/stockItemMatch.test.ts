import { describe, expect, it } from 'vitest';
import { matchStockItems, type StockItemOption } from './stockItemMatch';

const CATALOG: StockItemOption[] = [
  { id: 'si-1', code: 'EL-7018', name: 'Welding Electrode E7018' },
  { id: 'si-2', code: 'BLT-M16', name: 'Hex Bolt M16 Galvanized' },
  { id: 'si-3', code: 'PIPE-2IN', name: 'Carbon Steel Pipe 2 Inch' },
  { id: 'si-4', code: 'OLD-01', name: 'Welding Electrode Old', archived: true },
];

describe('matchStockItems (AC-PSI-001, AC-PSI-002)', () => {
  it('excludes archived items even on empty or exact query', () => {
    const all = matchStockItems(CATALOG, '');
    expect(all.map((i) => i.id)).toEqual(['si-1', 'si-2', 'si-3']);
    expect(matchStockItems(CATALOG, 'Welding Electrode Old').map((i) => i.id)).not.toContain('si-4');
  });

  it('matches by code even when hyphens or spaces differ', () => {
    expect(matchStockItems(CATALOG, 'EL7018')[0]?.id).toBe('si-1');
    expect(matchStockItems(CATALOG, 'blt m16')[0]?.id).toBe('si-2');
  });

  it('offers existing items for near-duplicate spellings and reordered words', () => {
    expect(matchStockItems(CATALOG, 'Welding Elctrode E-7018')[0]?.id).toBe('si-1');
    expect(matchStockItems(CATALOG, 'Electrode Welding 7018')[0]?.id).toBe('si-1');
    expect(matchStockItems(CATALOG, 'Galvanised Hex Bolts M16')[0]?.id).toBe('si-2');
  });

  it('returns empty for an unrelated free-text description', () => {
    expect(matchStockItems(CATALOG, 'Custom fabricated site bracket')).toEqual([]);
  });
});
