import type { ImportField, Mapping } from './types';

/** Normalize a header/label for matching: lowercase, collapse all whitespace, trim. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Pure, synchronous auto-mapping: for each descriptor field, find the first sheet header
 * whose normalized text equals EITHER the field's normalized label OR the field's key
 * (both case/whitespace-insensitive). Label is tried first; if not found, key is tried.
 * Unmatched fields map to `null`. The user can override any mapping in the wizard.
 *
 * Drift fix: previously only matched on label, missing exact key-name headers like "name"
 * when the label was "Company name" — causing mis-imports even for well-formed spreadsheets.
 */
export function autoMap<Input>(headers: string[], fields: ImportField<Input>[]): Mapping {
  const normalized = headers.map(norm);
  const mapping: Mapping = {};
  for (const field of fields) {
    // Try label first, then key — both normalized (case-insensitive, whitespace-collapsed).
    const byLabel = normalized.indexOf(norm(field.label));
    if (byLabel !== -1) {
      mapping[field.key] = byLabel;
      continue;
    }
    const byKey = normalized.indexOf(norm(field.key));
    mapping[field.key] = byKey === -1 ? null : byKey;
  }
  return mapping;
}
