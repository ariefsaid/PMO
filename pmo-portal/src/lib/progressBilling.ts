import { fromCents, pctOf, toCents } from '@/src/lib/reports/managementPack';
import { formatMoneyInputValue, formatNumberExact } from '@/src/lib/format';

/**
 * #766 — pure progress-billing arithmetic for the Billing tab. Figures arrive from `get_project_billing` net
 * of tax in the project's currency. Balances are derived in integer cents and never clamped (DD-PBL-9).
 * Where a project has contract lines, assessed to date is the server's earned value (DD-CQ-5); otherwise it is the
 * latest assessment % of the net contract via `pctOf`.
 */
export type EarningBasis = 'unit_rate' | 'lump_sum';

/** One work-order allocation of a contract line. `acceptedQuantity` null = no confirmed BAST (distinct from 0). */
export interface AllocationFacts {
  workOrderId: string;
  boqItemId: string;
  quantity: number;
  claimedQuantity: number;
  acceptedQuantity: number | null;
  final: boolean;
}

export interface ContractLineFacts {
  boqItemId: string;
  earningBasis: EarningBasis;
  lineNo: number | null;
  orderedQuantity: number;
  acceptedQuantity: number;
  closedFinal: number;
  earnedQuantity: number;
  contractBalance: number;
  allocations: AllocationFacts[];
}

export interface ProjectBillingFacts {
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
  /** Σ per-line round(earned quantity × rate, 2), computed by the server. */
  earnedValue: number;
  /** Per-line contract facts; empty when the project has no contract lines. */
  contractLines: ContractLineFacts[];
}

export interface ProjectBillingSummary extends ProjectBillingFacts {
  /** Down payment invoiced − recovered. */
  dpHeld: number;
  /** Net contract − billed to date. */
  remaining: number;
  /** Server earned value for a project with contract lines, else latest assessment % × net contract (null without one). */
  assessedToDate: number | null;
  /** Assessed − billed ("work done, not yet billed"); null without an assessment. */
  unbilledWork: number | null;
}

/** Integer milli-units: quantities are 3 dp, so all comparisons and sums run on integers. */
export const milli = (value: number): number => Math.round(value * 1000);

/** Lump-sum quantity is a fraction of one lot (0–1, 3 dp) shown as a percent with at most 1 decimal (DD-CQ-1). */
export const fractionToPercentInput = (fraction: number): string => formatMoneyInputValue(Math.round(fraction * 1000) / 10);
export const percentToFraction = (percent: number): number => Math.round(percent * 10) / 1000;
export const percentOfLot = (fraction: number): string => `${formatNumberExact(Math.round(fraction * 1000) / 10)}%`;

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
