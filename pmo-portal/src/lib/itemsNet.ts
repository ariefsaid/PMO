/**
 * #876 slice 2 — the items total before tax, in ONE place for both consumers of the formula: the FE
 * pre-fill (`vendorWithholding.ts` re-exports `itemsNetTotal`; the case rows spell the quantity
 * `quantity`) and the ERP dispatch's entered-tax bound (`dispatchFactory.ts`; the command items and
 * the resolved case items spell it `qty`). Its dependency-free pricing leaf is also pulled into the Deno
 * edge-function bundle, which must not transit `format.ts`'s npm/locale dependencies.
 *
 * A line that is unpriced (no numeric rate) or unquantified (no numeric quantity) leaves the total
 * UNKNOWN — `null`, never a 0 line: a guessed 0 would understate the base the withholding bound
 * checks against, and a guessed total could wave through a withholding every replay then refuses.
 */

import { lineCents } from './linePricing.ts';

/** One items line, in either spelling the two consumers use. Figures may be numeric strings. */
export interface ItemsNetLine {
  quantity?: unknown;
  qty?: unknown;
  rate?: unknown;
}

/** A line's price, or null when the line is unpriced (no rate, or one that is not a finite number). */
export function lineRate(line: ItemsNetLine): number | null {
  if (line.rate == null) return null;
  const rate = Number(line.rate);
  return Number.isFinite(rate) ? rate : null;
}

/** A line's quantity in either spelling, or NaN when it is missing or not a number. */
function lineQty(line: ItemsNetLine): number {
  if (line.quantity != null) return Number(line.quantity);
  if (line.qty != null) return Number(line.qty);
  return Number.NaN;
}

/** Σ quantity × rate per line, in exact cents. Null when there are no lines, or when any line's
 *  quantity or rate is missing or not a finite number (the dispatch refuses those cases; the FE
 *  pre-fill simply has no base to suggest on). */
export function itemsNetTotal(items: ReadonlyArray<ItemsNetLine>): number | null {
  if (items.length === 0) return null;
  let total = 0n;
  for (const line of items) {
    const cents = lineCents(lineQty(line), lineRate(line) ?? Number.NaN);
    if (cents === null) return null;
    total += cents;
  }
  const result = Number(total) / 100;
  return Number.isFinite(result) ? result : null;
}
