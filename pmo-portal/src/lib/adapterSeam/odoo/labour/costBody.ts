/**
 * The payroll-cost half of the Odoo labour seam: one `account.move` of type `entry` per approved labour-cost batch
 * revision (FR-OLH-020, AC-OLH-030), pure. The cost never rides an analytic line: an analytic line posts no GL, and a
 * journal entry reaches both the analytic and the financial ledger (D1). Amounts are integer cents in and decimal
 * strings out — never a float (NFR-ODA-001).
 *
 * Bed claims this file is written to, still assumptions behind the plan's fake until L0 records a verdict:
 * V-OLH-7 (`account.move/create {move_type:'entry', journal_id, line_ids}` then `action_post` posts it),
 * V-OLH-8 (`analytic_distribution` keys are analytic-account ids **as strings**, values numbers, and a yearless key is
 * accepted on an entry line). No anchor travels in the body: the anchor is the `ir.model.data` row (V-OLH-6).
 */
import { formatCents } from '../ledger/cents.ts';
import { isIsoDate } from './bodies.ts';

/** One project's share of the revision: the delta between what the batch allocates now and what PMO already posted. */
export interface CostLine {
  projectId: string;
  /** The PMO project code, which the expense line's name carries. */
  projectCode: string;
  /** The project's analytic account; null when the link is missing, and then nothing can be posted for it. */
  analyticAccountId: number | null;
  /** New − already posted, in the company currency's minor unit. Negative and zero deltas post nothing (see below). */
  deltaCents: number;
}

/** Admin-chosen at employ time (D8); an unset config is refused by the gate before this builder is called. */
export interface CostMaps { journalId: number; expenseAccountId: number; payableAccountId: number }

export interface CostEntryInput {
  /** The batch version being posted; its period end is the entry's `date` and its month is the `ref` (plain text). */
  batch: { periodEnd: string; currency: string };
  lines: readonly CostLine[];
  maps: CostMaps;
  /** The Odoo company's currency: no conversion in this slice (D12). */
  companyCurrency: string;
}

export type BuiltCostEntry =
  | { outcome: 'ready'; body: Record<string, unknown> }
  | { outcome: 'refused'; code: 'project-unmapped'; projectCode: string }
  | { outcome: 'refused'; code: 'labour-cost-precision' | 'labour-cost-currency' }
  | { outcome: 'settled' };

/**
 * The journal body, or a refusal, or `settled` when there is nothing to post. Only positive deltas are posted: a zero
 * delta posts nothing (FR-OLH-022), and a non-positive delta list is settled, so this builder never emits a credit-side
 * expense line. The credit line is derived from the debits, so a body can never be out of balance.
 */
export function buildCostEntry(input: CostEntryInput): BuiltCostEntry {
  const { periodEnd, currency } = input.batch;
  if (!isIsoDate(periodEnd)) throw new Error('Invalid labour cost period');
  if (currency !== input.companyCurrency) return { outcome: 'refused', code: 'labour-cost-currency' };
  if (input.lines.some((line) => !Number.isSafeInteger(line.deltaCents))) return { outcome: 'refused', code: 'labour-cost-precision' };

  const posted = [...input.lines]
    .filter((line) => line.deltaCents > 0)
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.projectId.localeCompare(b.projectId));
  if (!posted.length) return { outcome: 'settled' };
  const unmapped = posted.find((line) => line.analyticAccountId === null);
  if (unmapped) return { outcome: 'refused', code: 'project-unmapped', projectCode: unmapped.projectCode };

  const total = posted.reduce((sum, line) => sum + line.deltaCents, 0);
  const line_ids: Array<[0, 0, Record<string, unknown>]> = posted.map((line) => [0, 0, {
    account_id: input.maps.expenseAccountId,
    name: `Labour · ${line.projectCode}`,
    debit: formatCents(BigInt(line.deltaCents)),
    credit: '0.00',
    analytic_distribution: { [String(line.analyticAccountId)]: 100 },
  }]);
  line_ids.push([0, 0, {
    account_id: input.maps.payableAccountId,
    name: 'Payroll payable',
    debit: '0.00',
    credit: formatCents(BigInt(total)),
  }]);
  return {
    outcome: 'ready',
    body: {
      move_type: 'entry',
      journal_id: input.maps.journalId,
      date: periodEnd,
      ref: `PMO labour ${periodEnd.slice(0, 7)}`,
      line_ids,
    },
  };
}
