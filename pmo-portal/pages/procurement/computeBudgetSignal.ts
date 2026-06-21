/**
 * computeBudgetSignal — pure Reserved-budget derivations for DecisionSupportPanel (ADR-0034 §5).
 *
 * Extracted from DecisionSupportPanel so the interdependent budget math is independently
 * unit-testable (behaviour-preserving — encodes the EXACT figures the panel rendered):
 *
 *   available       = budget − committed − reserved                    (FR-RB-010)
 *   caseInReserved  = RESERVED_STATUSES.includes(status)               (FR-RB-013/014)
 *   afterRequest    = available − (caseInReserved ? 0 : totalValue)    (FR-RB-013 — the
 *                     double-count fix: when the viewed case is itself already inside
 *                     `reserved`, its value is already counted, so don't subtract again)
 *   otherReserved   = reserved − (caseInReserved ? totalValue : 0)     (FR-RB-014 — the tile
 *                     shows OTHER reserved; headroom math above uses TOTAL reserved)
 *   overAvailable   = !caseInReserved && totalValue > available        (FR-RB-040 advisory)
 *   overBudgetReserved = caseInReserved && available < 0               (FR-RB-041 advisory)
 *
 * `reserved` is the TOTAL reserved for the project (incl. this case when its status is in
 * RESERVED_STATUSES). All figures are presentation-agnostic; the panel formats + renders.
 */
import { RESERVED_STATUSES } from '@/src/lib/db/procurements';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';

export interface BudgetSignalInput {
  /** Σ Active budget-version line items for the project. */
  budget: number;
  /** Σ PO total_value in Ordered..Paid (the dashboard committed-spend basis). */
  committed: number;
  /** TOTAL reserved (Σ total_value in Approved/Vendor Quoted/Quote Selected) — incl. this case. */
  reserved: number;
  /** This request's total_value. */
  totalValue: number;
  /** The case's current status — drives the per-stage double-count branch. */
  status: ProcurementStatus;
}

export interface BudgetSignal {
  /** Budget − Committed − Reserved (the over-commitment-safe headroom). */
  available: number;
  /** Headroom after this request: available, less totalValue only when not already reserved. */
  afterRequest: number;
  /** Reserved EXCLUDING this case (what the "Reserved" tile shows). */
  otherReserved: number;
  /** Whether this case's status already counts inside `reserved`. */
  caseInReserved: boolean;
  /** FR-RB-040 — this request (not yet reserved) exceeds available. */
  overAvailable: boolean;
  /** Dollar amount by which the request exceeds available (0 when not over). */
  overAvailableAmount: number;
  /** FR-RB-041 — case already reserved AND the project is over budget across all demand. */
  overBudgetReserved: boolean;
}

export function computeBudgetSignal(input: BudgetSignalInput): BudgetSignal {
  const { budget, committed, reserved, totalValue, status } = input;

  const available = budget - committed - reserved; // FR-RB-010
  const caseInReserved = RESERVED_STATUSES.includes(status); // FR-RB-013/014

  // FR-RB-013 — subtract thisRequest only when the case is NOT already inside Reserved.
  const afterRequest = available - (caseInReserved ? 0 : totalValue);
  // FR-RB-014 — the tile shows OTHER reserved (excluding this case).
  const otherReserved = reserved - (caseInReserved ? totalValue : 0);

  // FR-RB-040 — advisory only when NOT already reserved (Draft/Requested) AND over available.
  const overAvailable = !caseInReserved && totalValue > available;
  const overAvailableAmount = overAvailable ? totalValue - available : 0;
  // FR-RB-041 — when already reserved, surface project-level over-budget instead.
  const overBudgetReserved = caseInReserved && available < 0;

  return {
    available,
    afterRequest,
    otherReserved,
    caseInReserved,
    overAvailable,
    overAvailableAmount,
    overBudgetReserved,
  };
}
