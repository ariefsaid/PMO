import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildTemplateWorkbook } from '../templateFile';
import { buildFailedRowsWorkbook } from '../failedRowsFile';
import { checkTemplateMarker, templateMarker } from '../templateVersion';
import { parseWorkbook } from '../parseWorkbook';
import { autoMap } from '../autoMap';
import type { ImportDescriptor } from '../types';

type In = { code: string; unit: string; note?: string };
const fake: ImportDescriptor<In> = {
  entity: 'Fake things',
  fields: [
    { key: 'code', label: 'Code', required: true, validate: () => null, hint: 'Your own code' },
    { key: 'unit', label: 'Unit', required: true, validate: () => null, aliases: ['Satuan'] },
    { key: 'note', label: 'Note', required: false, validate: () => null },
  ],
  template: { version: 3, example: { code: 'A-1', unit: 'm' }, lists: { unit: ['m', 'kg'] } },
  toInput: (c) => ({ code: c.code, unit: c.unit }),
  create: async () => ({}),
};

const load = async (buf: ArrayBuffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb; };

describe('template download', () => {
  it('AC-IMT-001: headers equal field labels in order, example row, Notes lists every field', async () => {
    const wb = await load(await buildTemplateWorkbook(fake));
    const ws = wb.worksheets[0];
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(['Code', 'Unit', 'Note']);
    expect(ws.getRow(2).getCell(1).value).toBe('A-1');
    const notes = wb.worksheets[1];
    const names = [2, 3, 4].map((r) => notes.getRow(r).getCell(1).value);
    expect(names).toEqual(['Code', 'Unit', 'Note']);
    expect(notes.getRow(2).getCell(2).value).toBe('Required');
    expect(notes.getRow(2).getCell(3).value).toBe('Your own code');
  });
  it('FR-IMT-003: a closed list becomes a dropdown on data rows', async () => {
    const wb = await load(await buildTemplateWorkbook(fake));
    const dv = wb.worksheets[0].getCell('B5').dataValidation;
    expect(dv?.type).toBe('list');
    expect(dv?.formulae?.[0]).toContain('m,kg');
  });
  it('AC-IMT-002: the template with the example row round-trips through parse and map', async () => {
    const sheet = await parseWorkbook(await buildTemplateWorkbook(fake));
    expect(sheet.rows).toEqual([['A-1', 'm', '']]);
    expect(autoMap(sheet.headers, fake.fields)).toEqual({ code: 0, unit: 1, note: 2 });
    expect(sheet.templateMarker).toBe(templateMarker(fake));
  });
  it('AC-IMT-007: current and previous versions pass, older ones are refused', () => {
    const at = (v: number) => `pmo-import-template:Fake things:v${v}`;
    expect(checkTemplateMarker(fake, at(3))).toBe('ok');
    expect(checkTemplateMarker(fake, at(2))).toBe('ok');
    expect(checkTemplateMarker(fake, at(1))).toBe('outOfDate');
    expect(checkTemplateMarker(fake, null)).toBe('ok');
    expect(checkTemplateMarker(fake, 'pmo-import-template:Other:v1')).toBe('ok');
  });
  it('FR-IMT-006: formula-leading example cells are written as text', async () => {
    const d = { ...fake, template: { version: 1, example: { code: '=HYPERLINK("x")', unit: '+1' } } };
    const ws = (await load(await buildTemplateWorkbook(d))).worksheets[0];
    expect(ws.getCell('A2').value).toBe("'=HYPERLINK(\"x\")");
    expect(ws.getCell('B2').value).toBe("'+1");
  });
});

describe('failed rows download', () => {
  const headers = ['Code', 'Unit'];
  const rows = [['A', 'm'], ['B', 'bad'], ['=HYPERLINK("x")', 'kg'], ['D', 'm']];
  it('AC-IMT-003/005/006: only failed rows, with file row number, reason, text-escaped', async () => {
    const wb = await load(await buildFailedRowsWorkbook({
      headers, rows, failed: [{ index: 2, reason: 'Bad code' }, { index: 1, reason: 'Unknown unit' }],
      skipped: [3], labels: { rowInFile: 'Row in your file', reason: 'Reason', alreadyThere: 'Already there', sheet: 'Failed rows' },
    }));
    const ws = wb.worksheets[0];
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(['Code', 'Unit', 'Row in your file', 'Reason']);
    expect(ws.rowCount).toBe(3);
    expect((ws.getRow(2).values as unknown[]).slice(1)).toEqual(['B', 'bad', 3, 'Unknown unit']);
    expect(ws.getRow(3).getCell(1).value).toBe("'=HYPERLINK(\"x\")");
    expect(ws.getRow(3).getCell(3).value).toBe(4);
    const there = wb.worksheets[1];
    expect(there.name).toBe('Already there');
    expect(there.getRow(2).getCell(1).value).toBe('D');
  });
  it('AC-IMT-004: re-uploading the failed file ignores the added columns', async () => {
    const buf = await buildFailedRowsWorkbook({
      headers, rows, failed: [{ index: 1, reason: 'x' }],
      skipped: [], labels: { rowInFile: 'Row in your file', reason: 'Reason', alreadyThere: 'Already there', sheet: 'Failed rows' },
    });
    const sheet = await parseWorkbook(buf);
    const map = autoMap(sheet.headers, fake.fields);
    expect(map).toEqual({ code: 0, unit: 1, note: null });
    expect(sheet.rows).toHaveLength(1);
  });
});
