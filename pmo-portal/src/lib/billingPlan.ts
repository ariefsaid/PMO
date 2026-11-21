import { fromCents, toCents } from '@/src/lib/reports/managementPack';
import { remainingQuantity } from '@/src/lib/progressBilling';

/**
 * #2682 — the monthly billing plan: pure arithmetic over the rows of `billing_plan_candidates()` (migration 1376). A candidate is
 * accepted-not-yet-claimed work (the Cascade's "Unclaimed"); this module only totals what the viewer ticked against the month's target.
 * Nothing here is stored and nothing raises a claim (docs/specs/monthly-billing-plan.spec.md, OD-SCOPE-6). Money is summed in integer cents.
 */

export interface PlanCandidate {
  /** Stable identity for ticking: kind, work order and contract line. */
  key: string;
  kind: 'line' | 'order';
  projectId: string;
  projectName: string;
  currency: string;
  workOrderId: string | null;
  woNumber: string | null;
  boqItemId: string | null;
  itemCode: string | null;
  description: string | null;
  unit: string | null;
  earningBasis: string | null;
  contractQuantity: number | null;
  acceptedQuantity: number | null;
  claimedQuantity: number | null;
  unclaimedQuantity: number | null;
  value: number;
  /** Date of the latest confirmed acceptance (the seam #2675 reads for age); null when none. */
  acceptedOn: string | null;
  today: string;
}

export interface PlanTarget {
  amount: number;
  currency: string;
  source: 'month' | 'default';
}

export interface PlanTotals {
  pickedCount: number;
  /** Picked value in the target's currency, or in the single currency picked when there is no target. */
  counted: number;
  countedCurrency: string | null;
  /** Target minus counted; negative = above target; null without a target. */
  remaining: number | null;
  aboveTarget: boolean;
  /** Picked value in other currencies: listed, never converted, never counted toward the target. */
  otherCurrencies: Array<{ currency: string; total: number }>;
}

export const candidateKey = (c: { kind: string; workOrderId: string | null; boqItemId: string | null }) =>
  `${c.kind}:${c.workOrderId ?? '-'}:${c.boqItemId ?? '-'}`;

/** The first day of the calendar month of an ISO day (the organisation's today from the server, never the device clock). */
export const monthOf = (isoDay: string): string => `${isoDay.slice(0, 7)}-01`;

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/** A month's override wins over the default; neither = no target (the screen says "No target set"). */
export function resolveTarget(
  settings: { monthlyTarget: number | null; targetCurrency: string | null } | null,
  overrides: Array<{ month: string; target: number }>,
  month: string,
): PlanTarget | null {
  if (!settings?.targetCurrency) return null;
  const override = overrides.find((o) => o.month === month);
  if (override) return { amount: override.target, currency: settings.targetCurrency, source: 'month' };
  if (settings.monthlyTarget === null) return null;
  return { amount: settings.monthlyTarget, currency: settings.targetCurrency, source: 'default' };
}

export function planTotals(candidates: PlanCandidate[], picked: ReadonlySet<string>, target: PlanTarget | null): PlanTotals {
  const byCurrency = new Map<string, number>();
  let pickedCount = 0;
  for (const c of candidates) {
    if (!picked.has(c.key)) continue;
    pickedCount += 1;
    byCurrency.set(c.currency, (byCurrency.get(c.currency) ?? 0) + toCents(c.value));
  }
  const countedCurrency = target ? target.currency : (byCurrency.size === 1 ? [...byCurrency.keys()][0] : null);
  const countedCents = countedCurrency ? (byCurrency.get(countedCurrency) ?? 0) : 0;
  const remainingCents = target ? toCents(target.amount) - countedCents : null;
  return {
    pickedCount,
    counted: fromCents(countedCents),
    countedCurrency,
    remaining: remainingCents === null ? null : fromCents(remainingCents),
    aboveTarget: remainingCents !== null && remainingCents < 0,
    otherCurrencies: [...byCurrency.entries()]
      .filter(([currency]) => currency !== countedCurrency)
      .map(([currency, cents]) => ({ currency, total: fromCents(cents) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

/**
 * The existing over-claim rule (`remainingQuantity < 0`, "Over-claimed" on the Billing tab) applied to a ticked quantity line:
 * claimed plus the unclaimed quantity would pass the contract quantity. A warning only; nothing is ever blocked.
 */
export function overClaimWarning(c: PlanCandidate): boolean {
  if (c.kind !== 'line' || c.contractQuantity === null || c.claimedQuantity === null || c.unclaimedQuantity === null) return false;
  return remainingQuantity(c.contractQuantity, c.claimedQuantity + c.unclaimedQuantity) < 0;
}

export interface ProjectGroup {
  projectId: string;
  projectName: string;
  candidates: PlanCandidate[];
}

/** Candidates grouped by project, groups in order of first appearance (the read is highest value first). */
export function groupByProject(candidates: PlanCandidate[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const c of candidates) {
    const g = groups.get(c.projectId) ?? { projectId: c.projectId, projectName: c.projectName, candidates: [] };
    g.candidates.push(c);
    groups.set(c.projectId, g);
  }
  return [...groups.values()];
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
};

/**
 * #2675 — how long accepted work has waited without a claim: whole days from the date of the latest confirmed acceptance to the
 * organisation's today (both come from the candidates read, in the organisation's time zone; the device clock never enters).
 * No acceptance date = no age; a date after today counts as 0. Information only.
 */
export function doneNotClaimedAge(acceptedOn: string | null, today: string): number | null {
  if (!acceptedOn) return null;
  return Math.max(0, dayNumber(today) - dayNumber(acceptedOn));
}

/** The alert exists only while the reminder is on AND the organisation set a day limit; then a line is over it when older than the limit. */
export function isOverLimit(age: number | null, limit: number | null, reminderOn: boolean): boolean {
  return reminderOn && limit !== null && age !== null && age > limit;
}
