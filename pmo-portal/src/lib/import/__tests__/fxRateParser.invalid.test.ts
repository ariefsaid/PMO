import { describe, expect, it, vi } from 'vitest';
import { parseFxFile } from '../fxRateParser';
import { readCsvGrid } from '../readCsvGrid';

const textFile = (name: string, content: string): File =>
  new File([content], name, { type: 'text/plain' });

describe('JISDOR import rejection and CSV contract', () => {
  it('parses BOM, CRLF and a quoted grouped rate', () => {
    const parsed = readCsvGrid('\uFEFFdate,rate\r\n2026-10-09,"16,234.56"\r\n');
    expect(parsed.rows[1].map((cell) => cell.text)).toEqual(['2026-10-09', '16,234.56']);
  });

  it('supports escaped quotes and rejects malformed quote/column structures', () => {
    expect(
      readCsvGrid('date,rate\n2026-10-09,"16,234.56"\n2026-10-10,"value ""note"""').rows[2][1].text,
    ).toBe('value "note"');
    expect(() => readCsvGrid('date,rate\n2026-10-09,"16,234.56')).toThrow();
    expect(() => readCsvGrid('date,rate\n2026-10-09,16234,extra')).toThrow();
  });

  it('rejects empty, over-limit and unsupported input before reading it', async () => {
    const over = textFile('rates.csv', 'date,rate');
    Object.defineProperty(over, 'size', { value: 5 * 1024 * 1024 + 1 });
    const read = vi.spyOn(over, 'text');
    await expect(parseFxFile(over, '2026-10-14')).rejects.toMatchObject({ code: 'fileTooLarge' });
    expect(read).not.toHaveBeenCalled();
    await expect(parseFxFile(textFile('rates.csv', ''), '2026-10-14')).rejects.toMatchObject({
      code: 'emptyFile',
    });
    await expect(parseFxFile(textFile('rates.xls', 'binary'), '2026-10-14')).rejects.toMatchObject({
      code: 'unsupportedFile',
    });
  });

  it('dispatches CSV extension case-insensitively and requires exact date,rate columns', async () => {
    const parsed = await parseFxFile(
      textFile('Rates.CSV', 'date,rate\n2026-10-09,16234.56'),
      '2026-10-14',
    );
    expect(parsed.rows).toEqual([{ rate_date: '2026-10-09', rate: 16234.56 }]);
    await expect(
      parseFxFile(textFile('rates.csv', 'Tanggal,Kurs JISDOR\n2026-10-09,16234'), '2026-10-14'),
    ).rejects.toMatchObject({ code: 'invalidCsv' });
  });

  it('rejects unsupported binary content even when named xlsx', async () => {
    const file = new File([new Uint8Array([0, 1, 2, 3])], 'rates.xlsx');
    await expect(parseFxFile(file, '2026-10-14')).rejects.toMatchObject({ code: 'not_xlsx' });
  });
});
