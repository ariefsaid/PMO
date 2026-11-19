import { COST_SOURCES, type CostSource, type WorkOrderCostLine } from '@/src/lib/db/workOrderCosts';

/**
 * The Costs section's view model (#2518, AC-WORP-006/007): the #2517 cost lines grouped by source, then discipline.
 * Money is never on the cost-line view; it comes per source from that source's own read (`moneyBySource`):
 *   - key absent  → this version reads no money for the source (quantities only, no note);
 *   - `null`      → the read was refused / empty: the caller cannot read it (restricted, total omitted — never 0);
 *   - a record map → totals are the exact sum of the rows; a record missing from the map, or mixed currencies, omits the total.
 */
export const NO_DISCIPLINE = '__none__';

export interface CostMoney { amount: number; currency: string }
export type MoneyBySource = Partial<Record<CostSource, Record<string, CostMoney> | null>>;

export interface DisciplineGroup { disciplineId: string; lines: WorkOrderCostLine[]; total: CostMoney | null; totals: CostMoney[] }
export interface SourceGroup { source: CostSource; lines: WorkOrderCostLine[]; disciplines: DisciplineGroup[]; total: CostMoney | null; totals: CostMoney[]; restricted: boolean }

function sum(lines: WorkOrderCostLine[], money: Record<string, CostMoney>): CostMoney | null {
  let amount = 0;
  let currency: string | null = null;
  for (const l of lines) {
    const m = money[l.recordId];
    if (!m || !Number.isFinite(m.amount)) return null;
    if (currency && currency !== m.currency) return null;
    currency = m.currency;
    amount += m.amount;
  }
  return currency ? { amount: Math.round(amount * 100) / 100, currency } : null;
}

function sums(lines: WorkOrderCostLine[], money: Record<string, CostMoney>): CostMoney[] {
  const byCurrency = new Map<string, WorkOrderCostLine[]>();
  for (const line of lines) {
    const value = money[line.recordId];
    if (!value || !Number.isFinite(value.amount)) return [];
    byCurrency.set(value.currency, [...(byCurrency.get(value.currency) ?? []), line]);
  }
  return [...byCurrency.keys()].sort().map((currency) => sum(byCurrency.get(currency)!, money)!);
}

export function buildCostView(lines: readonly WorkOrderCostLine[], moneyBySource: MoneyBySource): SourceGroup[] {
  const out: SourceGroup[] = [];
  for (const source of COST_SOURCES) {
    const own = lines.filter((l) => l.source === source);
    if (own.length === 0) continue;
    const money = moneyBySource[source];
    const readable = money && typeof money === 'object' ? money : null;
    const byDiscipline = new Map<string, WorkOrderCostLine[]>();
    for (const l of own) {
      const key = l.disciplineId ?? NO_DISCIPLINE;
      byDiscipline.set(key, [...(byDiscipline.get(key) ?? []), l]);
    }
    const disciplines = [...byDiscipline.entries()]
      .sort(([a], [b]) => (a === NO_DISCIPLINE ? 1 : b === NO_DISCIPLINE ? -1 : a.localeCompare(b)))
      .map(([disciplineId, ls]) => ({ disciplineId, lines: ls, total: readable ? sum(ls, readable) : null, totals: readable ? sums(ls, readable) : [] }));
    out.push({ source, lines: own, disciplines, total: readable ? sum(own, readable) : null, totals: readable ? sums(own, readable) : [], restricted: money === null });
  }
  return out;
}
