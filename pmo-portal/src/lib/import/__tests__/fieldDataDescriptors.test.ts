import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  createItem: vi.fn().mockResolvedValue({}), createWarehouse: vi.fn().mockResolvedValue({}),
  createAsset: vi.fn().mockResolvedValue({ id: 'a1' }), setOwnership: vi.fn().mockResolvedValue(undefined), saveRentalTerm: vi.fn().mockResolvedValue('t1'),
  createPerson: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: {
  stock: { master: { createItem: h.createItem, createWarehouse: h.createWarehouse } },
  equipment: { createAsset: h.createAsset },
  equipmentAvailability: { setOwnership: h.setOwnership, saveRentalTerm: h.saveRentalTerm },
  documentExpiry: { createPerson: h.createPerson },
} }));
import { makeStockItemImportDescriptor, makeStockLocationImportDescriptor } from '../stockItemDescriptor';
import { makeEquipmentImportDescriptor } from '../equipmentDescriptor';
import { makePeopleImportDescriptor } from '../employeeDescriptor';
import { validateRows } from '../validateRows';
import { autoMap } from '../autoMap';
import { buildTemplateWorkbook } from '../templateFile';
import { parseWorkbook } from '../parseWorkbook';
import type { ImportDescriptor } from '../types';

const none = async () => [] as string[];
const run = <I,>(d: ImportDescriptor<I>, headers: string[], rows: string[][]) =>
  validateRows(rows, d.fields, autoMap(headers, d.fields), d.validateRow, d.validateSheet);
beforeEach(() => vi.clearAllMocks());

describe('every descriptor: template round trip (AC-IMT-001/002)', () => {
  const all: ImportDescriptor<never>[] = [
    makeStockItemImportDescriptor([{ id: 'u1', code: 'EA' }], none) as never,
    makeStockLocationImportDescriptor([{ id: 'p1', name: 'Alpha' }], none) as never,
    makeEquipmentImportDescriptor([{ id: 'v1', name: 'Rent Co' }], none) as never,
    makePeopleImportDescriptor(none) as never,
  ];
  it.each(all.map((d) => [d.entity, d] as const))('%s: headers are the labels in order and the example row validates', async (_n, d) => {
    const sheet = await parseWorkbook(await buildTemplateWorkbook(d));
    expect(sheet.headers).toEqual(d.fields.map((f) => f.label));
    const v = run(d, sheet.headers, sheet.rows);
    expect(v.map((r) => r.errors)).toEqual([{}]);
    expect(v[0].valid).toBe(true);
  });
});

describe('stock items', () => {
  const d = makeStockItemImportDescriptor([{ id: 'u1', code: 'EA' }], async () => ['cem-50']);
  it('resolves the unit by code and refuses an unknown one naming the field', () => {
    const v = run(d, ['Item code', 'Name', 'Unit'], [['A', 'Alpha', 'EA'], ['B', 'Beta', 'XX']]);
    expect(v[0].valid).toBe(true);
    expect(v[1].errors.unit).toMatch(/not found/);
    expect(d.toInput({ code: 'A', name: 'Alpha', unit: 'ea', leadTimeDays: '7' })).toMatchObject({ unitId: 'u1', leadTimeDays: 7 });
  });
  it('AC-IMT-012: an existing code is keyed case-insensitively so a re-import reports it as already there', async () => {
    const keys = new Set(await d.existingKeys!.load());
    expect(keys.has(d.existingKeys!.keyOf({ code: ' CEM-50 ' }))).toBe(true);
  });
  it('creates through the stock module and sends no org id', async () => {
    await d.create(d.toInput({ code: 'A', name: 'Alpha', unit: 'EA' }));
    expect(h.createItem).toHaveBeenCalledWith({ code: 'A', name: 'Alpha', description: null, unitId: 'u1', leadTimeDays: null });
  });
});

describe('stock locations', () => {
  const d = makeStockLocationImportDescriptor([{ id: 'p1', name: 'Alpha' }], none);
  it('needs a project for a yard and refuses one on a central location', () => {
    const v = run(d, ['Location code', 'Name', 'Kind', 'Project'], [['Y', 'Yard', 'yard', ''], ['C', 'Main', 'central', 'Alpha'], ['S', 'Site', 'site', 'Alpha']]);
    expect(v[0].errors.project).toMatch(/required/);
    expect(v[1].errors.project).toMatch(/no project/);
    expect(v[2].valid).toBe(true);
  });
});

describe('equipment', () => {
  const d = makeEquipmentImportDescriptor([{ id: 'v1', name: 'Rent Co' }], none);
  const H = ['Asset code', 'Name', 'Default unit', 'Ownership', 'Supplier', 'Rental rate', 'Rate basis', 'Currency', 'Rental start', 'Rental end'];
  it('AC-IMT-009: a rented asset with no supplier fails naming the supplier field', () => {
    const v = run(d, H, [['E1', 'Crane', 'hours', 'rented', '', '100', 'day', 'IDR', '2026-01-01', ''], ['E2', 'Truck', 'hours', 'owned', '', '', '', '', '', '']]);
    expect(v[0].errors.vendor).toMatch(/Supplier is required/);
    expect(v[1].valid).toBe(true);
  });
  it('an unknown supplier and an end before the start are row errors', () => {
    const v = run(d, H, [['E1', 'Crane', 'hours', 'rented', 'Nobody', '100', 'day', 'IDR', '2026-02-01', '2026-01-01']]);
    expect(v[0].errors.vendor).toMatch(/not found/);
    expect(v[0].errors.rentedTo).toMatch(/before/);
  });
  it('creates the asset, then ownership and the rental term, only for a rented asset', async () => {
    await d.create(d.toInput({ code: 'E1', name: 'Crane', unit: 'hours', ownership: 'rented', vendor: 'Rent Co', rate: '100', basis: 'month', currency: 'idr', rentedFrom: '2026-01-01' }));
    expect(h.setOwnership).toHaveBeenCalledWith('a1', 'rented', '2026-01-01');
    expect(h.saveRentalTerm).toHaveBeenCalledWith({ asset_id: 'a1', vendor_id: 'v1', rate: '100', basis: 'month', currency: 'IDR', rented_from: '2026-01-01', rented_to: null });
    h.setOwnership.mockClear();
    await d.create(d.toInput({ code: 'E2', name: 'Truck', unit: 'days', ownership: 'owned' }));
    expect(h.setOwnership).not.toHaveBeenCalled();
  });
});

describe('people', () => {
  const d = makePeopleImportDescriptor(none);
  it('AC-IMT-011: the template holds only code and name, no sensitive column', () => {
    expect(d.fields.map((f) => f.key)).toEqual(['code', 'name']);
    expect(d.fields.map((f) => f.label.toLowerCase()).join(' ')).not.toMatch(/salary|email|phone|tax|bank|location|address/);
  });
  it('requires both cells and creates code and name only', async () => {
    const v = run(d, ['Employee code', 'Display name'], [['E-1', ''], ['E-2', 'Sam']]);
    expect(v[0].errors.name).toBeTruthy();
    await d.create(d.toInput({ code: ' E-2 ', name: ' Sam ' }));
    expect(h.createPerson).toHaveBeenCalledWith({ code: 'E-2', name: 'Sam' });
  });
});
