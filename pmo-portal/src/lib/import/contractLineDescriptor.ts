import { repositories } from '@/src/lib/repositories';
import { parseNeutralMoneyInputAtScale } from '@/src/lib/format';
import { AppError } from '@/src/lib/appError';
import { contractLineProblems, defaultContractLineBasis } from '../../../../scripts/lib/contract-line-rules.mjs';
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
 */
export function makeContractLineImportDescriptor(projectId: string): ImportDescriptor<ContractLineImportInput> {
  const noCellRule = () => null; // rules run in validateRow: they read several cells (unit → basis → quantity).
  const field = (key: Key, label: string, required: boolean) => ({ key, label, required, validate: noCellRule });
  return {
    entity: 'Contract lines',
    fields: [
      field('importKey', 'Key', true), field('itemCode', 'Item code', true), field('description', 'Description', true),
      field('unit', 'Unit', true), field('quantity', 'Quantity', true), field('rate', 'Rate', true),
      field('lineNo', 'Line no', false), field('earningBasis', 'Basis', false),
    ],
    validateRow: (cells) => {
      const out: Partial<Record<Key, string>> = {};
      for (const message of contractLineProblems(lineFromCells(cells))) {
        const name = /^"(\w+)"/.exec(message)?.[1];
        const key = name ? FIELD_OF[name] : message.startsWith('a lump-sum') ? 'quantity' : undefined;
        if (key && !out[key]) out[key] = message;
      }
      return out;
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
