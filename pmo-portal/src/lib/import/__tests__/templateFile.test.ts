import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { buildTemplateWorkbook } from '../templateFile';
import { buildFailedRowsWorkbook } from '../failedRowsFile';
import { checkTemplateMarker, templateMarker } from '../templateVersion';
import { parseWorkbook } from '../parseWorkbook';
import { autoMap } from '../autoMap';
import { validateRows } from '../validateRows';
import { makePeopleImportDescriptor } from '../employeeDescriptor';
import { makeStockItemImportDescriptor, makeStockLocationImportDescriptor } from '../stockItemDescriptor';
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

describe('localized template human sample rows (#fix1122 defect 6)', () => {
  const readCatalog = (lng: 'en' | 'id') => {
    const p1 = join(process.cwd(), 'public/locales', lng, 'import.json');
    const path = existsSync(p1) ? p1 : join(process.cwd(), 'pmo-portal/public/locales', lng, 'import.json');
    return JSON.parse(readFileSync(path, 'utf8'));
  };

  const makeT = (lng: 'en' | 'id') => {
    const cat = readCatalog(lng);
    return ((key: string, fallback: string, params?: Record<string, unknown>) => {
      const cleanKey = key.replace(/^import:/, '');
      const val = cleanKey.split('.').reduce<unknown>((obj, part) => (obj as Record<string, unknown> | undefined)?.[part], cat);
      if (val === undefined || val === null) return fallback;
      return String(val).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params?.[name] ?? ''));
    }) as never;
  };

  it('localizes People sample person in en and id, preserving codes and roundtrip', async () => {
    const tEn = makeT('en');
    const tId = makeT('id');
    const dEn = makePeopleImportDescriptor(async () => [], tEn);
    const dId = makePeopleImportDescriptor(async () => [], tId);

    const sheetEn = await parseWorkbook(await buildTemplateWorkbook(dEn));
    expect(sheetEn.headers).toEqual(['Employee code', 'Display name']);
    expect(sheetEn.rows).toEqual([['E-0001', 'Sample Person']]);
    const mapEn = autoMap(sheetEn.headers, dEn.fields);
    expect(mapEn).toEqual({ code: 0, name: 1 });
    const valEn = validateRows(sheetEn.rows, dEn.fields, mapEn);
    expect(valEn[0].valid).toBe(true);
    expect(dEn.toInput({ code: sheetEn.rows[0][0], name: sheetEn.rows[0][1] })).toEqual({ code: 'E-0001', name: 'Sample Person' });

    const sheetId = await parseWorkbook(await buildTemplateWorkbook(dId));
    expect(sheetId.headers).toEqual(['Kode karyawan', 'Nama tampilan']);
    expect(sheetId.rows).toEqual([['E-0001', 'Contoh Karyawan']]);
    const mapId = autoMap(sheetId.headers, dId.fields);
    expect(mapId).toEqual({ code: 0, name: 1 });
    const valId = validateRows(sheetId.rows, dId.fields, mapId);
    expect(valId[0].valid).toBe(true);
    expect(dId.toInput({ code: sheetId.rows[0][0], name: sheetId.rows[0][1] })).toEqual({ code: 'E-0001', name: 'Contoh Karyawan' });

    // Cross-language reimport parse contract: Indonesian workbook auto-maps to English descriptor
    const crossMap = autoMap(sheetId.headers, dEn.fields);
    expect(crossMap).toEqual({ code: 0, name: 1 });
    expect(validateRows(sheetId.rows, dEn.fields, crossMap)[0].valid).toBe(true);
  });

  it('localizes Stock items sample name in en and id, preserving machine codes and units', async () => {
    const tEn = makeT('en');
    const tId = makeT('id');
    const units = [{ id: 'u1', code: 'EA' }];
    const dEn = makeStockItemImportDescriptor(units, async () => [], tEn);
    const dId = makeStockItemImportDescriptor(units, async () => [], tId);

    const sheetEn = await parseWorkbook(await buildTemplateWorkbook(dEn));
    expect(sheetEn.headers).toEqual(['Item code', 'Name', 'Description', 'Unit', 'Lead time (days)']);
    expect(sheetEn.rows).toEqual([['CEM-50', 'Cement 50 kg bag', '', 'EA', '7']]);
    const mapEn = autoMap(sheetEn.headers, dEn.fields);
    expect(validateRows(sheetEn.rows, dEn.fields, mapEn, dEn.validateRow)[0].valid).toBe(true);

    const sheetId = await parseWorkbook(await buildTemplateWorkbook(dId));
    expect(sheetId.headers).toEqual(['Kode item', 'Nama', 'Deskripsi', 'Satuan', 'Waktu tunggu (hari)']);
    expect(sheetId.rows).toEqual([['CEM-50', 'Semen sak 50 kg', '', 'EA', '7']]);
    const mapId = autoMap(sheetId.headers, dId.fields);
    expect(validateRows(sheetId.rows, dId.fields, mapId, dId.validateRow)[0].valid).toBe(true);
    expect(dId.toInput({ code: 'CEM-50', name: sheetId.rows[0][1], unit: 'EA', leadTimeDays: '7' })).toEqual({
      code: 'CEM-50', name: 'Semen sak 50 kg', description: null, unitId: 'u1', leadTimeDays: 7,
    });
  });

  it('localizes Stock locations sample name in en and id, preserving kind enum and project', async () => {
    const tEn = makeT('en');
    const tId = makeT('id');
    const projects = [{ id: 'p1', name: 'Alpha Site' }];
    const dEn = makeStockLocationImportDescriptor(projects, async () => [], tEn);
    const dId = makeStockLocationImportDescriptor(projects, async () => [], tId);

    const sheetEn = await parseWorkbook(await buildTemplateWorkbook(dEn));
    expect(sheetEn.headers).toEqual(['Location code', 'Name', 'Kind', 'Project']);
    expect(sheetEn.rows).toEqual([['YARD-1', 'North yard', 'yard', 'Alpha Site']]);
    const mapEn = autoMap(sheetEn.headers, dEn.fields);
    expect(validateRows(sheetEn.rows, dEn.fields, mapEn, dEn.validateRow)[0].valid).toBe(true);

    const sheetId = await parseWorkbook(await buildTemplateWorkbook(dId));
    expect(sheetId.headers).toEqual(['Kode lokasi', 'Nama', 'Jenis', 'Proyek']);
    expect(sheetId.rows).toEqual([['YARD-1', 'Yard utara', 'yard', 'Alpha Site']]);
    const mapId = autoMap(sheetId.headers, dId.fields);
    expect(validateRows(sheetId.rows, dId.fields, mapId, dId.validateRow)[0].valid).toBe(true);
    expect(dId.toInput({ code: 'YARD-1', name: sheetId.rows[0][1], kind: 'yard', project: 'Alpha Site' })).toEqual({
      code: 'YARD-1', name: 'Yard utara', kind: 'yard', projectId: 'p1', coverValue: null,
    });
  });

  it('preserves fallback English when t is undefined', () => {
    const dPeople = makePeopleImportDescriptor(async () => []);
    expect(dPeople.template?.example).toEqual({ code: 'E-0001', name: 'Sample Person' });

    const dStock = makeStockItemImportDescriptor([{ id: 'u1', code: 'EA' }], async () => []);
    expect(dStock.template?.example).toEqual({
      code: 'CEM-50', name: 'Cement 50 kg bag', description: '', unit: 'EA', leadTimeDays: '7',
    });

    const dLocation = makeStockLocationImportDescriptor([{ id: 'p1', name: 'Alpha' }], async () => []);
    expect(dLocation.template?.example).toEqual({
      code: 'YARD-1', name: 'North yard', kind: 'yard', project: 'Alpha',
    });
  });
});
