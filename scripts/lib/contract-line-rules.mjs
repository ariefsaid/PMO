/**
 * Contract-line (bill of quantities) field rules, shared by `pmo load` (scripts/lib/pmo-load.mjs) and the app's
 * contract-lines importer (pmo-portal/src/lib/import/contractLineDescriptor.ts) so a file the CLI refuses the
 * app refuses too, with the same words (#1278). Pure: no I/O, Node standard library only.
 */
export const CONTRACT_LINE_BASES = Object.freeze(['unit_rate', 'lump_sum']);

const isText = (v) => typeof v === 'string' && v.trim() !== '';
/** numeric(14,2): finite, non-negative, below 1e12, at most two decimals. */
export const isAmount = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e12 && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
/** numeric(14,3) quantity: finite, positive, below 1e11, at most three decimals. */
export const isQuantity = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e11 && Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6;

/** A contract line's earning basis when the file gives none: a lump-sum unit earns by percent. */
export const defaultContractLineBasis = (unit) =>
  ['lot', 'ls', 'lump sum'].includes(String(unit).trim().toLowerCase()) ? 'lump_sum' : 'unit_rate';

/**
 * Every problem with one line's field values (typed: quantity/rate/line_no are numbers), in the order the CLI
 * reports them. `seen` is the set of keys already used in the file; pass it to refuse a repeated key.
 */
export function contractLineProblems(l, seen = new Set()) {
  const out = [];
  if (!isText(l.key)) out.push('"key" is required');
  else if ([...l.key].length > 500) out.push('"key" must be at most 500 characters');
  else if (seen.has(l.key)) out.push(`"key" "${l.key}" appears twice`);
  else seen.add(l.key);
  if (!isText(l.item_code)) out.push('"item_code" (the ERP service item) is required');
  else if (l.item_code.length > 140) out.push('"item_code" must be at most 140 characters');
  for (const [k, max] of [['description', 500], ['unit', 40]]) {
    if (!isText(l[k])) out.push(`"${k}" is required`);
    else if (l[k].length > max) out.push(`"${k}" must be at most ${max} characters`);
  }
  const quantityOk = isQuantity(l.quantity);
  if (!quantityOk) out.push('"quantity" must be a positive number below 100000000000 with at most 3 decimals');
  if (!isAmount(l.rate)) out.push('"rate" must be a non-negative amount with at most 2 decimals');
  if (l.line_no !== undefined && l.line_no !== null) {
    if (!Number.isInteger(l.line_no)) out.push('"line_no" must be a whole number');
    else if (l.line_no < -2147483648 || l.line_no > 2147483647) out.push('"line_no" must fit a 32-bit integer');
  }
  const basisOk = l.basis === undefined || CONTRACT_LINE_BASES.includes(l.basis);
  if (!basisOk) out.push('"basis" must be "unit_rate" or "lump_sum"');
  if (basisOk && quantityOk && isText(l.unit) && (l.basis ?? defaultContractLineBasis(l.unit)) === 'lump_sum' && l.quantity !== 1) {
    out.push('a lump-sum line must have quantity 1');
  }
  return out;
}
