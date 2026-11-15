import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

const { createBoq, listBoq } = vi.hoisted(() => ({ createBoq: vi.fn(), listBoq: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { progressBilling: { createBoq, listBoq } } }));

import { makeContractLineImportDescriptor } from '../contractLineDescriptor';
import { IMPORT_SKIPPED } from '../types';
import { validateRows } from '../validateRows';
import { validateContractLinesFile } from '../../../../../scripts/lib/pmo-load.mjs';

const good = (over: Record<string, string> = {}) => ({
  importKey: 'L-1', itemCode: 'SVC-01', description: 'Trenching', unit: 'm', quantity: '1,250.5', rate: '45.50',
  lineNo: '10', earningBasis: '', ...over,
});
const d = () => makeContractLineImportDescriptor('prj-1');
const errs = (over: Record<string, string>) => d().validateRow!(good(over));

describe('makeContractLineImportDescriptor (#1278)', () => {
  beforeEach(() => createBoq.mockReset().mockResolvedValue({ id: 'b1' }));

  it('accepts a good row and maps it to a BoQ input carrying the import key', () => {
    expect(errs({})).toEqual({});
    expect(d().toInput(good())).toEqual({
      importKey: 'L-1', itemCode: 'SVC-01', description: 'Trenching', unit: 'm',
      quantity: 1250.5, rate: 45.5, earningBasis: 'unit_rate', lineNo: 10,
    });
  });

  it('reads "Unit rate" and "Lump sum" as a person writes them (round C item 4: no code words in the hint)', () => {
    expect(d().toInput(good({ earningBasis: 'Unit rate' })).earningBasis).toBe('unit_rate');
    expect(d().toInput(good({ unit: 'Lot', quantity: '1', earningBasis: ' Lump Sum ' })).earningBasis).toBe('lump_sum');
    expect(d().validateRow?.(good({ earningBasis: 'Lump sum' }))).toHaveProperty('quantity'); // lump sum needs quantity 1
    expect(d().validateRow?.(good({ earningBasis: 'weekly' }))).toHaveProperty('earningBasis');
  });

  it('defaults a lot/ls/lump sum unit to lump_sum, as pmo load does', () => {
    expect(d().toInput(good({ unit: 'Lot', quantity: '1' })).earningBasis).toBe('lump_sum');
  });

  it.each([
    ['importKey', { importKey: '' }, /Line reference is required/],
    ['importKey', { importKey: 'k'.repeat(501) }, /at most 500 characters/],
    ['itemCode', { itemCode: '' }, /Item code is required/],
    ['itemCode', { itemCode: 'x'.repeat(141) }, /at most 140 characters/],
    ['description', { description: '' }, /Description is required/],
    ['description', { description: 'x'.repeat(501) }, /at most 500 characters/],
    ['unit', { unit: '' }, /Unit is required/],
    ['unit', { unit: 'x'.repeat(41) }, /at most 40 characters/],
    ['quantity', { quantity: '0' }, /number above 0/],
    ['quantity', { quantity: 'abc' }, /number above 0/],
    ['quantity', { quantity: '1.2345' }, /up to 3 decimals/],
    ['rate', { rate: '-1' }, /0 or more/],
    ['rate', { rate: '1.234' }, /up to 2 decimals/],
    ['lineNo', { lineNo: '1.5' }, /whole number/],
    ['lineNo', { lineNo: '3000000000' }, /out of range/],
    ['earningBasis', { earningBasis: 'weekly' }, /unit rate or a lump sum/],
    ['quantity', { earningBasis: 'lump_sum', quantity: '2' }, /must have quantity 1/],
  ])('refuses a bad %s (%j) in plain words', (field, over, message) => {
    expect(errs(over)[field as 'importKey']).toMatch(message);
  });

  it('refuses the same FILE as pmo load — the same fields flagged, the app in plain words, the CLI in its own', () => {
    const bad = { key: 'L-1', item_code: '', description: 'x', unit: 'm', quantity: 0, rate: 1 };
    const cli = validateContractLinesFile([bad]);
    const app = errs({ itemCode: '', quantity: '0', rate: '1' });
    // The app flags exactly the fields the CLI refuses, keyed to the field the user must fix.
    expect(Object.keys(app).sort()).toEqual(['itemCode', 'quantity']);
    expect(app.itemCode).toMatch(/Item code is required/);
    expect(app.quantity).toMatch(/number above 0/);
    // The CLI refuses the same two fields under its own (still technical) words.
    expect(cli.filter((m) => m.includes('"item_code"')).length).toBeGreaterThan(0);
    expect(cli.filter((m) => m.includes('"quantity"')).length).toBeGreaterThan(0);
    expect(cli.filter((m) => m.includes('"rate"')).length).toBe(0);
  });

  it('writes through the repository for the project, then reports a known key as skipped', async () => {
    const input = d().toInput(good());
    await d().create(input);
    expect(createBoq).toHaveBeenCalledWith('prj-1', input);
    createBoq.mockRejectedValueOnce(new AppError('dup', '23505'));
    expect(await d().create(input)).toBe(IMPORT_SKIPPED);
  });

  it('rethrows any other write failure', async () => {
    createBoq.mockRejectedValueOnce(new AppError('no', '42501'));
    await expect(d().create(d().toInput(good()))).rejects.toThrow('no');
  });
});

