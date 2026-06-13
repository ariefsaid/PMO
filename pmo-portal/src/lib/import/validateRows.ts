import type { ImportField, Mapping, RowValidation } from './types';

/**
 * The dry-run oracle (pure, synchronous, ZERO writes): for each data row, read the mapped
 * cell for each field (`''` when unmapped), run `field.validate`, and collect errors. A row
 * is `valid` when it has no field errors. The preview renders these; only `valid` rows are
 * later sent to `create`.
 */
export function validateRows<Input>(
  rows: string[][],
  fields: ImportField<Input>[],
  mapping: Mapping,
): RowValidation[] {
  return rows.map((row, index) => {
    const errors: Partial<Record<string, string>> = {};
    for (const field of fields) {
      const col = mapping[field.key];
      const raw = col == null ? '' : (row[col] ?? '');
      const error = field.validate(raw);
      if (error) errors[field.key] = error;
    }
    return { index, errors, valid: Object.keys(errors).length === 0 };
  });
}

/**
 * Build the create `Input` for a single (valid) row by reading each mapped cell into a
 * `{ label: cell }` record keyed by the descriptor field labels' target keys, then handing
 * it to `descriptor.toInput`. The cells object is keyed by `field.key` so `toInput` reads
 * `cells.name` / `cells.type` directly.
 */
export function rowToCells<Input>(
  row: string[],
  fields: ImportField<Input>[],
  mapping: Mapping,
): Record<string, string> {
  const cells: Record<string, string> = {};
  for (const field of fields) {
    const col = mapping[field.key];
    cells[field.key] = col == null ? '' : (row[col] ?? '');
  }
  return cells;
}
