import type { ImportField, Mapping } from './types';

/** Normalize a header/label for matching: lowercase, collapse all whitespace, trim. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Pure, synchronous auto-mapping: for each descriptor field, find the first sheet header
 * whose normalized text equals either the field's normalized label OR the field's key
 * (both case/whitespace-insensitive). Label is checked first; key is the fallback.
 *
 * This covers the real-world case where a spreadsheet exports the raw field key
 * (e.g. "name") instead of the display label (e.g. "Company name") — the column
 * that was left "— Not mapped —" in the round-2 design-review (Fix 4).
 *
 * Unmatched fields map to `null`. The user can override any mapping in the wizard.
 */
export function autoMap<Input>(headers: string[], fields: ImportField<Input>[]): Mapping {
  const normalized = headers.map(norm);
  const mapping: Mapping = {};
  for (const field of fields) {
    // Try label first (e.g. "Company name"), then key (e.g. "name")
    let idx = normalized.indexOf(norm(field.label));
    if (idx === -1) {
      idx = normalized.indexOf(norm(field.key));
    }
    mapping[field.key] = idx === -1 ? null : idx;
  }
  return mapping;
}
