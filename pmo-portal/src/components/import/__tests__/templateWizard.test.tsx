import { act, renderHook } from '@testing-library/react';
import ExcelJS from 'exceljs';
import { expect, it, vi } from 'vitest';
import { useImportWizard } from '../useImportWizard';
import { buildTemplateWorkbook } from '@/src/lib/import/templateFile';
import type { ImportDescriptor } from '@/src/lib/import';

const create = vi.fn().mockResolvedValue({});
const d = (version: number): ImportDescriptor<{ code: string }> => ({
  entity: 'Things', fields: [{ key: 'code', label: 'Code', required: true, validate: (v) => (v ? null : 'Code is required') }],
  template: { version, example: { code: 'X' } }, toInput: (c) => ({ code: c.code }), create,
});
const file = (buffer: ArrayBuffer) => ({ name: 't.xlsx', arrayBuffer: async () => buffer }) as File;

it('AC-IMT-007: a template two versions old is refused with a message and nothing is created', async () => {
  const old = await buildTemplateWorkbook(d(1));
  const { result } = renderHook(() => useImportWizard(d(3)));
  await act(async () => { await result.current.selectFile(file(old)); });
  expect(result.current.parseError).toMatch(/out of date/i);
  expect(result.current.step).toBe('upload');
  expect(create).not.toHaveBeenCalled();
});

it('AC-IMT-002: the previous version is still accepted and its example imports', async () => {
  const prev = await buildTemplateWorkbook(d(2));
  const { result } = renderHook(() => useImportWizard(d(3)));
  await act(async () => { await result.current.selectFile(file(prev)); });
  expect(result.current.parseError).toBeNull();
  act(() => result.current.goPreview());
  await act(async () => { await result.current.commit(); });
  expect(result.current.result).toMatchObject({ created: 1, failed: [] });
});

it('AC-IMT-003/004: a partly bad file imports the good rows; the failed-rows file re-imports once fixed', async () => {
  const { buildFailedRowsWorkbook } = await import('@/src/lib/import/failedRowsFile');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
  ws.addRow(['Code']); ws.addRow(['A']); ws.addRow([null]); ws.addRow(['C']); ws.addRow([null]);
  const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const desc = d(1); create.mockClear();
  const { result } = renderHook(() => useImportWizard(desc));
  await act(async () => { await result.current.selectFile(file(buf)); });
  act(() => result.current.goPreview());
  expect(result.current.counts).toEqual({ valid: 2, invalid: 0, total: 2 });
  await act(async () => { await result.current.commit(); });
  expect(create).toHaveBeenCalledTimes(2);
  // a failed-rows file keeps headers, so mapping it works unchanged
  const failedBuf = await buildFailedRowsWorkbook({ headers: ['Code'], rows: [['Z']], failed: [{ index: 0, reason: 'r' }], skipped: [], labels: { sheet: 'F', alreadyThere: 'T', rowInFile: 'Row in your file', reason: 'Reason' } });
  const again = renderHook(() => useImportWizard(desc));
  await act(async () => { await again.result.current.selectFile(file(failedBuf)); });
  act(() => again.result.current.goPreview());
  expect(again.result.current.counts.valid).toBe(1);
});
