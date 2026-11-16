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
  return contractLineProblemCodes(l, seen).map(contractLineProblemText);
}

/**
 * The same problems, STRUCTURED: `{ field, code, params }` — the machine shape the app importer maps to
 * translated plain sentences (#1278). Field names stay the CLI's (key, item_code, …) so the descriptor's
 * FIELD_OF map is the single field-name seam. Pure, with the same `seen` side effect as the text form.
 */
export function contractLineProblemCodes(l, seen = new Set()) {
  const out = [];
  if (!isText(l.key)) out.push({ field: 'key', code: 'required' });
  else if ([...l.key].length > 500) out.push({ field: 'key', code: 'tooLong', params: { max: 500 } });
  else if (seen.has(l.key)) out.push({ field: 'key', code: 'duplicate', params: { value: l.key } });
  else seen.add(l.key);
  if (!isText(l.item_code)) out.push({ field: 'item_code', code: 'required' });
  else if (l.item_code.length > 140) out.push({ field: 'item_code', code: 'tooLong', params: { max: 140 } });
  for (const [k, max] of [['description', 500], ['unit', 40]]) {
    if (!isText(l[k])) out.push({ field: k, code: 'required' });
    else if (l[k].length > max) out.push({ field: k, code: 'tooLong', params: { max } });
  }
  const quantityOk = isQuantity(l.quantity);
  if (!quantityOk) out.push({ field: 'quantity', code: 'invalid' });
  if (!isAmount(l.rate)) out.push({ field: 'rate', code: 'invalid' });
  if (l.line_no !== undefined && l.line_no !== null) {
    if (!Number.isInteger(l.line_no)) out.push({ field: 'line_no', code: 'notWhole' });
    else if (l.line_no < -2147483648 || l.line_no > 2147483647) out.push({ field: 'line_no', code: 'outOfRange' });
  }
  const basisOk = l.basis === undefined || CONTRACT_LINE_BASES.includes(l.basis);
  if (!basisOk) out.push({ field: 'basis', code: 'invalid' });
  if (basisOk && quantityOk && isText(l.unit) && (l.basis ?? defaultContractLineBasis(l.unit)) === 'lump_sum' && l.quantity !== 1) {
    out.push({ field: 'quantity', code: 'lumpSumOne' });
  }
  return out;
}

/** The CLI's words for one structured problem — byte-identical to what `pmo load` has always printed. */
export function contractLineProblemText({ field, code, params = {} }) {
  switch (`${field}:${code}`) {
    case 'key:required': return '"key" is required';
    case 'key:tooLong': return `"key" must be at most ${params.max} characters`;
    case 'key:duplicate': return `"key" "${params.value}" appears twice`;
    case 'item_code:required': return '"item_code" (the ERP service item) is required';
    case 'item_code:tooLong': return `"item_code" must be at most ${params.max} characters`;
    case 'description:required': return '"description" is required';
    case 'description:tooLong': return `"description" must be at most ${params.max} characters`;
    case 'unit:required': return '"unit" is required';
    case 'unit:tooLong': return `"unit" must be at most ${params.max} characters`;
    case 'quantity:invalid': return '"quantity" must be a positive number below 100000000000 with at most 3 decimals';
    case 'rate:invalid': return '"rate" must be a non-negative amount with at most 2 decimals';
    case 'line_no:notWhole': return '"line_no" must be a whole number';
    case 'line_no:outOfRange': return '"line_no" must fit a 32-bit integer';
    case 'basis:invalid': return '"basis" must be "unit_rate" or "lump_sum"';
    case 'quantity:lumpSumOne': return 'a lump-sum line must have quantity 1';
    default: throw new Error(`contract-line-rules: no CLI text for ${field}:${code}`);
  }
}
