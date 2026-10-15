import { ImportParseError } from './types';
import { readCsvGrid } from './readCsvGrid';
import { readWorkbookGrid, type WorkbookCell, type WorkbookGrid } from './readWorkbookGrid';

export type FxRejected = { row: number; value?: string; reason: string };
export type FxRateInput = { rate_date: string; rate: number };
export type FxParsed = { rows: FxRateInput[]; rejected: FxRejected[]; duplicates: number };

const MIN_RATE = 1_000;
const MAX_RATE = 100_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DATA_ROWS = 500;

function inBand(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_RATE && value <= MAX_RATE;
}

function decimalScale(value: number): number {
  const text = String(value);
  if (/[eE]/.test(text)) return 0;
  return (text.split('.')[1] ?? '').replace(/0+$/, '').length;
}

/** Locale-independent parser for the explicitly supported JISDOR number grammars. */
export function parseFxRate(value: string | number): number | null {
  if (typeof value === 'number') return inBand(value) && decimalScale(value) <= 6 ? value : null;
  const text = value.trim();
  if (!text) return null;
  const candidates = new Set<number>();
  const add = (normalized: string) => {
    const candidate = Number(normalized);
    if (inBand(candidate) && decimalScale(candidate) <= 6) candidates.add(candidate);
  };

  if (/^\d+$/.test(text)) add(text);
  if (/^\d+[.,]\d{1,6}$/.test(text)) add(text.replace(',', '.'));

  const groupedInteger = text.match(/^(\d{1,3})([.,])(\d{3}(?:\2\d{3})*)$/);
  if (groupedInteger) add(groupedInteger[1] + groupedInteger[3].replace(/[.,]/g, ''));

  const groupedDecimal = text.match(/^(\d{1,3}(?:([.,])\d{3})+)([.,])(\d{1,6})$/);
  if (groupedDecimal && groupedDecimal[2] !== groupedDecimal[3]) {
    const integerDigits = groupedDecimal[1].replace(/[.,]/g, '');
    add(`${integerDigits}.${groupedDecimal[4]}`);
  }

  return candidates.size === 1 ? [...candidates][0] : null;
}

const MONTHS: Record<string, number> = {
  januari: 1,
  january: 1,
  jan: 1,
  februari: 2,
  february: 2,
  feb: 2,
  maret: 3,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  mei: 5,
  may: 5,
  juni: 6,
  june: 6,
  jun: 6,
  juli: 7,
  july: 7,
  jul: 7,
  agustus: 8,
  august: 8,
  agu: 8,
  ags: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  oktober: 10,
  october: 10,
  okt: 10,
  oct: 10,
  november: 11,
  nov: 11,
  desember: 12,
  december: 12,
  des: 12,
  dec: 12,
};

function utcDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return date.toISOString().slice(0, 10);
}

function rawCalendarDate(value: string | number | Date, date1904: boolean): string | null {
  if (value instanceof Date) {
    if (
      !Number.isFinite(value.getTime()) ||
      value.getUTCHours() !== 0 ||
      value.getUTCMinutes() !== 0 ||
      value.getUTCSeconds() !== 0 ||
      value.getUTCMilliseconds() !== 0
    )
      return null;
    return utcDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0 || (!date1904 && value === 60)) return null;
    const days = date1904 ? value : value > 60 ? value - 1 : value;
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    const result = new Date(epoch + days * 86_400_000);
    return Number.isFinite(result.getTime()) ? result.toISOString().slice(0, 10) : null;
  }

  const text = value.trim().replace(/\s+/g, ' ');
  // BI exports Tanggal as US-ordered text with an explicit midnight suffix. Keep this
  // format distinct from the supported day-first date grammar below.
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) 12:00:00 AM$/i);
  if (match) return utcDate(Number(match[3]), Number(match[1]), Number(match[2]));
  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return utcDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (match) return utcDate(Number(match[3]), Number(match[2]), Number(match[1]));
  match = text.toLocaleLowerCase('en-US').match(/^(\d{1,2}) ([a-z]+) (\d{4})$/);
  if (match) {
    const month = MONTHS[match[2]];
    return month ? utcDate(Number(match[3]), month, Number(match[1])) : null;
  }
  return null;
}

/** Parse an Excel/date-only calendar value without interpreting it in the viewer's timezone. */
export function parseFxDate(
  value: string | number | Date,
  date1904: boolean,
  today: string,
): string | null {
  const result = rawCalendarDate(value, date1904);
  return result && result <= today ? result : null;
}

const DATE_HEADERS = new Set(['date', 'tanggal']);
const RATE_HEADERS = new Set(['rate', 'kurs', 'jisdor', 'kurs jisdor']);
const normalizedHeader = (cell: WorkbookCell): string =>
  cell.text.trim().toLowerCase().replace(/\s+/g, ' ');

function isBlank(row: WorkbookCell[]): boolean {
  return row.every((cell) => !cell.text.trim() && cell.value == null && !cell.formula);
}

function rowDateReason(
  value: string | number | Date,
  date1904: boolean,
  today: string,
): { date: string | null; reason: string } {
  const raw = rawCalendarDate(value, date1904);
  if (!raw) return { date: null, reason: 'invalidDate' };
  return raw > today ? { date: null, reason: 'futureDate' } : { date: raw, reason: 'invalidDate' };
}

