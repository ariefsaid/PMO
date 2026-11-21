import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ create: vi.fn(), updateDraft: vi.fn() }));
vi.mock('@/src/lib/repositories/clientRequisitions', () => ({ clientRequisitionRepository: { create: h.create, updateDraft: h.updateDraft } }));
import { makeClientTakeoffImportDescriptor } from '../clientTakeoffDescriptor';
import { validateRows } from '../validateRows';
import { autoMap } from '../autoMap';
import { buildTemplateWorkbook } from '../templateFile';
import { parseWorkbook } from '../parseWorkbook';
import type { ImportDescriptor } from '../types';

const run = <I,>(d: ImportDescriptor<I>, headers: string[], rows: string[][]) =>
  validateRows(rows, d.fields, autoMap(headers, d.fields), d.validateRow, d.validateSheet);
const items = [{ id: 'i1', code: 'CEM', name: 'Cement', wholeOnly: true }, { id: 'i2', code: 'SND', name: 'Sand', wholeOnly: false }];
const D = () => makeClientTakeoffImportDescriptor({ workOrderId: 'wo1', items });
const headers = ['Item code', 'Take-off quantity', 'Requested quantity'];

beforeEach(() => { vi.clearAllMocks(); h.create.mockResolvedValue('r1'); h.updateDraft.mockResolvedValue(undefined); });

describe('FR-CSR-003 client take-off import', () => {
  it('the template round trips: headers are the labels in order and the example row validates', async () => {
    const d = D();
    const sheet = await parseWorkbook(await buildTemplateWorkbook(d));
    expect(sheet.headers).toEqual(headers);
    expect(run(d, sheet.headers, sheet.rows).map((r) => r.errors)).toEqual([{}]);
  });

  it('validates a row like manual entry: item must be a client-supplied item, quantity above 0 with 3 decimals, whole units where the unit demands', () => {
    const v = run(D(), headers, [
      ['', '5', ''],
      ['NOPE', '5', ''],
      ['CEM', '0', ''],
      ['CEM', '1.5', ''],
      ['SND', '1.2345', ''],
      ['SND', '1.5', 'abc'],
    ]);
    const ok = run(D(), headers, [['cem', '100', '90'], ['SND', '2.5', '']]);
    expect(v[0].errors.itemCode).toBeTruthy();
    expect(v[1].errors.itemCode).toMatch(/not found|not a client-supplied/i);
    expect(v[2].errors.takeoff).toBeTruthy();
    expect(v[3].errors.takeoff).toMatch(/whole/i);
    expect(v[4].errors.takeoff).toBeTruthy();
    expect(v[5].errors.requested).toBeTruthy();
    expect(ok.map((r) => r.valid)).toEqual([true, true]);
  });

  it('a repeated item code fails on the repeat, naming the first row', () => {
    const v = run(D(), headers, [['CEM', '5', ''], [' cem ', '6', ''], ['SND', '1', '']]);
    expect(v[0].valid).toBe(true);
    expect(v[1].errors.itemCode).toMatch(/row 2/i);
    expect(v[2].valid).toBe(true);
  });

  it('maps cells to a line with exact quantity strings and no org id, project or cost', () => {
    const d = D();
    expect(d.toInput({ itemCode: ' cem ', takeoff: '100', requested: '' })).toEqual({ stockItemId: 'i1', takeoffQuantity: '100', requestedQuantity: undefined });
    expect(d.toInput({ itemCode: 'SND', takeoff: '2.5', requested: '3' })).toEqual({ stockItemId: 'i2', takeoffQuantity: '2.5', requestedQuantity: '3' });
  });

  it('the rows of one import become the lines of ONE draft requisition for the work order, through the repository', async () => {
    const d = D();
    await d.create(d.toInput({ itemCode: 'CEM', takeoff: '100', requested: '' }));
    await d.create(d.toInput({ itemCode: 'SND', takeoff: '2.5', requested: '3' }));
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0]).toEqual({ workOrderId: 'wo1', clientReference: null });
    expect(h.create.mock.calls[0][1]).toEqual([{ stockItemId: 'i1', takeoffQuantity: '100', requestedQuantity: undefined }]);
    expect(h.updateDraft).toHaveBeenCalledTimes(1);
    expect(h.updateDraft.mock.calls[0][0]).toBe('r1');
    expect(h.updateDraft.mock.calls[0][2]).toEqual([
      { stockItemId: 'i1', takeoffQuantity: '100', requestedQuantity: undefined },
      { stockItemId: 'i2', takeoffQuantity: '2.5', requestedQuantity: '3' },
    ]);
  });

  it('a row the database refuses is left out of the draft; the next row still lands', async () => {
    const d = D();
    await d.create(d.toInput({ itemCode: 'CEM', takeoff: '100', requested: '' }));
    h.updateDraft.mockRejectedValueOnce(new Error('CSR_INVALID: line 2 is counted in whole units'));
    await expect(d.create(d.toInput({ itemCode: 'SND', takeoff: '2.5', requested: '' }))).rejects.toThrow(/whole units/);
    await d.create(d.toInput({ itemCode: 'SND', takeoff: '4', requested: '' }));
    expect(h.updateDraft.mock.calls[1][2]).toEqual([
      { stockItemId: 'i1', takeoffQuantity: '100', requestedQuantity: undefined },
      { stockItemId: 'i2', takeoffQuantity: '4', requestedQuantity: undefined },
    ]);
  });
});
