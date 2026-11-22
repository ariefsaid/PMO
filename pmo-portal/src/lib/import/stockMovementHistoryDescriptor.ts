import type { TFunction } from 'i18next';
import type { ImportDescriptor } from './types';
import { labelOf, makeField, requiredText } from './importShared';

/** One row of the opening-stock movement template, every cell as the file holds it (docs/specs/opening-stock-history.spec.md). */
export interface StockMovementRow {
  date: string;
  location: string;
  item: string;
  direction: 'in' | 'out';
  quantity: string;
  unitCost: string;
  reference: string;
}

/** The file cap: a technical limit of one posting transaction, stated in the spec (FR-OSH-010). */
export const STOCK_MOVEMENT_MAX_ROWS = 5000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const IN_WORDS = ['in', 'masuk'];
const OUT_WORDS = ['out', 'keluar'];

const isRealDay = (raw: string): boolean => {
  if (!ISO_DAY.test(raw)) return false;
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
/** `in` / `out` (or the Bahasa words masuk / keluar), any case; null when it is neither. */
export const directionOf = (raw: string): 'in' | 'out' | null => {
  const v = raw.trim().toLowerCase();
  return IN_WORDS.includes(v) ? 'in' : OUT_WORDS.includes(v) ? 'out' : null;
};
const decimalWithin = (raw: string, places: number): boolean => new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(raw.trim());

/**
 * The one movement template: date, location, item, direction, quantity, unit cost, reference. It validates the SHAPE of each cell
 * before any call; the database preview decides everything that needs the ledger (balances, locations, items, cost rules).
 * The load is one atomic confirm, so this descriptor carries no per-row `create`.
 */
export function makeStockMovementHistoryDescriptor(t?: TFunction): Pick<ImportDescriptor<StockMovementRow>, 'entity' | 'fields' | 'template' | 'maxRows'> {
  const L = labelOf(t);
  const F = (key: keyof StockMovementRow & string, en: string, id: string, required: boolean, validate: (r: string) => string | null, extra = {}) =>
    makeField<StockMovementRow>(key, L(`import:stockMovement.${key}`, en), required, validate, { aliases: [en, id], ...extra });
  return {
    entity: 'Opening stock movements',
    maxRows: STOCK_MOVEMENT_MAX_ROWS,
    template: {
      version: 1,
      example: { date: '2026-01-15', location: 'WH-01', item: 'CEM-50', direction: 'in', quantity: '100', unitCost: '5.25', reference: 'DN-0001' },
      lists: { direction: ['in', 'out'] },
    },
    fields: [
      F('date', 'Date', 'Tanggal', true, (r) => (isRealDay(r.trim()) ? null : L('import:stockMovement.error.date', 'Use a day written as YYYY-MM-DD, for example 2026-01-15.')),
        { hint: L('import:stockMovement.dateHint', 'The day the stock moved. Not after the go-live date.') }),
      F('location', 'Location', 'Lokasi', true, requiredText(L('import:stockMovement.error.location', 'Write the code of the stock location.'), 40, L('import:stockMovement.error.codeLong', 'This code is too long.')),
        { hint: L('import:stockMovement.locationHint', 'The code of an existing stock location.') }),
      F('item', 'Item', 'Barang', true, requiredText(L('import:stockMovement.error.item', 'Write the code of the stock item.'), 40, L('import:stockMovement.error.codeLong', 'This code is too long.')),
        { hint: L('import:stockMovement.itemHint', 'The code of an existing stock item.') }),
      F('direction', 'Direction', 'Arah', true, (r) => (directionOf(r) ? null : L('import:stockMovement.error.direction', 'Write in (stock arrived) or out (stock left).')),
        { hint: L('import:stockMovement.directionHint', 'in: received, returned or found. out: issued, used or returned to the supplier.') }),
      F('quantity', 'Quantity', 'Jumlah', true, (r) => (decimalWithin(r, 3) && Number(r) > 0 ? null : L('import:stockMovement.error.quantity', 'Quantity must be above 0, with at most 3 decimals.')),
        { numeric: true, hint: L('import:stockMovement.quantityHint', 'Whole numbers only for items counted in whole units.') }),
      F('unitCost', 'Unit cost', 'Biaya satuan', false, (r) => (r.trim() === '' || decimalWithin(r, 4) ? null : L('import:stockMovement.error.unitCost', 'Unit cost must be 0 or more, with at most 4 decimals.')),
        { numeric: true, hint: L('import:stockMovement.unitCostHint', 'On an in row. Leave blank for client-supplied items (they are always at zero cost). Not used on out rows.') }),
      F('reference', 'Reference', 'Referensi', false, (r) => (r.trim().length <= 100 ? null : L('import:stockMovement.error.reference', 'The reference is too long (100 characters at most).')),
        { hint: L('import:stockMovement.referenceHint', 'A delivery note, site report or other paper number.') }),
    ],
  };
}

/** Mapped cells to the row the database takes. Call only for a row whose cells passed the field checks. */
export function movementRowFromCells(c: Record<string, string>): StockMovementRow {
  return {
    date: (c.date ?? '').trim(), location: (c.location ?? '').trim(), item: (c.item ?? '').trim(), direction: directionOf(c.direction ?? '') ?? 'in',
    quantity: (c.quantity ?? '').trim(), unitCost: (c.unitCost ?? '').trim(), reference: (c.reference ?? '').trim(),
  };
}
