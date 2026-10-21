import { fromCents, pctOf, toCents } from '@/src/lib/reports/managementPack';

/**
 * #766 — pure progress-billing arithmetic for the Billing tab. Figures arrive from `get_project_billing` net
 * of tax in the project's currency. Balances are derived in integer cents and never clamped (DD-PBL-9).
 * ⚑ Assessed to date and the gap use the management pack's own `pctOf`, so they ARE the pack's recognised to
 * date and unbilled for the current month — one formula, not two.
 */
export type EarningBasis = 'unit_rate' | 'lump_sum';
export interface AllocationFacts {
  workOrderId: string; boqItemId: string; quantity: number; claimedQuantity: number;
  /** null = no confirmed BAST (distinct from a BAST of zero). */
  acceptedQuantity: number | null; final: boolean;
}
export interface ContractLineFacts {
  boqItemId: string; earningBasis: EarningBasis; lineNo: number | null;
  orderedQuantity: number; acceptedQuantity: number; closedFinal: number;
  earnedQuantity: number; contractBalance: number; allocations: AllocationFacts[];
}

export interface ProjectBillingFacts {
  earnedValue: number;
  contractLines: ContractLineFacts[];
  currency: string;
  contractNet: number;
  workBilled: number;
  dpBilled: number;
  dpRecovered: number;
  notSubmitted: number;
  /** The latest assessment up to the org's current month, or null when none has been recorded. */
  assessment: { month: string; pctComplete: number } | null;
  /** Claimed quantity per BoQ line across live claims. */
  claimedByBoqItem: Record<string, number>;
  /** Quantity done to date per BoQ line in the latest assessment (absent = not measured). */
  assessedByBoqItem: Record<string, number>;
}

export interface ProjectBillingSummary extends ProjectBillingFacts {
  /** Down payment invoiced − recovered. */
  dpHeld: number;
  /** Net contract − billed to date. */
  remaining: number;
  /** Latest assessment % × net contract; null without an assessment. */
  assessedToDate: number | null;
  /** Assessed − billed ("work done, not yet billed"); null without an assessment. */
  unbilledWork: number | null;
}

const milli = (value: number): number => Math.round(value * 1000);

export function summarizeBilling(facts: ProjectBillingFacts): ProjectBillingSummary {
  const assessedCents = facts.contractLines.length > 0
    ? toCents(facts.earnedValue)
    : facts.assessment && facts.contractNet >= 0
      ? pctOf(toCents(facts.contractNet), facts.assessment.pctComplete)
      : null;
  return {
    ...facts,
    dpHeld: fromCents(toCents(facts.dpBilled) - toCents(facts.dpRecovered)),
    remaining: fromCents(toCents(facts.contractNet) - toCents(facts.workBilled)),
    assessedToDate: assessedCents === null ? null : fromCents(assessedCents),
    unbilledWork: assessedCents === null ? null : fromCents(assessedCents - toCents(facts.workBilled)),
  };
}

export function claimNet(gross: number, recovery: number): number {
  return fromCents(toCents(gross) - toCents(recovery));
}

export function remainingQuantity(boqQuantity: number, claimed: number): number {
  return (milli(boqQuantity) - milli(claimed)) / 1000;
}

/** DP ÷ contract × 100 to 3 decimals, capped at 100; null when either side is not positive. */
export function suggestedRecoveryPct(dpAmount: number, contractNet: number): number | null {
  if (!(dpAmount > 0) || !(contractNet > 0)) return null;
  return Math.min(100, Math.round((dpAmount / contractNet) * 100_000) / 1000);
}

/** Assessed − claimed per line (FR-PB-025), only where that is above zero. A pre-fill, not a rule. */
export function prefillFromAssessment(
  lineIds: readonly string[],
  assessed: Record<string, number>,
  claimed: Record<string, number>,
): Record<string, number> {
  const fill: Record<string, number> = {};
  for (const id of lineIds) {
    if (assessed[id] === undefined) continue;
    const left = milli(assessed[id]) - milli(claimed[id] ?? 0);
    if (left > 0) fill[id] = left / 1000;
  }
  return fill;
}
