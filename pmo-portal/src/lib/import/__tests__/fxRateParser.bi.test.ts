import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseFxRows } from '../fxRateParser';
import { readWorkbookGrid } from '../readWorkbookGrid';

/**
 * Public BI JISDOR export, downloaded 2026-10-14 from bi.go.id (JISDOR page → Unduh,
 * range 01/01/2025–14/10/2026). Unmodified source SHA-256:
 * fac25379300840ae90e1287f964105166f86d15314676fe57775bb5884ddf5f9.
 * Dates/rates independently checked against BI's web table and the source workbook.
 */
describe('AC-FX-014: original Bank Indonesia JISDOR workbook', () => {
  it('decodes the real title/header layout, all 422 rows, and independent date/rate oracles', async () => {
    const bytes = await readFile(
      new URL('./fixtures/bi-jisdor-original.xlsx', import.meta.url),
    );
    const grid = await readWorkbookGrid(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      { maxRows: 520, maxColumns: 50 },
    );

    expect(grid.rows[2]?.[0]?.text).toBe('Informasi Kurs Jisdor');
    expect(grid.rows[4]?.slice(0, 3).map((cell) => cell.text)).toEqual(['NO', 'Tanggal', 'Kurs']);

    const parsed = parseFxRows(grid, '2026-10-14');
    expect(parsed.rejected).toEqual([]);
    expect(parsed.rows).toHaveLength(422);
    const byDate = new Map(parsed.rows.map((row) => [row.rate_date, row.rate]));
    expect([
      byDate.get('2026-10-13'),
      byDate.get('2026-10-12'),
      byDate.get('2026-10-09'),
      byDate.get('2026-09-30'),
      byDate.get('2025-01-06'),
      byDate.get('2025-01-03'),
      byDate.get('2025-01-02'),
    ]).toEqual([17930, 17899, 17884, 17877, 16193, 16217, 16236]);
  });
});
