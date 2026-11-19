import { deriveMargin, moneyText, moneyUnits, type ExactMoney, type Margin } from './projectFinances';
import type { CostSource } from './db/workOrderCosts';

/**
 * Plan versus actual and profit per work order (#2519, spec docs/specs/work-order-plan-vs-actual.spec.md).
 *
 * Pure: no I/O. Every money figure on the plan-vs-actual screens flows through `rollupProject`, so the Layer-1
 * tests bind to the same code the screens render. Money is integer cents (bigint) end to end; amounts arrive as
 * exact scale-two strings from `work_order_cost_amounts` (migration 0999).
 *
 * The rules that keep every cost counted exactly once (FR-WPVA-032):
 *   • only lines whose `reason` is `counted` carry cost — a purchase request/order/receipt is a commitment or a
 *     receipt of the same money its vendor bill carries, a bill for stocked goods is counted when the stock is
 *     issued, a transfer moves stock still on hand (the database decides the reason; this module never sums the others);
 *   • a counted line naming a work order is that work order's direct cost; one naming none is shared cost;
 *   • shared cost is allocated, or else stays "Not assigned" — never both, never dropped.
 * Margin delegates to `deriveMargin` (FR-GM-001: one margin formula).
 */

export type CostReason = 'counted' | 'commitment' | 'stocked' | 'transfer' | 'no-rate' | 'not-posted';
export type PlanKind = 'direct_budget' | 'indirect_budget' | 'equipment_hours' | 'crew_hours';
export const PLAN_KINDS: readonly PlanKind[] = ['direct_budget', 'indirect_budget', 'equipment_hours', 'crew_hours'];
export const MONEY_PLAN_KINDS: readonly PlanKind[] = ['direct_budget', 'indirect_budget'];

/** One cost record with what it costs (null when not money, or when the amount cannot be read). */
export interface CostAmountLine {
  source: CostSource;
  recordId: string;
  projectId: string | null;
  workOrderId: string | null;
  disciplineId: string | null;
  occurredOn: string | null;
  reference: string | null;
  currency: string | null;
  amount: ExactMoney | null;
  reason: CostReason;
  quantity: number | null;
  quantityUnit: string | null;
  /** Timesheet lines only: whose hours they are (crew size is a count of distinct people). */
  personId: string | null;
}

export interface PvaWorkOrder {
  id: string;
  woNumber: string | null;
  title: string;
  status: 'Draft' | 'Issued' | 'Closed' | 'Cancelled';
  currency: string;
  /** Billed work revenue excl. tax, in `currency` (the shipped per-work-order billing derivation). */
  revenue: ExactMoney | null;
  revenueComplete: boolean;
}

export interface PlanLine {
  id: string;
  workOrderId: string;
  disciplineId: string | null;
  kind: PlanKind;
  /** Money kinds: scale-two decimal in the work order's currency. Hour kinds: a decimal number of hours. */
  value: string;
  note: string | null;
}

export interface SplitPercent { workOrderId: string; percent: string }

// ── allocation ─────────────────────────────────────────────────────────────────────────────────────

/** Rational rounding, half away from zero. */
function divRound(n: bigint, d: bigint): bigint {
  if (d === 0n) return 0n;
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
}

/**
 * Split `total` cents over `weights` in the order given: each share rounds to cents, the last takes the remainder,
 * so the shares always sum exactly to the total (FR-WPVA-023, as FR-CAT-022).
 */
export function apportion(total: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0n);
  const out: bigint[] = [];
  let given = 0n;
  weights.forEach((w, i) => {
    if (i === weights.length - 1) { out.push(total - given); return; }
    const share = divRound(total * w, sum);
    out.push(share);
    given += share;
  });
  return out;
}

/** "0".."100" with up to 4 decimals → millionths of the whole (100% = 1 000 000). Anything else → null. */
export function parseSplitPercent(value: string): bigint | null {
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!m) return null;
  const units = BigInt(m[1]) * 10000n + BigInt((m[2] ?? '').padEnd(4, '0'));
  return units > 1000000n ? null : units;
}