/** Detect and validate one BI workbook header and normalize all valid physical rows. */
export function parseFxRows(grid: WorkbookGrid, today: string): FxParsed {
  const candidates: { row: number; dates: number[]; rates: number[] }[] = [];
  grid.rows.slice(0, 20).forEach((row, index) => {
    const dates: number[] = [];
    const rates: number[] = [];
    row.forEach((cell, column) => {
      const header = normalizedHeader(cell);
      if (DATE_HEADERS.has(header)) dates.push(column);
      if (RATE_HEADERS.has(header)) rates.push(column);
    });
    if (dates.length > 0 && rates.length > 0) candidates.push({ row: index + 1, dates, rates });
  });

  if (
    candidates.length !== 1 ||
    candidates[0].dates.length !== 1 ||
    candidates[0].rates.length !== 1
  ) {
    return {
      rows: [],
      rejected: [{ row: candidates[0]?.row ?? 1, reason: 'ambiguousHeader' }],
      duplicates: 0,
    };
  }
  const header = candidates[0];
  const dateColumn = header.dates[0];
  const rateColumn = header.rates[0];
  if (dateColumn === rateColumn)
    return { rows: [], rejected: [{ row: header.row, reason: 'ambiguousHeader' }], duplicates: 0 };

  const rejected: FxRejected[] = [];
  const displayValue = (cell: WorkbookCell | undefined): string =>
    cell?.text ?? (cell?.value == null ? '' : String(cell.value));
  const byDate = new Map<
    string,
    { rate: number; sourceRows: Array<{ row: number; value: string }>; conflict: boolean }
  >();
  let duplicates = 0;
  let nonblankRows = 0;
  for (let index = header.row; index < grid.rows.length; index += 1) {
    const row = grid.rows[index];
    if (isBlank(row)) continue;
    nonblankRows += 1;
    const physicalRow = index + 1;
    if (nonblankRows > MAX_DATA_ROWS)
      throw new ImportParseError(
        'too_many_rows',
        `Import at most ${MAX_DATA_ROWS} data rows at a time.`,
      );
    const dateCell = row[dateColumn];
    const rateCell = row[rateColumn];
    if (row.some((cell) => cell.formula)) {
      rejected.push({ row: physicalRow, value: displayValue(rateCell ?? dateCell), reason: 'formula' });
      continue;
    }
    if (!dateCell || !rateCell || dateCell.value == null || rateCell.value == null) {
      rejected.push({ row: physicalRow, value: displayValue(dateCell ?? rateCell), reason: 'invalidDate' });
      continue;
    }
    const { date, reason } = rowDateReason(dateCell.value, grid.date1904, today);
    if (!date) {
      rejected.push({ row: physicalRow, value: displayValue(dateCell), reason });
      continue;
    }
    const rate =
      typeof rateCell.value === 'string' || typeof rateCell.value === 'number'
        ? parseFxRate(rateCell.value)
        : null;
    if (rate === null) {
      rejected.push({ row: physicalRow, value: displayValue(rateCell), reason: 'invalidRate' });
      continue;
    }
    const existing = byDate.get(date);
    const sourceRow = { row: physicalRow, value: displayValue(rateCell) };
    if (!existing) byDate.set(date, { rate, sourceRows: [sourceRow], conflict: false });
    else {
      existing.sourceRows.push(sourceRow);
      if (existing.rate === rate) duplicates += 1;
      else existing.conflict = true;
    }
  }

  const rows: FxRateInput[] = [];
  for (const [rate_date, candidate] of byDate) {
    if (candidate.conflict)
      candidate.sourceRows.forEach(({ row, value }) =>
        rejected.push({ row, value, reason: 'duplicateDate' }),
      );
    else rows.push({ rate_date, rate: candidate.rate });
  }
  rejected.sort((a, b) => a.row - b.row);
  return {
    rows: rows.sort((a, b) => a.rate_date.localeCompare(b.rate_date)),
    rejected,
    duplicates,
  };
}

function assertCsvHeader(grid: WorkbookGrid): void {
  const header = grid.rows[0]?.map((cell) => cell.text.trim().toLowerCase());
  if (!header || header.length !== 2 || header[0] !== 'date' || header[1] !== 'rate') {
    throw new ImportParseError('invalidCsv', 'CSV headers must be exactly date,rate.');
  }
}

/** File dispatch for bounded `.xlsx` and strict `date,rate` CSV imports. */
export async function parseFxFile(file: File, today: string): Promise<FxParsed> {
  if (file.size > MAX_FILE_BYTES) throw new ImportParseError('fileTooLarge', 'File exceeds 5 MiB.');
  if (file.size === 0) throw new ImportParseError('emptyFile', 'The file contains no rate rows.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  let grid: WorkbookGrid;
  if (extension === 'csv') {
    grid = readCsvGrid(await file.text());
    assertCsvHeader(grid);
  } else if (extension === 'xlsx') {
    grid = await readWorkbookGrid(await file.arrayBuffer(), { maxRows: 520, maxColumns: 50 });
  } else {
    throw new ImportParseError(
      'unsupportedFile',
      'Choose a supported BI workbook or date,rate CSV.',
    );
  }
  const parsed = parseFxRows(grid, today);
  if (parsed.rows.length === 0 && parsed.rejected.length === 0) {
    throw new ImportParseError('emptyFile', 'The file contains no rate rows.');
  }
  return parsed;
}
