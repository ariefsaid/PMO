/**
 * Real ExcelJS round-trip proofs for exported typed cells. These tests exercise the generated OOXML
 * and read it back through ExcelJS; they do not assert which in-memory value the writer uses.
 */
import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { toWorkbookBuffer } from '../toWorkbookBuffer';

const originalTimezone = process.env.TZ;

function setTimezone(timezone: string) {
  process.env.TZ = timezone;
}

afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
  resetActiveLocale();
});

async function readExport(body: (string | number)[][]) {
  const buffer = await toWorkbookBuffer({
    sheetName: 'Test',
    header: ['Name', 'Amount', 'Date'],
    body,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(buffer));
  return workbook.getWorksheet('Test')!;
}

describe('AC-W2-3-03: xlsx date cells preserve the local calendar day', () => {
  it('round-trips a date-only value as the same day for an Asia/Jakarta exporter', async () => {
    setTimezone('Asia/Jakarta');

    const sheet = await readExport([['Invoice', 1, '2025-11-30']]);
    const date = sheet.getCell('C2').value;

    expect(date).toBeInstanceOf(Date);
    expect((date as Date).toISOString()).toBe('2025-11-30T00:00:00.000Z');
  });

  it('leaves ordinary text cells as text', async () => {
    setTimezone('UTC');

    const sheet = await readExport([['Project Alpha', 1234.5, 'not-a-date']]);

    expect(sheet.getCell('A2').value).toBe('Project Alpha');
    expect(sheet.getCell('C2').value).toBe('not-a-date');
  });
});

describe('AC-PLC-008: exported cells stay typed and locale-neutral', () => {
  it('round-trips numeric amounts and the same typed date for Indonesian and English viewers', async () => {
    const snapshots: Array<{ amount: unknown; date: unknown }> = [];

    for (const viewer of [
      { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' },
      { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' },
    ]) {
      setActiveLocale(viewer);
      setTimezone(viewer.timezone);
      const sheet = await readExport([['Project Alpha', 1234.5, '2026-06-14']]);
      snapshots.push({ amount: sheet.getCell('B2').value, date: sheet.getCell('C2').value });
    }

    for (const snapshot of snapshots) {
      expect(typeof snapshot.amount).toBe('number');
      expect(snapshot.amount).toBe(1234.5);
      expect(snapshot.date).toBeInstanceOf(Date);
      expect((snapshot.date as Date).toISOString()).toBe('2026-06-14T00:00:00.000Z');
    }
    expect(snapshots[0].amount).toBe(snapshots[1].amount);
    expect((snapshots[0].date as Date).getTime()).toBe((snapshots[1].date as Date).getTime());
  });
});