export interface AllocationInput { workOrderId: string; woNumber: string | null; direct: bigint; cancelled: boolean }
export interface AllocationResult {
  basis: 'direct-share' | 'equal-split' | 'custom' | 'none';
  /** A saved custom split exists but no longer fits the project's work orders (or does not sum to 100). */
  stale: boolean;
  allocations: Map<string, bigint>;
  unallocated: bigint;
}

const byNumber = (a: AllocationInput, b: AllocationInput) =>
  (a.woNumber ?? '').localeCompare(b.woNumber ?? '', undefined, { numeric: true }) || a.workOrderId.localeCompare(b.workOrderId);

/** FR-WPVA-020..024: one project's shared cost over its work orders (all in one currency). */
export function allocateShared(workOrders: readonly AllocationInput[], shared: bigint, split: readonly SplitPercent[] | null): AllocationResult {
  const ordered = [...workOrders].sort(byNumber);
  const live = ordered.filter((w) => !w.cancelled);
  const allocations = new Map<string, bigint>();
  const assign = (targets: AllocationInput[], weights: bigint[]) =>
    apportion(shared, weights).forEach((amount, i) => allocations.set(targets[i].workOrderId, amount));

  let stale = false;
  if (split && split.length > 0) {
    const percents = new Map(split.map((s) => [s.workOrderId, parseSplitPercent(s.percent)]));
    const sum = [...percents.values()].reduce<bigint | null>((t, p) => (t === null || p === null ? null : t + p), 0n);
    const fits = sum === 1000000n && percents.size === live.length && live.every((w) => percents.has(w.workOrderId));
    if (fits) {
      assign(live, live.map((w) => percents.get(w.workOrderId) as bigint));
      return { basis: 'custom', stale: false, allocations, unallocated: 0n };
    }
    stale = true;
  }

  const carrying = ordered.filter((w) => w.direct !== 0n);
  const directSum = carrying.reduce((t, w) => t + w.direct, 0n);
  if (carrying.length > 0 && directSum > 0n) {
    assign(carrying, carrying.map((w) => w.direct));
    return { basis: 'direct-share', stale, allocations, unallocated: 0n };
  }
  if (live.length > 0) {
    assign(live, live.map(() => 1n));
    return { basis: 'equal-split', stale, allocations, unallocated: 0n };
  }
  return { basis: 'none', stale, allocations, unallocated: shared };
}

// ── roll-up ────────────────────────────────────────────────────────────────────────────────────────

export interface DisciplineFigures {
  disciplineId: string | null;
  direct: ExactMoney | null;
  allocated: ExactMoney | null;
}

export interface WorkOrderFigures {
  workOrderId: string;
  currency: string;
  direct: ExactMoney | null;
  directBySource: Partial<Record<CostSource, ExactMoney>>;
  otherCurrency: Array<{ currency: string; amount: ExactMoney | null }>;
  allocated: ExactMoney | null;
  disciplines: DisciplineFigures[];
  revenue: ExactMoney | null;
  directMargin: Margin;
  result: Margin;
  equipmentHours: number;
  equipmentDays: number;
  crewHours: number;
  crewSize: number;
  /** Hours on the work order with no rate set: carried as hours, never in the money. */
  uncostedHours: number;
  plan: { direct_budget: ExactMoney | null; indirect_budget: ExactMoney | null; equipment_hours: number | null; crew_hours: number | null };
  lines: CostAmountLine[];
}

export interface CurrencyTotals { currency: string; total: ExactMoney | null; notAssigned: ExactMoney | null }

export interface ProjectRollup {
  restricted: boolean;
  allocation: { basis: AllocationResult['basis']; stale: boolean; mixedCurrency: boolean };
  workOrders: WorkOrderFigures[];
  /** Project-level discipline roll-up (FR-WPVA-031): direct + allocated per discipline, in the shared currency. */
  disciplines: Array<DisciplineFigures & { currency: string }>;
  totals: CurrencyTotals[];
  /** Shared lines — the basis of every allocation. */
  sharedLines: CostAmountLine[];
}

