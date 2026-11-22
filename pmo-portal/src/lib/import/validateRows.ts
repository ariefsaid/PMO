import type { ImportDescriptor, ImportField, MatchExisting, Mapping, RowValidation } from './types';

/**
 * The dry-run oracle (pure, synchronous, ZERO writes): for each data row, read the mapped
 * cell for each field (`''` when unmapped), run `field.validate`, and collect errors. A row
 * is `valid` when it has no field errors. The preview renders these; only `valid` rows are
 * later sent to `create`.
 *
 * `validateRow` (optional, #513) then runs the descriptor's CROSS-FIELD rules over the same cells
 * — constraints that are a relationship between columns rather than a property of one. Per-cell
 * errors WIN on a collision: a cell that is malformed in its own right gets the message about that,
 * not a message about its relationship to another cell.
 */
export function validateRows<Input>(
  rows: string[][],
  fields: ImportField<Input>[],
  mapping: Mapping,
  validateRow?: ImportDescriptor<Input>['validateRow'],
  validateSheet?: ImportDescriptor<Input>['validateSheet'],
): RowValidation[] {
  const sheetErrors = validateSheet ? validateSheet(rows.map((r) => rowToCells(r, fields, mapping))) : [];
  return rows.map((row, index) => {
    const errors: Partial<Record<string, string>> = {};
    for (const field of fields) {
      const col = mapping[field.key];
      const raw = col == null ? '' : (row[col] ?? '');
      const error = field.validate(raw);
      if (error) errors[field.key] = error;
    }
    if (validateRow) {
      const cells = rowToCells(row, fields, mapping);
      // `Object.entries` widens the value to `{}` for a Partial<Record<K, string>>, so the message
      // is narrowed back rather than asserted — the KEY type is the part that had to be tightened.
      for (const [key, message] of Object.entries(validateRow(cells))) {
        if (typeof message === 'string' && message && !errors[key]) errors[key] = message;
      }
    }
    for (const [key, message] of Object.entries(sheetErrors[index] ?? {})) {
      if (typeof message === 'string' && message && !errors[key]) errors[key] = message;
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

/**
 * Classify the otherwise-valid rows against the records already on the target (`matchExisting`): no match → `new`;
 * a match that changes something → `update` with its changes; a match that changes nothing → no change (not valid,
 * `already`). Rows with errors pass through untouched. Pure, ZERO writes.
 */
export function applyMatches(
  rows: RowValidation[],
  cellsByRow: Record<string, string>[],
  match: Pick<MatchExisting, 'keyOf' | 'changes'>,
  records: ReadonlyMap<string, unknown>,
): RowValidation[] {
  return rows.map((v) => {
    if (!v.valid) return v;
    const cells = cellsByRow[v.index];
    const record = records.get(match.keyOf(cells));
    if (record === undefined) return { ...v, action: 'new' as const };
    const changes = match.changes(record, cells);
    return changes.length === 0 ? { ...v, valid: false, already: true } : { ...v, action: 'update' as const, changes };
  });
}
