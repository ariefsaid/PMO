import { describe, it, expect } from 'vitest';
import { autoMap } from '../autoMap';
import { validateRows } from '../validateRows';
import { makeStockMovementHistoryDescriptor, movementRowFromCells, STOCK_MOVEMENT_MAX_ROWS } from '../stockMovementHistoryDescriptor';

const d = makeStockMovementHistoryDescriptor();
const keys = d.fields.map((f) => f.key);
const check = (cells: Record<string, string>) => {
  const row = keys.map((k) => cells[k] ?? '');
  const mapping = Object.fromEntries(keys.map((k, i) => [k, i]));
  return validateRows([row], d.fields, mapping)[0];
};
const good = { date: '2026-01-15', location: 'WH-01', item: 'CEM-50', direction: 'in', quantity: '10', unitCost: '5.25', reference: 'DN-1' };

describe('opening stock movement template', () => {
  it('AC-OSH-013 has the seven documented columns, the cap, and an example row that passes its own checks', () => {
    expect(keys).toEqual(['date', 'location', 'item', 'direction', 'quantity', 'unitCost', 'reference']);
    expect(d.fields.filter((f) => f.required).map((f) => f.key)).toEqual(['date', 'location', 'item', 'direction', 'quantity']);
    expect(d.maxRows).toBe(STOCK_MOVEMENT_MAX_ROWS);
    expect(STOCK_MOVEMENT_MAX_ROWS).toBe(5000);
    expect(check(d.template!.example).valid).toBe(true);
  });
  it('AC-OSH-013 accepts Bahasa headers as aliases', () => {
    const headers = ['Tanggal', 'Lokasi', 'Barang', 'Arah', 'Jumlah', 'Biaya satuan', 'Referensi'];
    expect(Object.values(autoMap(headers, d.fields))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
  it('AC-OSH-013 a blank cost and blank reference are fine; the direction may be written in either language', () => {
    expect(check({ ...good, unitCost: '', reference: '', direction: 'KELUAR' }).valid).toBe(true);
    expect(movementRowFromCells({ ...good, direction: 'Masuk' }).direction).toBe('in');
    expect(movementRowFromCells({ ...good, direction: 'keluar' }).direction).toBe('out');
  });
  it.each([
    ['date', { date: '15/01/2026' }], ['date', { date: '2026-02-30' }],
    ['direction', { direction: 'sideways' }],
    ['quantity', { quantity: '0' }], ['quantity', { quantity: '-1' }], ['quantity', { quantity: '1.2345' }], ['quantity', { quantity: 'ten' }],
    ['unitCost', { unitCost: '-2' }], ['unitCost', { unitCost: '1.23456' }],
    ['location', { location: '' }], ['item', { item: '' }],
    ['reference', { reference: 'x'.repeat(101) }],
  ])('AC-OSH-013 refuses a bad %s cell before any call', (field, patch) => {
    const r = check({ ...good, ...patch });
    expect(r.valid).toBe(false);
    expect(r.errors[field]).toBeTruthy();
  });
});
