/**
 * The payroll-cost half of the Odoo labour seam: one `account.move` of type `entry` per approved labour-cost batch
 * revision (FR-OLH-020, AC-OLH-030), pure. The cost never rides an analytic line: an analytic line posts no GL, and a
 * journal entry reaches both the analytic and the financial ledger (D1). Amounts are integer cents in and decimal
 * strings out — never a float (NFR-ODA-001).
 *
 * A revision is signed: a project whose batch allocation *fell* posts its delta on the credit side, and the payable leg
 * follows the signed total (credit when it rises, debit when it falls) so `debit total = credit total` holds exactly
 * (AC-OLH-030). `settled` means every delta is exactly zero, nothing else (FR-OLH-022): a non-zero delta is money the
 * ledger is owed, and posting nothing for it would leave Odoo's labour expense permanently apart from PMO's figure.
 *
 * Bed claims this file is written to, still assumptions behind the plan's fake until L0 records a verdict:
 * V-OLH-7 (`account.move/create {move_type:'entry', journal_id, line_ids}` then `action_post` posts it — and, per this
 * file, that `action_post` accepts a line carrying a credit and a move whose payable leg is a debit, which no probe has
 * exercised yet: an L0 verdict owed by the plan's V-OLH-7 battery), V-OLH-8 (`analytic_distribution` keys are
 * analytic-account ids **as strings**, values numbers, and a yearless key is accepted on an entry line). No anchor
 * travels in the body: the anchor is the `ir.model.data` row (V-OLH-6).
 *
 * The money is sent as decimal strings (`'1000000.00'`), not JSON numbers. That is deliberate — exact decimal out of
 * integer cents is the one form with no float in the path — but it is a wire format no V-OLH row has verified, and every
 * other Odoo money body in this repo sends numbers. It is a claim, not a fact: L0's V-OLH-7 battery must create the entry
 * with this exact body and read it back; if the bed refuses or truncates a string on a Monetary field, the change is
 * `Number(formatCents(...))` at the two `formatCents` call sites plus the test fixture.
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
  /** New − already posted, in the company currency's minor unit. Signed: a decrease posts on the credit side. */
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
 * The journal body, or a refusal, or `settled` when every delta is zero. Each non-zero delta posts on its signed side —
 * debit when the project's cost rose, credit when it fell — on that project's analytic account, and the payable leg is
 * derived from the signed total. A net-zero revision (one project up, another down by the same amount) needs no payable
 * leg: its two expense lines already balance. Totals are bigint cents, so the one summed value stays off the float path.
 */
export function buildCostEntry(input: CostEntryInput): BuiltCostEntry {
  const { periodEnd, currency } = input.batch;
  if (!isIsoDate(periodEnd)) throw new Error('Invalid labour cost period');
  if (currency !== input.companyCurrency) return { outcome: 'refused', code: 'labour-cost-currency' };
  if (input.lines.some((line) => !Number.isSafeInteger(line.deltaCents))) return { outcome: 'refused', code: 'labour-cost-precision' };

  const posted = [...input.lines]
    .filter((line) => line.deltaCents !== 0)
    .sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.projectId.localeCompare(b.projectId));
  if (!posted.length) return { outcome: 'settled' };
  // A credit needs a distribution just as a debit does, so the unmapped check runs over the signed list.
  const unmapped = posted.find((line) => line.analyticAccountId === null);
  if (unmapped) return { outcome: 'refused', code: 'project-unmapped', projectCode: unmapped.projectCode };

  const total = posted.reduce((sum, line) => sum + BigInt(line.deltaCents), 0n);
  const line_ids: Array<[0, 0, Record<string, unknown>]> = posted.map((line) => [0, 0, {
    account_id: input.maps.expenseAccountId,
    name: `Labour · ${line.projectCode}`,
    debit: line.deltaCents > 0 ? formatCents(BigInt(line.deltaCents)) : '0.00',
    credit: line.deltaCents < 0 ? formatCents(BigInt(-line.deltaCents)) : '0.00',
    analytic_distribution: { [String(line.analyticAccountId)]: 100 },
  }]);
  if (total !== 0n) {
    line_ids.push([0, 0, {
      account_id: input.maps.payableAccountId,
      name: 'Payroll payable',
      debit: total < 0n ? formatCents(-total) : '0.00',
      credit: total > 0n ? formatCents(total) : '0.00',
    }]);
  }
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
