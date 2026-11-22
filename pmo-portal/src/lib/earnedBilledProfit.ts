import { moneyText, moneyUnits, type ExactMoney } from './projectFinances';
import type { ProjectRollup } from './workOrderPlanVsActual';

/**
 * Earned and billed revenue side by side (#2733, docs/specs/earned-billed-revenue.spec.md). Pure join: cost comes from the
 * plan-versus-actual roll-up (never re-summed), revenue from two reads that already exist. Earned = validated progress at the
 * rate frozen at validation; billed = claims and invoices excluding tax. A figure that does not exist reads as such
 * (`not-available`, `incomplete`, `restricted`, `not-comparable`, `cost-unknown`), never as zero.
 */
export type FigureReason = 'restricted' | 'not-available' | 'incomplete' | 'not-comparable' | 'cost-unknown';
export interface Figure { amount: ExactMoney | null; reason: FigureReason | null }

/** One Issued or Closed work order, from `project_work_order_earned_billed` (earned is null with no validated line). */
export interface WorkOrderEarnedBilledRow {
  workOrderId: string;
  currency: string;
  earned: ExactMoney | null;
  earnedLines: number;
  unratedLines: number;
  billed: ExactMoney | null;
  billedComplete: boolean;
}

export interface EarnedBilledRow {
  key: string;
  workOrderId: string | null;
  currency: string;
  earned: Figure;
  billed: Figure;
  /** earned - billed: positive = work done and not yet billed. */
  gap: Figure;
  /** Margin after shared cost on each basis (the headline, as in profit per discipline). */
  marginEarned: Figure;
  marginBilled: Figure;
}

export interface EarnedBilledTotal extends EarnedBilledRow {
  /** Issued/Closed work orders in this currency, and how many have no validated progress. */
  workOrders: number;
  withoutProgress: number;
}

export interface CurrencyEarnedBilled { currency: string; rows: EarnedBilledRow[]; total: EarnedBilledTotal }
export interface EarnedBilledProfit { restricted: boolean; currencies: CurrencyEarnedBilled[] }

const ok = (units: bigint): Figure => ({ amount: moneyText(units), reason: null });
const no = (reason: FigureReason): Figure => ({ amount: null, reason });

function diff(a: Figure, b: Figure): Figure {
  if (a.reason) return no(a.reason);
  if (b.reason) return no(b.reason);
  const x = moneyUnits(a.amount); const y = moneyUnits(b.amount);
  return x === null || y === null ? no('not-available') : ok(x - y);
}

/** Margin = revenue - cost. A revenue that does not exist, or a cost that does not, is named, never a number. */
export function marginOn(revenue: Figure, cost: bigint | null, comparable: boolean): Figure {
  if (revenue.reason) return no(revenue.reason);
  if (!comparable) return no('not-comparable');
  const r = moneyUnits(revenue.amount);
  if (cost === null || r === null) return no('cost-unknown');
  return ok(r - cost);
}

function earnedFigure(row: Pick<WorkOrderEarnedBilledRow, 'earned' | 'earnedLines' | 'unratedLines'>): Figure {
  if (row.earnedLines === 0 || row.earned === null) return no('not-available');
  if (row.unratedLines > 0) return no('incomplete');
  return { amount: row.earned, reason: null };
}
const billedFigure = (row: Pick<WorkOrderEarnedBilledRow, 'billed' | 'billedComplete'>): Figure =>
  row.billed === null || !row.billedComplete ? no('not-available') : { amount: row.billed, reason: null };

function costOf(direct: ExactMoney | null, allocated: ExactMoney | null): bigint | null {
  const d = moneyUnits(direct); const a = moneyUnits(allocated);
  return d === null || a === null ? null : d + a;
}

/** What a project's earned figure is made of, whether it came from the per-work-order read or the pack read. */
export interface EarnedAggregate {
  earned: ExactMoney | null;
  unratedLines: number;
  workOrders: number;
  withoutProgress: number;
}

/**
 * Project total for one currency: cost is the roll-up's own project figure (`totals.total`, direct + allocated + not
 * assigned), billed is its revenue, so this equals the project tab. Earned is the sum only when EVERY work order has
 * validated progress; otherwise it reads `incomplete` (some) or `not-available` (none), with the count of those without.
 */
export function projectEarnedBilled(rollup: ProjectRollup, currency: string, agg: EarnedAggregate): EarnedBilledTotal {
  const t = rollup.totals.find((x) => x.currency === currency);
  const comparable = !rollup.workOrders.some((w) => w.currency === currency && w.otherCurrency.length > 0);
  let earned: Figure;
  if (agg.workOrders === 0 || agg.withoutProgress >= agg.workOrders) earned = no('not-available');
  else if (agg.withoutProgress > 0 || agg.unratedLines > 0 || agg.earned === null) earned = no('incomplete');
  else earned = { amount: agg.earned, reason: null };
  const billed: Figure = t?.revenue != null ? { amount: t.revenue, reason: null } : no('not-available');
  const cost = moneyUnits(t?.total ?? null);
  return {
    key: `${currency}|total`, workOrderId: null, currency, earned, billed, gap: diff(earned, billed),
    marginEarned: marginOn(earned, cost, comparable), marginBilled: marginOn(billed, cost, comparable),
    workOrders: agg.workOrders, withoutProgress: agg.withoutProgress,
  };
}

export function earnedBilledProfit(rollup: ProjectRollup, rows: ReadonlyArray<WorkOrderEarnedBilledRow> | 'restricted'): EarnedBilledProfit {
  if (rows === 'restricted' || rollup.restricted) return { restricted: true, currencies: [] };
  const currencies = [...new Set([...rows.map((r) => r.currency), ...rollup.totals.map((t) => t.currency)])].sort();
  return {
    restricted: false,
    currencies: currencies.filter((currency) => {
      // A currency the project has no work order, revenue or cost in (a default bucket) is not a panel of its own.
      const t = rollup.totals.find((x) => x.currency === currency);
      const nonZero = (v: ExactMoney | null | undefined) => v != null && moneyUnits(v) !== 0n;
      return rows.some((r) => r.currency === currency) || nonZero(t?.revenue) || nonZero(t?.total);
    }).map((currency) => {
      const mine = rows.filter((r) => r.currency === currency);
      const lines: EarnedBilledRow[] = mine.map((r) => {
        const fig = rollup.workOrders.find((w) => w.workOrderId === r.workOrderId);
        const earned = earnedFigure(r);
        const billed = billedFigure(r);
        const cost = fig ? costOf(fig.direct, fig.allocated) : null;
        const comparable = fig ? fig.otherCurrency.length === 0 : true;
        return {
          key: `${currency}|${r.workOrderId}`, workOrderId: r.workOrderId, currency, earned, billed, gap: diff(earned, billed),
          marginEarned: marginOn(earned, cost, comparable), marginBilled: marginOn(billed, cost, comparable),
        };
      });
      const earnedUnits = mine.every((r) => r.earnedLines > 0 && r.earned !== null)
        ? mine.reduce<bigint>((s, r) => s + (moneyUnits(r.earned) ?? 0n), 0n) : null;
      const total = projectEarnedBilled(rollup, currency, {
        earned: earnedUnits === null ? null : moneyText(earnedUnits),
        unratedLines: mine.reduce((s, r) => s + r.unratedLines, 0),
        workOrders: mine.length,
        withoutProgress: mine.filter((r) => r.earnedLines === 0).length,
      });
      return { currency, rows: lines, total };
    }),
  };
}
