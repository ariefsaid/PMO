/**
 * Classify an export cell value so the xlsx writer can set a typed Excel cell:
 *   - `number`  → numeric cell (right-aligned, tabular)
 *   - `date`    → ISO `YYYY-MM-DD` string → real Excel date cell
 *   - `text`    → everything else (labels, booleans, malformed dates)
 *
 * Pure + synchronous; no exceljs import. Consumed by `toWorkbookBuffer`.
 */

export type CellType = 'number' | 'date' | 'text';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates that an ISO string is an actual calendar date (e.g. 2026-02-28 is valid, 2026-02-30 is not).
 */
export function isValidCalendarDate(iso: string): boolean {
  if (!ISO_DATE.test(iso)) return false;
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function cellType(v: string | number | boolean, declaredType?: CellType): CellType {
  if (typeof v === 'number' && Number.isFinite(v)) return 'number';
  if (declaredType === 'text') return 'text';
  if (declaredType === 'number') return typeof v === 'number' && Number.isFinite(v) ? 'number' : 'text';
  if (typeof v === 'string' && (declaredType === 'date' || declaredType === undefined) && isValidCalendarDate(v)) {
    return 'date';
  }
  return 'text';
}
