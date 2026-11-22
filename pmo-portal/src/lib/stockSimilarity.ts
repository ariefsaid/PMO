/**
 * Near-duplicate detection for a new stock item's name (#2692). Pure and advisory: the form warns,
 * the write is never blocked. The three differences the ticket names — case, spacing and a small
 * typo — are folded away here so a person who types `cement 50kg` sees the existing `Cement 50 kg`.
 */

/** The most matches a warning lists. Beyond three the list stops helping and starts nagging. */
export const MAX_NEAR_DUPLICATES = 3;
/** Below three normalised characters every name looks like every other one; do not compare. */
export const MIN_CHECK_LENGTH = 3;

export interface StockNameItem {
  id: string;
  code: string;
  name: string;
  archived_at?: string | null;
}

export interface IndexedStockItem {
  id: string;
  code: string;
  name: string;
  /** `normalizeStockName(name)`, computed once per item list, not once per keystroke. */
  key: string;
}

/**
 * Lowercase, strip diacritics and drop everything that is not a Latin letter or a digit, so case,
 * spacing, punctuation and accents cannot hide a duplicate: `Cémént-50 kg` and `CEMENT 50KG` both
 * become `cement50kg`. A name in another script normalises to '' and is never compared.
 */
export function normalizeStockName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * How many typos a name of this normalised length may carry. Short names get none: `Cat` and `Car`
 * are different products far more often than one is a typo of the other.
 */
export function typoAllowance(normalizedLength: number): number {
  if (normalizedLength >= 10) return 2;
  if (normalizedLength >= 5) return 1;
  return 0;
}

/**
 * Optimal string alignment distance (Levenshtein plus adjacent transposition, so `cemnet` is one
 * typo away from `cement`), stopping as soon as no alignment can stay within `allowed`.
 * Returns null when the distance exceeds the allowance.
 */
export function boundedDistance(a: string, b: string, allowed: number): number | null {
  if (a === b) return 0;
  if (allowed < 1) return null;
  if (Math.abs(a.length - b.length) > allowed) return null;

  let beforePrevious: number[] = [];
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    let rowMinimum = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + substitution);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, beforePrevious[j - 2] + 1);
      current.push(value);
      if (value < rowMinimum) rowMinimum = value;
    }
    // Every alignment of the whole names covers this prefix, so no later row can dip below this.
    if (rowMinimum > allowed) return null;
    beforePrevious = previous;
    previous = current;
  }
  return previous[b.length] <= allowed ? previous[b.length] : null;
}

/**
 * Normalise the item list once. Archived items are dropped: they are out of the working item master
 * and hidden from the Setup list by default, so warning about one would name a row the person cannot see.
 */
export function indexStockItems(items: readonly StockNameItem[]): IndexedStockItem[] {
  const index: IndexedStockItem[] = [];
  for (const item of items) {
    if (item.archived_at) continue;
    index.push({ id: item.id, code: item.code, name: item.name, key: normalizeStockName(item.name) });
  }
  return index;
}

/** Closest matches first (equal name, then smaller typo distance, then code), capped at `limit`. */
export function findNearDuplicateItems(
  rawName: string,
  index: readonly IndexedStockItem[],
  limit = MAX_NEAR_DUPLICATES,
): IndexedStockItem[] {
  const key = normalizeStockName(rawName);
  if (key.length < MIN_CHECK_LENGTH || limit < 1) return [];
  const allowed = typoAllowance(key.length);

  const matches: Array<{ item: IndexedStockItem; distance: number }> = [];
  for (const item of index) {
    if (item.key === key) {
      matches.push({ item, distance: 0 });
      continue;
    }
    const distance = boundedDistance(item.key, key, allowed);
    if (distance !== null) matches.push({ item, distance });
  }
  matches.sort((x, y) => x.distance - y.distance || x.item.code.localeCompare(y.item.code) || x.item.id.localeCompare(y.item.id));
  return matches.slice(0, limit).map((match) => match.item);
}
