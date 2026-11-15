import type { TFunction } from 'i18next';
import { repositories } from '@/src/lib/repositories';
import { parseNeutralMoneyInputAtScale } from '@/src/lib/format';
import { AppError } from '@/src/lib/appError';
import { contractLineProblemCodes, defaultContractLineBasis } from '../../../../scripts/lib/contract-line-rules.mjs';
import { type ImportDescriptor, IMPORT_SKIPPED } from './types';

/** One sheet row: one contract (bill-of-quantities) line of the project the wizard was opened on (#1278). */
export interface ContractLineImportInput {
  importKey: string;
  itemCode: string;
  description: string;
  unit: string;
  quantity: number;
  rate: number;
  earningBasis: 'unit_rate' | 'lump_sum';
  lineNo: number | null;
}

type Key = keyof ContractLineImportInput & string;

/** The CLI's `"field"` names → the descriptor field each message belongs on. */
const FIELD_OF: Record<string, Key> = {
  key: 'importKey', item_code: 'itemCode', description: 'description', unit: 'unit',
  quantity: 'quantity', rate: 'rate', line_no: 'lineNo', basis: 'earningBasis',
};

/**
 * Structured rule code → the catalogue key + English fallback of its PLAIN sentence (#1278 round A item 3).
 * The rules stay shared with `pmo load` (`contractLineProblemCodes`); only the words differ — the CLI keeps
 * its own technical wording, the app speaks plain sentences in the reader's language. Every key here is
 * LITERAL so the i18n completeness gate scans it.
 */
const ERROR_OF: Record<string, { key: string; fallback: string }> = {
  'key:required': { key: 'import:contractLines.error.keyRequired', fallback: 'Key is required.' },
  'key:tooLong': { key: 'import:contractLines.error.keyTooLong', fallback: 'Key must be at most {{max}} characters.' },
  'key:duplicate': { key: 'import:contractLines.error.keyDuplicate', fallback: 'Key "{{value}}" appears twice.' },
  'item_code:required': { key: 'import:contractLines.error.itemCodeRequired', fallback: 'Item code is required.' },
  'item_code:tooLong': { key: 'import:contractLines.error.itemCodeTooLong', fallback: 'Item code must be at most {{max}} characters.' },
  'description:required': { key: 'import:contractLines.error.descriptionRequired', fallback: 'Description is required.' },
  'description:tooLong': { key: 'import:contractLines.error.descriptionTooLong', fallback: 'Description must be at most {{max}} characters.' },
  'unit:required': { key: 'import:contractLines.error.unitRequired', fallback: 'Unit is required.' },
  'unit:tooLong': { key: 'import:contractLines.error.unitTooLong', fallback: 'Unit must be at most {{max}} characters.' },
  'quantity:invalid': { key: 'import:contractLines.error.quantity', fallback: 'Quantity must be a number above 0 (up to 3 decimals).' },
  'rate:invalid': { key: 'import:contractLines.error.rate', fallback: 'Rate must be a number of 0 or more (up to 2 decimals).' },
  'line_no:notWhole': { key: 'import:contractLines.error.lineNoWhole', fallback: 'Line number must be a whole number.' },
  'line_no:outOfRange': { key: 'import:contractLines.error.lineNoRange', fallback: 'Line number is out of range.' },
  'basis:invalid': { key: 'import:contractLines.error.basis', fallback: 'Basis must be a unit rate or a lump sum.' },
  'quantity:lumpSumOne': { key: 'import:contractLines.error.lumpSumQuantity', fallback: 'A lump-sum line must have quantity 1.' },
};

/** Cells → the typed line `pmo load` validates. An unparseable number stays NaN so the shared rule refuses it. */
function lineFromCells(c: Record<string, string>) {
  const num = (raw: string | undefined, scale: number) => {
    const n = parseNeutralMoneyInputAtScale(raw ?? '', scale);
    return n === null ? Number.NaN : n;
  };
  const lineNo = (c.lineNo ?? '').trim();
  const basis = (c.earningBasis ?? '').trim();
  return {
    key: c.importKey ?? '', item_code: c.itemCode ?? '', description: c.description ?? '', unit: c.unit ?? '',
    quantity: num(c.quantity, 3), rate: num(c.rate, 2),
    line_no: lineNo === '' ? undefined : /^-?\d+$/.test(lineNo) ? Number(lineNo) : Number.NaN,
    basis: basis === '' ? undefined : basis,
  };
}

