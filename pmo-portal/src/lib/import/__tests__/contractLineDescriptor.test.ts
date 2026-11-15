import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

const { createBoq } = vi.hoisted(() => ({ createBoq: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { progressBilling: { createBoq } } }));

import { makeContractLineImportDescriptor } from '../contractLineDescriptor';
import { IMPORT_SKIPPED } from '../types';
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

  it('defaults a lot/ls/lump sum unit to lump_sum, as pmo load does', () => {
    expect(d().toInput(good({ unit: 'Lot', quantity: '1' })).earningBasis).toBe('lump_sum');
  });

  it.each([
    ['importKey', { importKey: '' }, /"key" is required/],
    ['importKey', { importKey: 'k'.repeat(501) }, /at most 500/],
    ['itemCode', { itemCode: '' }, /"item_code".*required/],
    ['itemCode', { itemCode: 'x'.repeat(141) }, /at most 140/],
    ['description', { description: '' }, /"description" is required/],
    ['description', { description: 'x'.repeat(501) }, /at most 500/],
    ['unit', { unit: '' }, /"unit" is required/],
    ['unit', { unit: 'x'.repeat(41) }, /at most 40/],
    ['quantity', { quantity: '0' }, /positive number/],
    ['quantity', { quantity: 'abc' }, /positive number/],
    ['quantity', { quantity: '1.2345' }, /3 decimals/],
    ['rate', { rate: '-1' }, /non-negative/],
    ['rate', { rate: '1.234' }, /2 decimals/],
    ['lineNo', { lineNo: '1.5' }, /whole number/],
    ['lineNo', { lineNo: '3000000000' }, /32-bit/],
    ['earningBasis', { earningBasis: 'weekly' }, /"unit_rate" or "lump_sum"/],
    ['quantity', { earningBasis: 'lump_sum', quantity: '2' }, /lump-sum line must have quantity 1/],
  ])('refuses a bad %s (%j) with the CLI wording', (field, over, message) => {
    expect(errs(over)[field as 'importKey']).toMatch(message);
  });

  it('says the same thing as pmo load for the same file', () => {
    const bad = { key: 'L-1', item_code: '', description: 'x', unit: 'm', quantity: 0, rate: 1 };
    const cli = validateContractLinesFile([bad]);
    const app = errs({ itemCode: '', quantity: '0', rate: '1' });
    expect(cli).toEqual(expect.arrayContaining([expect.stringContaining(app.itemCode!)]));
    expect(cli).toEqual(expect.arrayContaining([expect.stringContaining(app.quantity!)]));
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
