import type { ImportField, Mapping } from './types';

/** Normalize a header/label for matching: lowercase, collapse all whitespace, trim. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Pure, synchronous auto-mapping: for each descriptor field, find the first sheet header
 * whose normalized text equals the field's normalized label (case/whitespace-insensitive);
 * unmatched fields map to `null`. The user can override any mapping in the wizard.
 */
export function autoMap<Input>(headers: string[], fields: ImportField<Input>[]): Mapping {
  const normalized = headers.map(norm);
  const mapping: Mapping = {};
  for (const field of fields) {
    const idx = normalized.indexOf(norm(field.label));
    mapping[field.key] = idx === -1 ? null : idx;
  }
  return mapping;
}
