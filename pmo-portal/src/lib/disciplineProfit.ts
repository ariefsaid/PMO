import { moneyText, moneyUnits, type ExactMoney } from './projectFinances';
import type { ProjectRollup } from './workOrderPlanVsActual';

/**
 * Profit per discipline (#2669, docs/specs/discipline-profit.spec.md). Pure join of two reads that already exist:
 * the plan-versus-actual roll-up (direct and allocated cost per discipline, never re-summed here) and the revenue read
 * (validated progress at the rate frozen at validation). Revenue rows carry a `basis`, so a second basis can sit beside
 * the first without changing this shape; only `VALIDATED_PROGRESS` is read today.
 */
export const VALIDATED_PROGRESS = 'validated_progress';

export interface DisciplineRevenueRow {
  basis: string;
  disciplineId: string | null;
  currency: string;
  revenue: ExactMoney;
  validatedLines: number;
  unratedLines: number;
}

/** A margin figure: the amount, or the reason there is none (words on screen, never a zero). */
export interface ProfitFigure {
  amount: ExactMoney | null;
  reason: null | 'not-comparable' | 'incomplete' | 'cost-unknown';
}

export interface ProfitRow {
  key: string;
  /** `unassigned` is cost held by no discipline (shared cost with no split); it has no revenue and no margin. */
  kind: 'discipline' | 'unassigned' | 'total';
  disciplineId: string | null;
  currency: string;
  revenue: ExactMoney | null;
  /** Some validated line had no rate: the revenue is a floor, named as incomplete. */
  incomplete: boolean;
  direct: ExactMoney | null;
  allocated: ExactMoney | null;
  /** Before shared cost = revenue - direct. After shared cost (the headline) = revenue - direct - allocated. */
  marginBefore: ProfitFigure;
  marginAfter: ProfitFigure;
}

export interface CurrencyProfit { currency: string; rows: ProfitRow[]; total: ProfitRow }
export interface DisciplineProfit { restricted: boolean; currencies: CurrencyProfit[] }

const sum = (values: ReadonlyArray<bigint | null>): bigint | null => {
  let t = 0n;
  for (const v of values) { if (v === null) return null; t += v; }
  return t;
};
const text = (c: bigint | null): ExactMoney | null => (c === null ? null : moneyText(c));

function figure(revenue: bigint | null, incomplete: boolean, costs: ReadonlyArray<bigint | null>, mixed: boolean): ProfitFigure {
  if (mixed) return { amount: null, reason: 'not-comparable' };
  const cost = sum(costs);
  if (cost === null) return { amount: null, reason: 'cost-unknown' };
  if (incomplete) return { amount: null, reason: 'incomplete' };
  return { amount: text((revenue ?? 0n) - cost), reason: null };
}

export function disciplineProfit(
  rollup: ProjectRollup,
  revenue: ReadonlyArray<DisciplineRevenueRow> | 'restricted',
  basis: string = VALIDATED_PROGRESS,
): DisciplineProfit {
  if (revenue === 'restricted' || rollup.restricted) return { restricted: true, currencies: [] };
  const revRows = revenue.filter((r) => r.basis === basis);
  const keyOf = (id: string | null) => id ?? '';

  // Currencies per discipline: a discipline seen in two currencies is never blended.
  const seen = new Map<string, Set<string>>();
  const note = (id: string | null, currency: string) => {
    const set = seen.get(keyOf(id)) ?? new Set<string>();
    set.add(currency);
    seen.set(keyOf(id), set);
  };
  rollup.disciplines.forEach((d) => note(d.disciplineId, d.currency));
  revRows.forEach((r) => note(r.disciplineId, r.currency));

  const currencies = [...new Set([...rollup.disciplines.map((d) => d.currency), ...revRows.map((r) => r.currency)])].sort();
  const result: CurrencyProfit[] = currencies.map((currency) => {
    const ids = [...new Set([
      ...rollup.disciplines.filter((d) => d.currency === currency).map((d) => d.disciplineId),
      ...revRows.filter((r) => r.currency === currency).map((r) => r.disciplineId),
    ])].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));

    const rows: ProfitRow[] = ids.map((id) => {
      const cost = rollup.disciplines.find((d) => d.disciplineId === id && d.currency === currency);
      const rev = revRows.find((r) => r.disciplineId === id && r.currency === currency);
      const direct = cost ? moneyUnits(cost.direct) : 0n;
      const allocated = cost ? moneyUnits(cost.allocated) : 0n;
      const revenueUnits = rev ? moneyUnits(rev.revenue) : 0n;
      const incomplete = (rev?.unratedLines ?? 0) > 0;
      const mixed = (seen.get(keyOf(id))?.size ?? 0) > 1;
      return {
        key: `${currency}|${keyOf(id)}`, kind: 'discipline' as const, disciplineId: id, currency,
        revenue: text(revenueUnits), incomplete, direct: text(direct), allocated: text(allocated),
        marginBefore: figure(revenueUnits, incomplete, [direct], mixed),
        marginAfter: figure(revenueUnits, incomplete, [direct, allocated], mixed),
      };
    });

    // The project's own cost figure is the authority: cost no discipline row holds is shown as Not assigned.
    const projectTotal = moneyUnits(rollup.totals.find((t) => t.currency === currency)?.total ?? null);
    const rowCost = sum(rows.flatMap((r) => [moneyUnits(r.direct), moneyUnits(r.allocated)]));
    const unassignedCost = projectTotal !== null && rowCost !== null ? projectTotal - rowCost : null;
    if (unassignedCost !== null && unassignedCost !== 0n) {
      rows.push({
        key: `${currency}|unassigned`, kind: 'unassigned', disciplineId: null, currency, revenue: null, incomplete: false,
        direct: null, allocated: text(unassignedCost),
        marginBefore: { amount: null, reason: null }, marginAfter: { amount: null, reason: null },
      });
    }

    const disc = rows.filter((r) => r.kind === 'discipline');
    const totalRevenue = sum(disc.map((r) => moneyUnits(r.revenue)));
    const totalDirect = sum(disc.map((r) => moneyUnits(r.direct)));
    const totalShared = sum(rows.map((r) => moneyUnits(r.allocated)));
    const incomplete = disc.some((r) => r.incomplete);
    const mixed = disc.some((r) => r.marginAfter.reason === 'not-comparable');
    const total: ProfitRow = {
      key: `${currency}|total`, kind: 'total', disciplineId: null, currency,
      revenue: text(totalRevenue), incomplete, direct: text(totalDirect), allocated: text(totalShared),
      marginBefore: figure(totalRevenue, incomplete, [totalDirect], mixed),
      marginAfter: figure(totalRevenue, incomplete, [totalDirect, totalShared], mixed),
    };
    return { currency, rows, total };
  });
  return { restricted: false, currencies: result };
}
