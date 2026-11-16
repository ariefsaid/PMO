/**
 * computeBudgetSignal — pure "Left after this purchase" derivations for DecisionSupportPanel
 * (ADR-0034 §5, amended by OD-APPROVAL-LEFT).
 *
 * Every amount is counted once:
 *
 *   left            = budget − spent − openOrders − reserved            (FR-RB-010)
 *   counted         = in RESERVED_STATUSES (already in `reserved`) or in COMMITTED_STATUSES
 *                     (already an order: its open part in openOrders, its paid part in spent)
 *   afterRequest    = left − (counted ? 0 : totalValue)                 (FR-RB-013)
 *   otherReserved   = reserved − (in RESERVED_STATUSES ? totalValue : 0)  (FR-RB-014 — the tile
 *                     shows OTHER reserved; the math above uses TOTAL reserved)
 *
 * `spent` is the recorded spending (paid pre-tax on PMO, the ledger actual on ERP). `openOrders` is the
 * order total less the part `spent` already holds. `reserved` is the TOTAL reserved for the project
 * (incl. this case when its status is in RESERVED_STATUSES). All figures are presentation-agnostic.
 */
import { decimalUnits } from '@/src/lib/taxNormalize';
import { COMMITTED_STATUSES, RESERVED_STATUSES } from '@/src/lib/db/procurements';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';

export interface BudgetSignalInput {
  projectCurrency: string | null | undefined;
  budgetCurrency: string | null | undefined;
  requestCurrency: string | null | undefined;
  /** Σ Active budget-version line items for the project. */
  budget: number;
  /** Recorded spending: the project header's reading (paid pre-tax on PMO, ledger actual on ERP). */
  spent: number;
  /** Open orders: order totals less what `spent` already holds (OD-1530-COMMIT / ADR-0093 §2). */
  openOrders: number;
  /** TOTAL reserved (Σ total_value in Approved/Vendor Quoted/Quote Selected) — incl. this case. */
  reserved: number;
  /** This request's total_value. */
  totalValue: number;
  /** The case's current status — drives the per-stage double-count branch. */
  status: ProcurementStatus;
}

export interface BudgetSignal {
  /** Budget − spent − open orders − reserved, before this request. */
  left: number;
  /** Left after this request: `left`, less totalValue only when the request is not already counted. */
  afterRequest: number;
  /** Reserved EXCLUDING this case (what the "Reserved" tile shows). */
  otherReserved: number;
}

export function computeBudgetSignal(input: BudgetSignalInput): BudgetSignal {
  const { budget, spent, openOrders, reserved, totalValue, status, projectCurrency, budgetCurrency, requestCurrency } = input;
  if (!projectCurrency || !budgetCurrency || !requestCurrency ||
      projectCurrency !== budgetCurrency || projectCurrency !== requestCurrency) {
    throw new Error('Budget comparison requires matching currencies');
  }

  const inputs = [budget, spent, openOrders, reserved, totalValue];
  // Below 2^46, every cent can round-trip through the existing number-based inputs.
  if (inputs.some((value) => !Number.isFinite(value) || Math.abs(value) >= 2 ** 46)) {
    throw new Error('Budget position cannot be represented exactly');
  }
  const values = inputs.map((value) => decimalUnits(value, 2));
  if (values.some((value) => value === null || value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER))) {
    throw new Error('Budget position cannot be represented exactly');
  }
  const [budgetCents, spentCents, openCents, reservedCents, requestCents] = values as bigint[];
  const leftCents = budgetCents - spentCents - openCents - reservedCents;
  const inReserved = RESERVED_STATUSES.includes(status);
  // Already inside Reserved, or already an order (its open part in openOrders, its paid part in spent): never twice.
  const counted = inReserved || COMMITTED_STATUSES.includes(status);
  const afterCents = leftCents - (counted ? 0n : requestCents);
  const otherReservedCents = reservedCents - (inReserved ? requestCents : 0n);
  // The returned number must preserve cents under the same bound as the inputs.
  const toMoney = (cents: bigint): number => {
    const limit = (2n ** 46n) * 100n;
    if (cents <= -limit || cents >= limit) throw new Error('Budget position cannot be represented exactly');
    return Number(cents) / 100;
  };

  return { left: toMoney(leftCents), afterRequest: toMoney(afterCents), otherReserved: toMoney(otherReservedCents) };
}