/**
 * Contract-lines import descriptor for ONE project (the Billing tab's), #1278. Every rule is the shared
 * `contract-line-rules` module `pmo load` uses, so the preview refuses exactly what the CLI refuses. A key already
 * on the project is skipped, never updated (DD-CQ-7): the `boq_items` unique import key answers 23505.
 *
 * `currency` names the project's currency once in the rate column header ("Rate (USD)"), item 7 of the round-A
 * fix list — never hard-coded, never repeated on the figures.
 */
export function makeContractLineImportDescriptor(projectId: string, t?: TFunction, currency?: string): ImportDescriptor<ContractLineImportInput> {
  // LITERAL keys only (the i18n completeness gate scans for them); English fallback when no `t` is given (CLI-parity tests).
  const label = (key: string, fallback: string, params?: Record<string, unknown>) => {
    if (t) return String(t(key, fallback, params));
    return params ? fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? '')) : fallback;
  };
  const noCellRule = () => null; // rules run in validateRow: they read several cells (unit → basis → quantity).
  const field = (key: Key, label: string, required: boolean, hideInPreview = false) => ({ key, label, required, validate: noCellRule, hideInPreview });
  return {
    entity: 'Contract lines',
    // The wizard title/button word for THIS entity, in the reader's language. `entity` above stays the stable
    // identifier (analytics + table-id keys), never localized.
    entityDisplay: label('import:entity.contractLines', 'contract lines'),
    fields: [
      // The import key is internal (DD-CQ-7): mapped and validated, never shown as a column (round A item 6) —
      // the Row number identifies a row, so errors on it surface under the row's status.
      field('importKey', label('import:contractLines.key', 'Key'), true, true),
      field('itemCode', label('import:contractLines.itemCode', 'Item code'), true),
      field('description', label('import:contractLines.description', 'Description'), true),
      field('unit', label('import:contractLines.unit', 'Unit'), true), field('quantity', label('import:contractLines.quantity', 'Quantity'), true),
      field('rate', currency
        ? label('import:contractLines.rateWithCurrency', 'Rate ({{code}})', { code: currency })
        : label('import:contractLines.rate', 'Rate'), true),
      field('lineNo', label('import:contractLines.lineNo', 'Line no'), false), field('earningBasis', label('import:contractLines.earningBasis', 'Basis'), false),
    ],
    validateRow: (cells) => {
      const out: Partial<Record<Key, string>> = {};
      for (const problem of contractLineProblemCodes(lineFromCells(cells))) {
        const key = FIELD_OF[problem.field];
        const spec = ERROR_OF[`${problem.field}:${problem.code}`];
        if (key && spec && !out[key]) out[key] = label(spec.key, spec.fallback, problem.params);
      }
      return out;
    },
    // A key repeated in one sheet: the CLI's own rule (`seen` in contractLineProblemCodes), refused on the repeat
    // with the sheet rows named (row 1 is the header). Never left for the write path to skip.
    validateSheet: (rows) => {
      const seen = new Set<string>();
      const firstRow = new Map<string, number>();
      return rows.map((cells, i) => {
        const line = lineFromCells(cells);
        const dup = contractLineProblemCodes({ key: line.key }, seen).find((p) => p.code === 'duplicate');
        if (dup) return { importKey: label('import:contractLines.error.keyDuplicateRows', 'Key "{{value}}" appears twice (rows {{first}} and {{second}}).', { value: line.key, first: (firstRow.get(line.key) ?? 0) + 2, second: i + 2 }) };
        if (!firstRow.has(line.key)) firstRow.set(line.key, i);
        return {};
      });
    },
    toInput: (cells) => {
      const line = lineFromCells(cells);
      return {
        importKey: line.key, itemCode: line.item_code.trim(), description: line.description.trim(), unit: line.unit.trim(),
        quantity: line.quantity, rate: line.rate,
        earningBasis: (line.basis ?? defaultContractLineBasis(line.unit)) as ContractLineImportInput['earningBasis'],
        lineNo: line.line_no ?? null,
      };
    },
    create: async (input) => {
      try {
        return await repositories.progressBilling.createBoq(projectId, input);
      } catch (err) {
        if (err instanceof AppError && err.code === '23505') return IMPORT_SKIPPED;
        throw err;
      }
    },
  };
}