export interface RollupInput {
  workOrders: readonly PvaWorkOrder[];
  lines: readonly CostAmountLine[];
  plans: readonly PlanLine[];
  split: readonly SplitPercent[] | null;
  /** The caller may not read a source's money (FR-WPVA-013): every money figure is restricted. */
  restricted: boolean;
}

const text = (c: bigint | null): ExactMoney | null => (c === null ? null : moneyText(c));
const RESTRICTED: Margin = { amount: null, reason: 'restricted-rows' };

/** A sum that turns unknown (null) as soon as one term is unknown — never a partial number. */
function sumOrNull(values: ReadonlyArray<bigint | null>): bigint | null {
  let t = 0n;
  for (const v of values) { if (v === null) return null; t += v; }
  return t;
}

function marginOf(currency: string, revenue: ExactMoney | null, revenueComplete: boolean, cost: bigint | null, comparable: boolean): Margin {
  return deriveMargin(
    { currency, invoice_count: 0, invoiced: null, settled: null, outstanding: null, missing_amount: 0, missing_outstanding: 0,
      tax_basis: 'exclusive', work_revenue: revenueComplete ? revenue : null, missing_work: revenueComplete ? 0 : 1 },
    {
      // Cost in another currency on the work order makes it not comparable: deriveMargin's different-currencies rule.
      currency: comparable ? currency : `${currency}*`,
      as_of: null,
      total: text(cost),
      excludes_restricted_rows: false,
      categories: [{ category: 'work-order', mapped: true, amount: text(cost) }],
    },
  );
}

function sumHours(values: number[]): number {
  return Math.round(values.reduce((t, v) => t + v, 0) * 10000) / 10000;
}

