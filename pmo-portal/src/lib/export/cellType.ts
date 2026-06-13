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

export function cellType(v: string | number | boolean): CellType {
  if (typeof v === 'number' && Number.isFinite(v)) return 'number';
  if (typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v))) return 'date';
  return 'text';
}