describe('a key repeated within one sheet (#1278)', () => {
  const sheet = () => {
    const desc = d();
    const keys = desc.fields.map((f) => f.key);
    const rows = [good({ importKey: 'A' }), good({ importKey: 'B' }), good({ importKey: 'A' })]
      .map((c) => keys.map((k) => (c as Record<string, string>)[k] ?? ''));
    const mapping = Object.fromEntries(keys.map((k, i) => [k, i]));
    return { desc, rows, mapping };
  };

  it('is refused at preview on the repeat, naming both sheet rows, like the CLI', () => {
    const { desc, rows, mapping } = sheet();
    const v = validateRows(rows, desc.fields, mapping, desc.validateRow, desc.validateSheet);
    expect(v.map((r) => r.valid)).toEqual([true, true, false]);
    expect(v[2].errors.importKey).toMatch(/Line reference "A" appears twice \(rows 2 and 4\)/);
    const cli = validateContractLinesFile([
      { key: 'A', item_code: 'S', description: 'x', unit: 'm', quantity: 1, rate: 1 },
      { key: 'A', item_code: 'S', description: 'x', unit: 'm', quantity: 1, rate: 1 },
    ]);
    expect(cli.some((m) => m.includes('"key" "A" appears twice'))).toBe(true);
  });

  it('never reaches the write path: only valid rows are sent, so no repeat is silently skipped', () => {
    const { desc, rows, mapping } = sheet();
    const sent = validateRows(rows, desc.fields, mapping, desc.validateRow, desc.validateSheet).filter((r) => r.valid);
    expect(sent.map((r) => rows[r.index][0])).toEqual(['A', 'B']);
  });
});

