import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import ExcelJS from 'exceljs';
import { useImportWizard } from '../useImportWizard';
import { buildTemplateWorkbook } from '@/src/lib/import/templateFile';
import { makeWorkOrderImportDescriptor } from '@/src/lib/import/workOrderDescriptor';

const importBatch = vi.fn();
vi.mock('@/src/lib/repositories', () => ({ repositories: { workOrder: { importBatch: (...a: unknown[]) => importBatch(...a) } } }));

const deps = {
  projectId: 'p1', currency: 'IDR',
  areas: [{ id: 'a1', code: 'N1', name: 'North' }],
  boqLines: [{ id: 'b1', itemCode: 'B-1', quantity: 100 }],
  existingReferences: async () => ['PO-OLD'],
};
const descriptor = makeWorkOrderImportDescriptor(deps);
const HEAD = ['Title', 'Client reference', 'Area', 'Start date', 'End date', 'Order value', 'Tax treatment', 'Tax amount', 'Currency'];

/** A real workbook from the template: the person fills the first sheet and, optionally, the second. */
async function fileWith(rows: string[][], scope: string[][]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildTemplateWorkbook(descriptor));
  const [main, second] = wb.worksheets;
  main.spliceRows(2, 1); // drop the example row
  rows.forEach((r) => main.addRow(r));
  second.spliceRows(2, 1);
  scope.forEach((r) => second.addRow(r));
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const f = new File(['x'], 'wo.xlsx');
  Object.defineProperty(f, 'arrayBuffer', { value: async () => buf });
  return f;
}

async function preview(rows: string[][], scope: string[][]) {
  const hook = renderHook(() => useImportWizard(descriptor));
  await act(async () => { await hook.result.current.selectFile(await fileWith(rows, scope)); });
  await waitFor(() => expect(hook.result.current.existingStatus).toBe('ready'));
  return hook;
}

describe('work-order import wizard (AC-WOI-001..004)', () => {
  it('AC-WOI-001 the template has the first sheet, the scope sheet second, and notes third', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildTemplateWorkbook(descriptor));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Template', 'Scope lines', 'Notes']);
    expect(wb.worksheets[0].getRow(1).values).toEqual([undefined, ...HEAD]);
    expect(wb.worksheets[1].getRow(1).values).toEqual([undefined, 'Client reference', 'Item code', 'Quantity']);
  });

  it('AC-WOI-002 a clean file previews valid and the scope lines ride on their work order', async () => {
    const hook = await preview(
      [['Pump pad', 'PO-1', 'North', '2026-12-01', '2026-12-31', '1000', 'exclusive', '', 'IDR'], ['Tank base', 'PO-2', '', '', '', '500', 'inclusive', '50', '']],
      [['PO-1', 'B-1', '40']],
    );
    expect(hook.result.current.counts).toEqual({ valid: 2, invalid: 0, total: 2 });
    await act(async () => { await hook.result.current.commit(); });
    expect(importBatch).toHaveBeenCalledTimes(1);
    const [project, sent] = importBatch.mock.calls[0];
    expect(project).toBe('p1');
    expect(sent[0]).toMatchObject({ title: 'Pump pad', clientPoNumber: 'PO-1', areaId: 'a1', orderValue: 1000, taxTreatment: 'exclusive', lines: [{ boqItemId: 'b1', quantity: 40 }] });
    expect(sent[1]).toMatchObject({ clientPoNumber: 'PO-2', taxAmount: 50, areaId: null, lines: [] });
    expect(hook.result.current.result?.created).toBe(2);
  });

  it('AC-WOI-003 one bad row blocks the whole file: errors are named, nothing is sent', async () => {
    importBatch.mockClear();
    const hook = await preview(
      [['Good', 'PO-1', '', '', '', '10', 'exclusive', '', ''], ['', 'PO-2', 'Nowhere', '2026-13-01', '', 'abc', 'maybe', '', 'USD']],
      [],
    );
    const bad = hook.result.current.validation[1];
    expect(Object.keys(bad.errors).sort()).toEqual(['area', 'currency', 'orderValue', 'startDate', 'taxTreatment', 'title']);
    expect(hook.result.current.counts.invalid).toBe(1);
    await act(async () => { await hook.result.current.commit(); });
    expect(importBatch).not.toHaveBeenCalled();
    expect(hook.result.current.step).toBe('preview');
  });

  it('AC-WOI-003 a client reference already on the project refuses the file', async () => {
    importBatch.mockClear();
    const hook = await preview([['Dup', 'po-old', '', '', '', '10', 'exclusive', '', '']], []);
    expect(hook.result.current.alreadyCount).toBe(1);
    await act(async () => { await hook.result.current.commit(); });
    expect(importBatch).not.toHaveBeenCalled();
  });

  it('AC-WOI-003 scope lines are checked: unknown item, over the contract quantity', async () => {
    const hook = await preview(
      [['One', 'PO-1', '', '', '', '10', 'exclusive', '', ''], ['Two', 'PO-2', '', '', '', '10', 'exclusive', '', '']],
      [['PO-1', 'X-9', '1'], ['PO-2', 'B-1', '500']],
    );
    expect(hook.result.current.validation[0].errors.title).toMatch(/Scope sheet row 2: "X-9" is not a contract line/);
    expect(hook.result.current.validation[1].errors.title).toMatch(/Scope sheet row 3: quantity 500 is more than the contract line holds \(100\)/);
  });

  it('AC-WOI-003 a scope row naming no work order refuses the file with its row', async () => {
    const hook = renderHook(() => useImportWizard(descriptor));
    await act(async () => {
      await hook.result.current.selectFile(await fileWith([['One', 'PO-1', '', '', '', '10', 'exclusive', '', '']], [['PO-9', 'B-1', '1']]));
    });
    expect(hook.result.current.parseError).toMatch(/Scope sheet row 2: no work order has client reference "PO-9"/);
    expect(hook.result.current.parsed).toBeNull();
  });

  it('AC-WOI-004 a database refusal leaves nothing created and reports every row', async () => {
    importBatch.mockReset();
    importBatch.mockRejectedValueOnce(new Error('IMPORT_ROW 2: boom'));
    const hook = await preview([['One', 'PO-1', '', '', '', '10', 'exclusive', '', ''], ['Two', 'PO-2', '', '', '', '10', 'exclusive', '', '']], []);
    await act(async () => { await hook.result.current.commit(); });
    expect(hook.result.current.result?.created).toBe(0);
    expect(hook.result.current.result?.failed).toHaveLength(2);
  });
});