export function rollupProject(input: RollupInput): ProjectRollup {
  const { workOrders, lines, plans, split, restricted } = input;
  const counted = lines.filter((l) => l.reason === 'counted');
  const cents = (l: CostAmountLine) => moneyUnits(l.amount);

  const planFor = (woId: string): WorkOrderFigures['plan'] => {
    const own = plans.filter((p) => p.workOrderId === woId);
    const money = (kind: PlanKind) => {
      const rows = own.filter((p) => p.kind === kind);
      return rows.length === 0 ? null : text(sumOrNull(rows.map((p) => moneyUnits(p.value))));
    };
    const hours = (kind: PlanKind) => {
      const rows = own.filter((p) => p.kind === kind);
      return rows.length === 0 ? null : sumHours(rows.map((p) => Number(p.value)));
    };
    return { direct_budget: money('direct_budget'), indirect_budget: money('indirect_budget'), equipment_hours: hours('equipment_hours'), crew_hours: hours('crew_hours') };
  };

  const hourFigures = (woLines: CostAmountLine[]) => {
    const equip = woLines.filter((l) => l.source === 'equipment_usage');
    const crew = woLines.filter((l) => l.source === 'timesheet_entry');
    return {
      equipmentHours: sumHours(equip.filter((l) => l.quantityUnit === 'hours').map((l) => l.quantity ?? 0)),
      equipmentDays: sumHours(equip.filter((l) => l.quantityUnit === 'days').map((l) => l.quantity ?? 0)),
      crewHours: sumHours(crew.map((l) => l.quantity ?? 0)),
      crewSize: new Set(crew.map((l) => l.personId).filter(Boolean)).size,
      uncostedHours: sumHours(woLines.filter((l) => l.reason === 'no-rate' && l.quantityUnit === 'hours').map((l) => l.quantity ?? 0)),
    };
  };

  if (restricted) {
    return {
      restricted: true,
      allocation: { basis: 'none', stale: false, mixedCurrency: false },
      workOrders: workOrders.map((w) => {
        const woLines = lines.filter((l) => l.workOrderId === w.id);
        return {
          workOrderId: w.id, currency: w.currency, direct: null, directBySource: {}, otherCurrency: [], allocated: null,
          disciplines: [], revenue: w.revenue, directMargin: RESTRICTED, result: RESTRICTED, ...hourFigures(woLines),
          plan: planFor(w.id), lines: woLines,
        };
      }),
      disciplines: [],
      totals: [],
      sharedLines: [],
    };
  }

  // Direct cost per work order, in its own currency; anything else on it is listed apart.
  const direct = new Map<string, bigint | null>();
  for (const w of workOrders) {
    direct.set(w.id, sumOrNull(counted.filter((l) => l.workOrderId === w.id && l.currency === w.currency).map(cents)));
  }

  // Shared pools per currency (FR-WPVA-014: never blended).
  const shared = counted.filter((l) => l.workOrderId === null || !workOrders.some((w) => w.id === l.workOrderId));
  const currencies = [...new Set(counted.map((l) => l.currency ?? '?'))].sort();
  const woCurrencies = new Set(workOrders.map((w) => w.currency));
  const mixedCurrency = woCurrencies.size > 1;

  const allocated = new Map<string, bigint | null>();
  const notAssigned = new Map<string, bigint | null>();
  let basis: AllocationResult['basis'] = 'none';
  let stale = false;
  for (const cur of currencies) {
    const pool = sumOrNull(shared.filter((l) => (l.currency ?? '?') === cur).map(cents));
    const targets = workOrders.filter((w) => w.currency === cur);
    if (pool === null) {
      targets.forEach((w) => allocated.set(w.id, null));
      notAssigned.set(cur, targets.length === 0 ? null : 0n);
      continue;
    }
    if (targets.some((w) => direct.get(w.id) === null)) {
      // An unknown direct cost makes every share in this pool unknown — never a share computed from a partial weight.
      targets.forEach((w) => allocated.set(w.id, null));
      notAssigned.set(cur, 0n);
      continue;
    }
    const r = allocateShared(
      targets.map((w) => ({ workOrderId: w.id, woNumber: w.woNumber, direct: direct.get(w.id) as bigint, cancelled: w.status === 'Cancelled' })),
      pool,
      mixedCurrency ? null : split,
    );
    targets.forEach((w) => allocated.set(w.id, r.allocations.get(w.id) ?? 0n));
    notAssigned.set(cur, r.unallocated);
    if (targets.length > 0) { basis = r.basis; stale = stale || r.stale || (mixedCurrency && Boolean(split?.length)); }
  }

  const projectDisciplines = new Map<string, { disciplineId: string | null; currency: string; direct: bigint | null; allocated: bigint | null }>();
  const addProjectDiscipline = (disciplineId: string | null, currency: string, d: bigint | null, a: bigint | null) => {
    const key = `${currency}|${disciplineId ?? ''}`;
    const cur = projectDisciplines.get(key) ?? { disciplineId, currency, direct: 0n, allocated: 0n };
    cur.direct = cur.direct === null || d === null ? null : cur.direct + d;
    cur.allocated = cur.allocated === null || a === null ? null : cur.allocated + a;
    projectDisciplines.set(key, cur);
  };

  const figures: WorkOrderFigures[] = workOrders.map((w) => {
    const woLines = lines.filter((l) => l.workOrderId === w.id);
    const own = counted.filter((l) => l.workOrderId === w.id && l.currency === w.currency);
    const others = counted.filter((l) => l.workOrderId === w.id && l.currency !== w.currency);
    const d = direct.get(w.id) ?? null;
    const a = allocated.get(w.id) ?? 0n;

    const directBySource: Partial<Record<CostSource, ExactMoney>> = {};
    for (const source of [...new Set(own.map((l) => l.source))]) {
      const s = sumOrNull(own.filter((l) => l.source === source).map(cents));
      if (s !== null) directBySource[source] = moneyText(s);
    }

    const otherCurrency = [...new Set(others.map((l) => l.currency ?? '?'))].sort().map((currency) => ({
      currency, amount: text(sumOrNull(others.filter((l) => (l.currency ?? '?') === currency).map(cents))),
    }));

    // Disciplines: direct per discipline; the allocation split by each discipline's share of direct (FR-WPVA-031).
    const ids = [...new Set(own.map((l) => l.disciplineId))].sort((x, y) => (x === null ? 1 : y === null ? -1 : x.localeCompare(y)));
    const dDirect = ids.map((id) => sumOrNull(own.filter((l) => l.disciplineId === id).map(cents)));
    let dAlloc: Array<bigint | null>;
    if (a === null || dDirect.some((v) => v === null)) dAlloc = ids.map(() => null);
    else if (ids.length === 0 || (d ?? 0n) <= 0n) dAlloc = ids.map(() => 0n);
    else dAlloc = apportion(a, dDirect as bigint[]);
    const disciplines: DisciplineFigures[] = ids.map((id, i) => ({ disciplineId: id, direct: text(dDirect[i]), allocated: text(dAlloc[i]) }));
    if (a !== null && a !== 0n && (ids.length === 0 || (d ?? 0n) <= 0n)) {
      // No direct cost to weigh by: the allocation rolls under "No discipline".
      const none = disciplines.find((x) => x.disciplineId === null);
      if (none) none.allocated = moneyText(a);
      else disciplines.push({ disciplineId: null, direct: '0.00', allocated: moneyText(a) });
    }
    disciplines.forEach((x) => addProjectDiscipline(x.disciplineId, w.currency, moneyUnits(x.direct), moneyUnits(x.allocated)));

    const comparable = others.length === 0;
    const directMargin = marginOf(w.currency, w.revenue, w.revenueComplete, d, comparable);
    const result = marginOf(w.currency, w.revenue, w.revenueComplete, d === null || a === null ? null : d + a, comparable);

    return {
      workOrderId: w.id, currency: w.currency, direct: text(d), directBySource, otherCurrency, allocated: text(a),
      disciplines, revenue: w.revenue, directMargin, result, ...hourFigures(woLines), plan: planFor(w.id), lines: woLines,
    };
  });

  const totals: CurrencyTotals[] = currencies.map((currency) => ({
    currency,
    total: text(sumOrNull(counted.filter((l) => (l.currency ?? '?') === currency).map(cents))),
    notAssigned: text(notAssigned.get(currency) ?? null),
  }));

  return {
    restricted: false,
    allocation: { basis, stale, mixedCurrency },
    workOrders: figures,
    disciplines: [...projectDisciplines.values()].map((x) => ({ disciplineId: x.disciplineId, currency: x.currency, direct: text(x.direct), allocated: text(x.allocated) })),
    totals,
    sharedLines: lines.filter((l) => l.workOrderId === null),
  };
}

// ── plan vs actual ─────────────────────────────────────────────────────────────────────────────────

export type Variance = { state: 'over' | 'within'; by: ExactMoney } | { state: 'no-plan' | 'unknown'; by: null };

/** FR-WPVA-041: how an actual stands against its plan, as words the screen can say (never colour only). */
export function planVariance(plan: ExactMoney | null, actual: ExactMoney | null): Variance {
  const p = moneyUnits(plan);
  if (p === null) return { state: 'no-plan', by: null };
  const a = moneyUnits(actual);
  if (a === null) return { state: 'unknown', by: null };
  return a > p ? { state: 'over', by: moneyText(a - p) } : { state: 'within', by: moneyText(p - a) };
}

export type HoursVariance = { state: 'over' | 'within'; by: number } | { state: 'no-plan'; by: null };
export function hoursVariance(plan: number | null, actual: number): HoursVariance {
  if (plan === null) return { state: 'no-plan', by: null };
  const by = Math.round(Math.abs(actual - plan) * 10000) / 10000;
  return actual > plan ? { state: 'over', by } : { state: 'within', by };
}