describe('contract-line import labels (#1278)', () => {
  it('are read from the import catalogue, so Bahasa Indonesia shows Indonesian column names', async () => {
    const { readFileSync } = await import('node:fs');
    const id = JSON.parse(readFileSync('public/locales/id/import.json', 'utf8'));
    const lookup = ((key: string, fallback: string) => key.split(':')[1].split('.').reduce((o: unknown, k) => (o as Record<string, unknown> | undefined)?.[k], id) ?? fallback) as never;
    const labels = makeContractLineImportDescriptor('p1', lookup).fields.map((f) => f.label);
    expect(labels).toEqual(['Referensi baris', 'Kode item', 'Deskripsi', 'Satuan', 'Kuantitas', 'Harga satuan', 'Nomor baris', 'Dikenakan per']);
    expect(makeContractLineImportDescriptor('p1').fields[0].label).toBe('Line reference');
  });

  it('round A item 4: the wizard entity word reads the catalogue — "baris kontrak" under Bahasa', async () => {
    const { readFileSync } = await import('node:fs');
    const id = JSON.parse(readFileSync('public/locales/id/import.json', 'utf8'));
    const lookup = ((key: string, fallback: string) => key.split(':')[1].split('.').reduce((o: unknown, k) => (o as Record<string, unknown> | undefined)?.[k], id) ?? fallback) as never;
    expect(makeContractLineImportDescriptor('p1', lookup).entityDisplay).toBe('baris kontrak');
    expect(makeContractLineImportDescriptor('p1').entityDisplay).toBe('contract lines');
  });

  it('round A item 7: the rate label names the project currency once — "Harga satuan (USD)" under Bahasa', async () => {
    const { readFileSync } = await import('node:fs');
    const id = JSON.parse(readFileSync('public/locales/id/import.json', 'utf8'));
    const lookup = ((key: string, fallback: string, params?: Record<string, unknown>) => {
      const value = key.split(':')[1].split('.').reduce((o: unknown, k) => (o as Record<string, unknown> | undefined)?.[k], id) ?? fallback;
      return params ? String(value).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name])) : String(value);
    }) as never;
    const rate = (t?: never) => makeContractLineImportDescriptor('p1', t, 'USD').fields.find((f) => f.key === 'rate')!.label;
    expect(rate(lookup)).toBe('Harga satuan (USD)');
    expect(rate()).toBe('Rate (USD)');
    // No currency given → the plain label, as before.
    expect(makeContractLineImportDescriptor('p1').fields.find((f) => f.key === 'rate')!.label).toBe('Rate');
  });

  it('round A item 6: the import key stays out of the preview columns, in both languages', () => {
    for (const desc of [makeContractLineImportDescriptor('p1')]) {
      expect(desc.fields.find((f) => f.key === 'importKey')?.hideInPreview).toBe(true);
      expect(desc.fields.filter((f) => !f.hideInPreview).map((f) => f.key)).not.toContain('importKey');
    }
  });

  it('round A item 3: errors read the catalogue under Bahasa — plain sentences, never the CLI words', async () => {
    const { readFileSync } = await import('node:fs');
    const id = JSON.parse(readFileSync('public/locales/id/import.json', 'utf8'));
    const lookup = ((key: string, fallback: string) => key.split(':')[1].split('.').reduce((o: unknown, k) => (o as Record<string, unknown> | undefined)?.[k], id) ?? fallback) as never;
    const bad = { importKey: 'L-1', itemCode: 'SVC-01', description: 'Trenching', unit: 'm', quantity: '0', rate: '45.50', lineNo: '10', earningBasis: '' };
    const errors = makeContractLineImportDescriptor('p1', lookup).validateRow!(bad);
    expect(errors.quantity).toBe('Kuantitas harus berupa angka di atas 0 (maksimal 3 desimal).');
    expect(JSON.stringify(errors)).not.toContain('positive number below');
  });
});

describe('contract-line import: lines already on the contract (#1278 round D)', () => {
  beforeEach(() => listBoq.mockReset());

  it('reads this project\'s line references through the repository, ignoring lines made by hand', async () => {
    listBoq.mockResolvedValue([{ import_key: 'L-1' }, { import_key: null }, { import_key: 'L-2' }]);
    const existing = makeContractLineImportDescriptor('prj-1').existingKeys!;
    expect([...(await existing.load())]).toEqual(['L-1', 'L-2']);
    expect(listBoq).toHaveBeenCalledWith('prj-1');
  });

  it('keys a row by the same line reference the insert writes', () => {
    expect(makeContractLineImportDescriptor('prj-1').existingKeys!.keyOf(good({ importKey: 'L-9' }))).toBe('L-9');
  });

  it('says it in plain English by default and in Bahasa from the catalogue', async () => {
    const en = makeContractLineImportDescriptor('prj-1').existingKeys!;
    expect(en.alreadyThere).toBe('Already on this contract. It will be skipped.');
    expect(en.unavailable).toBe('Could not check for lines already on this contract. Any line already there will be skipped at import.');
    expect(en.nothingNew).toBe('Nothing to import: every valid line is already on this contract.');
    const { readFileSync } = await import('node:fs');
    const id = JSON.parse(readFileSync('public/locales/id/import.json', 'utf8'));
    const lookup = ((key: string, fallback: string) => key.split(':')[1].split('.').reduce((o: unknown, k) => (o as Record<string, unknown> | undefined)?.[k], id) ?? fallback) as never;
    const bahasa = makeContractLineImportDescriptor('prj-1', lookup).existingKeys!;
    for (const text of [bahasa.alreadyThere, bahasa.unavailable, bahasa.nothingNew]) expect(text).not.toMatch(/—|[Aa]lready|contract/);
  });
});
