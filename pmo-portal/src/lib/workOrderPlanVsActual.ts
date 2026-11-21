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
 *   • `counted`, `unassigned`, and `split-when-custom` lines carry project actuals; other rows give context only;
 *   • a counted line naming a work order is that work order's direct cost; one naming none is shared cost;
 *   • shared cost is allocated, or else stays "Not assigned" — never both, never dropped.
 * Margin delegates to `deriveMargin` (FR-GM-001: one margin formula).
 */

export type FinanceCostSource = CostSource | 'project_actuals' | 'purchase_balance' | 'other_revenue';
export type CostReason = 'counted' | 'commitment' | 'stocked' | 'transfer' | 'no-rate' | 'not-posted' | 'unassigned' | 'split-when-custom' | 'outside-basis' | 'unresolved-direct' | 'other-revenue';
export type PlanKind = 'direct_budget' | 'indirect_budget' | 'equipment_hours' | 'crew_hours';
export const PLAN_KINDS: readonly PlanKind[] = ['direct_budget', 'indirect_budget', 'equipment_hours', 'crew_hours'];
export const MONEY_PLAN_KINDS: readonly PlanKind[] = ['direct_budget', 'indirect_budget'];

/** One cost record with what it costs (null when not money, or when the amount cannot be read). */
export interface CostAmountLine {
  source: FinanceCostSource;
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
  /** Net order value is a billing ceiling, not revenue. */
  orderValue?: ExactMoney | null;
}

export interface PlanLine {
  id: string;
  workOrderId: string;
  disciplineId: string | null;
  /** #2576: the section the figure belongs to; null/absent = the unsectioned figure. A work order's plan is the sum of all of them. */
  sectionId?: string | null;
  kind: PlanKind;
  /** Money kinds: scale-two decimal in the work order's currency. Hour kinds: a decimal number of hours. */
  value: string;
  note: string | null;
}

export interface SplitPercent { workOrderId: string; percent: string }

// ── allocation ─────────────────────────────────────────────────────────────────────────────────────

/** Largest-remainder allocation in cents; ties use input order and a negative pool keeps its sign. */
export function apportion(total: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0) return [];
  const nonnegative = weights.map((weight) => weight > 0n ? weight : 0n);
  const sum = nonnegative.reduce((a, b) => a + b, 0n);
  if (sum === 0n) {
    if (total !== 0n) throw new RangeError('Cannot apportion without a positive weight');
    return weights.map(() => 0n);
  }
  const magnitude = total < 0n ? -total : total;
  const shares = nonnegative.map((weight, index) => ({ index, cents: magnitude * weight / sum, remainder: magnitude * weight % sum }));
  const left = magnitude - shares.reduce((value, share) => value + share.cents, 0n);
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; BigInt(i) < left; i++) ranked[i].cents += 1n;
  return shares.map((share) => total < 0n ? -share.cents : share.cents);
}

/** "0".."100" with up to 4 decimals → millionths of the whole (100% = 1 000 000). Anything else → null. */
export function parseSplitPercent(value: string): bigint | null {
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!m) return null;
  const units = BigInt(m[1]) * 10000n + BigInt((m[2] ?? '').padEnd(4, '0'));
  return units > 1000000n ? null : units;
}

/** The split editor's live sum in millionths of the whole, or null while any entry is unreadable. */
export function splitSum(values: readonly string[]): bigint | null {
  let total = 0n;
  for (const v of values) {
    const p = parseSplitPercent(v);
    if (p === null) return null;
    total += p;
  }
  return total;
}

/** A plan figure as typed: blank (no figure) or a non-negative number with up to 2 decimals (FR-WPVA-002). */
export function planValueProblem(raw: string): 'format' | null {
  const v = raw.trim();
  return v === '' || /^\d{1,15}(\.\d{1,2})?$/.test(v) ? null : 'format';
}

export interface AllocationInput { workOrderId: string; woNumber: string | null; direct: bigint; cancelled: boolean }
export interface AllocationResult {
  basis: 'direct-share' | 'custom' | 'none';
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

  const carrying = ordered.filter((w) => w.direct > 0n);
  if (carrying.length > 0) {
    assign(carrying, carrying.map((w) => w.direct));
    return { basis: 'direct-share', stale, allocations, unallocated: 0n };
  }
  return { basis: 'none', stale, allocations, unallocated: shared };
}

// ── roll-up ────────────────────────────────────────────────────────────────────────────────────────

export interface DisciplineFigures {
  disciplineId: string | null;
  direct: ExactMoney | null;
  allocated: ExactMoney | null;
  planDirect: ExactMoney | null;
  planIndirect: ExactMoney | null;
}

export interface WorkOrderFigures {
  workOrderId: string;
  currency: string;
  direct: ExactMoney | null;
  directBySource: Partial<Record<FinanceCostSource, ExactMoney>>;
  otherCurrency: Array<{ currency: string; amount: ExactMoney | null }>;
  allocated: ExactMoney | null;
  disciplines: DisciplineFigures[];
  revenue: ExactMoney | null;
  directMargin: Margin;
  result: Margin;
  equipmentHours: number;
  equipmentDays: number;
  /** Hours of Approved timesheet weeks only (FR-WPVA-012); a Draft, Submitted or Rejected week is never actual. */
  crewHours: number;
  crewSize: number;
  /** Timesheet hours on weeks not yet approved (Draft, Submitted or Rejected): named apart, never counted. */
  pendingCrewHours: number;
  /** Hours on the work order with no rate set: carried as hours, never in the money. */
  uncostedHours: number;
  plan: { direct_budget: ExactMoney | null; indirect_budget: ExactMoney | null; equipment_hours: number | null; crew_hours: number | null };
  lines: CostAmountLine[];
}

export interface CurrencyTotals { currency: string; planDirect: ExactMoney | null; planIndirect: ExactMoney | null; direct: ExactMoney | null; total: ExactMoney | null; notAssigned: ExactMoney | null; revenue: ExactMoney | null; otherRevenue: ExactMoney | null; hasOtherRevenue: boolean; directMargin: Margin; result: Margin }

export interface ProjectRollup {
  restricted: boolean;
  hours: { equipmentHours: number; equipmentDays: number; crewHours: number; crewSize: number; pendingCrewHours: number; planEquipmentHours: number | null; planCrewHours: number | null } | null;
  allocation: { basis: AllocationResult['basis']; stale: boolean; mixedCurrency: boolean; byCurrency: Array<{ currency: string; basis: AllocationResult['basis'] }> };
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
  /** Existing project billing buckets, including revenue not assigned to a work order. */
  projectRevenue?: ReadonlyArray<{ currency: string; work_revenue: ExactMoney | null; missing_work: number }> | null;
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
  const directRows = lines.filter((l) => l.reason === 'counted' || l.reason === 'unresolved-direct');
  const projectCosts = lines.filter((l) => l.reason === 'counted' || l.reason === 'unassigned' || l.reason === 'split-when-custom');
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
    // Draft/Submitted equipment usage and non-Approved timesheet weeks are not actual hours.
    const equip = woLines.filter((l) => l.source === 'equipment_usage' && l.reason !== 'not-posted');
    const timesheet = woLines.filter((l) => l.source === 'timesheet_entry');
    const crew = timesheet.filter((l) => l.reason !== 'not-posted');
    return {
      equipmentHours: sumHours(equip.filter((l) => l.quantityUnit === 'hours').map((l) => l.quantity ?? 0)),
      equipmentDays: sumHours(equip.filter((l) => l.quantityUnit === 'days').map((l) => l.quantity ?? 0)),
      crewHours: sumHours(crew.map((l) => l.quantity ?? 0)),
      crewSize: new Set(crew.filter((l) => (l.quantity ?? 0) > 0).map((l) => l.personId).filter(Boolean)).size,
      pendingCrewHours: sumHours(timesheet.filter((l) => l.reason === 'not-posted').map((l) => l.quantity ?? 0)),
      uncostedHours: sumHours(woLines.filter((l) => l.reason === 'no-rate' && l.quantityUnit === 'hours').map((l) => l.quantity ?? 0)),
    };
  };

  if (restricted) {
    return {
      restricted: true,
      hours: null,
      allocation: { basis: 'none', stale: false, mixedCurrency: false, byCurrency: [] },
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
    direct.set(w.id, sumOrNull(directRows.filter((l) => l.workOrderId === w.id && l.currency === w.currency).map(cents)));
  }

  // Shared pools per currency (FR-WPVA-014: never blended).
  const shared = counted.filter((l) => l.workOrderId === null || !workOrders.some((w) => w.id === l.workOrderId));
  const currencies = [...new Set([...projectCosts.map((l) => l.currency ?? '?'), ...workOrders.map((w) => w.currency), ...(input.projectRevenue ?? []).map((b) => b.currency)])].sort();
  const woCurrencies = new Set(workOrders.map((w) => w.currency));
  const mixedCurrency = woCurrencies.size > 1;

  const allocated = new Map<string, bigint | null>();
  const notAssigned = new Map<string, bigint | null>();
  let basis: AllocationResult['basis'] = 'none';
  const byCurrency: Array<{ currency: string; basis: AllocationResult['basis'] }> = [];
  let stale = false;
  for (const cur of currencies) {
    const targets = workOrders.filter((w) => w.currency === cur);
    const candidates = targets.map((w) => ({ workOrderId: w.id, woNumber: w.woNumber, direct: direct.get(w.id) ?? 0n, cancelled: w.status === 'Cancelled' }));
    const splitCheck = allocateShared(candidates, 0n, split);
    const eligibleCustom = !mixedCurrency && splitCheck.basis === 'custom';
    if (targets.length > 0 && split?.length) stale = stale || mixedCurrency || splitCheck.stale;
    const conditional = projectCosts.filter((l) => l.reason === 'split-when-custom' && (l.currency ?? '?') === cur);
    const held = projectCosts.filter((l) => l.reason === 'unassigned' && (l.currency ?? '?') === cur)
      .concat(eligibleCustom ? [] : conditional);
    const heldTotal = sumOrNull(held.map(cents));
    const pool = sumOrNull(shared.filter((l) => (l.currency ?? '?') === cur).concat(eligibleCustom ? conditional : []).map(cents));
    if (heldTotal === null) {
      targets.forEach((w) => allocated.set(w.id, null));
      notAssigned.set(cur, null);
      continue;
    }
    if (pool === null) {
      targets.forEach((w) => allocated.set(w.id, null));
      notAssigned.set(cur, targets.length === 0 ? null : heldTotal);
      continue;
    }
    if (targets.some((w) => direct.get(w.id) === null)) {
      // An unknown direct cost makes every share in this pool unknown — never a share computed from a partial weight.
      targets.forEach((w) => allocated.set(w.id, null));
      notAssigned.set(cur, heldTotal);
      continue;
    }
    const r = allocateShared(
      targets.map((w) => ({ workOrderId: w.id, woNumber: w.woNumber, direct: direct.get(w.id) as bigint, cancelled: w.status === 'Cancelled' })),
      pool,
      mixedCurrency ? null : split,
    );
    targets.forEach((w) => allocated.set(w.id, r.allocations.get(w.id) ?? 0n));
    notAssigned.set(cur, heldTotal === null ? null : heldTotal + r.unallocated);
    if (targets.length > 0) { byCurrency.push({ currency: cur, basis: r.basis }); basis = r.basis; stale = stale || r.stale || (mixedCurrency && Boolean(split?.length)); }
  }

  const projectDisciplines = new Map<string, { disciplineId: string | null; currency: string; direct: bigint | null; allocated: bigint | null; planDirect: bigint | null; planIndirect: bigint | null }>();
  const addProjectDiscipline = (disciplineId: string | null, currency: string, d: bigint | null, a: bigint | null, pd: bigint | null, pi: bigint | null) => {
    const key = `${currency}|${disciplineId ?? ''}`;
    const cur = projectDisciplines.get(key) ?? { disciplineId, currency, direct: 0n, allocated: 0n, planDirect: null, planIndirect: null };
    cur.direct = cur.direct === null || d === null ? null : cur.direct + d;
    cur.allocated = cur.allocated === null || a === null ? null : cur.allocated + a;
    if (pd !== null) cur.planDirect = (cur.planDirect ?? 0n) + pd;
    if (pi !== null) cur.planIndirect = (cur.planIndirect ?? 0n) + pi;
    projectDisciplines.set(key, cur);
  };

  const figures: WorkOrderFigures[] = workOrders.map((w) => {
    const woLines = lines.filter((l) => l.workOrderId === w.id);
    const own = directRows.filter((l) => l.workOrderId === w.id && l.currency === w.currency);
    const others = directRows.filter((l) => l.workOrderId === w.id && l.currency !== w.currency);
    const d = direct.get(w.id) ?? null;
    const a = allocated.has(w.id) ? allocated.get(w.id)! : 0n;

    const directBySource: Partial<Record<FinanceCostSource, ExactMoney>> = {};
    for (const source of [...new Set(own.map((l) => l.source))]) {
      const s = sumOrNull(own.filter((l) => l.source === source).map(cents));
      if (s !== null) directBySource[source] = moneyText(s);
    }

    const otherCurrency = [...new Set(others.map((l) => l.currency ?? '?'))].sort().map((currency) => ({
      currency, amount: text(sumOrNull(others.filter((l) => (l.currency ?? '?') === currency).map(cents))),
    }));

    // Disciplines: direct per discipline; the allocation split by each discipline's share of direct (FR-WPVA-031).
    const ids = [...new Set([...own.map((l) => l.disciplineId), ...plans.filter((p) => p.workOrderId === w.id && p.disciplineId !== null && MONEY_PLAN_KINDS.includes(p.kind)).map((p) => p.disciplineId)])].sort((x, y) => (x === null ? 1 : y === null ? -1 : x.localeCompare(y)));
    const dDirect = ids.map((id) => sumOrNull(own.filter((l) => l.disciplineId === id).map(cents)));
    let dAlloc: Array<bigint | null>;
    if (a === null || dDirect.some((v) => v === null)) dAlloc = ids.map(() => null);
    else if (ids.length === 0 || (d ?? 0n) <= 0n) dAlloc = ids.map(() => 0n);
    else dAlloc = apportion(a, dDirect as bigint[]);
    const disciplinePlan = (id: string | null, kind: PlanKind) => {
      if (id === null) return null; // Work-order-wide plans do not name a discipline.
      const matching = plans.filter((p) => p.workOrderId === w.id && p.disciplineId === id && p.kind === kind);
      return matching.length ? text(sumOrNull(matching.map((p) => moneyUnits(p.value)))) : null;
    };
    const disciplines: DisciplineFigures[] = ids.map((id, i) => ({ disciplineId: id, direct: text(dDirect[i]), allocated: text(dAlloc[i]),
      planDirect: disciplinePlan(id, 'direct_budget'), planIndirect: disciplinePlan(id, 'indirect_budget') }));
    if (a !== null && a !== 0n && (ids.length === 0 || (d ?? 0n) <= 0n)) {
      // No direct cost to weigh by: the allocation rolls under "No discipline".
      const none = disciplines.find((x) => x.disciplineId === null);
      if (none) none.allocated = moneyText(a);
      else disciplines.push({ disciplineId: null, direct: '0.00', allocated: moneyText(a), planDirect: null, planIndirect: null });
    }
    disciplines.forEach((x) => addProjectDiscipline(x.disciplineId, w.currency, moneyUnits(x.direct), moneyUnits(x.allocated), moneyUnits(x.planDirect), moneyUnits(x.planIndirect)));

    const comparable = others.length === 0;
    const directMargin = marginOf(w.currency, w.revenue, w.revenueComplete, d, comparable);
    const result = marginOf(w.currency, w.revenue, w.revenueComplete, d === null || a === null ? null : d + a, comparable);

    return {
      workOrderId: w.id, currency: w.currency, direct: text(d), directBySource, otherCurrency, allocated: text(a),
      disciplines, revenue: w.revenue, directMargin, result, ...hourFigures(woLines), plan: planFor(w.id), lines: woLines,
    };
  });

  const totals: CurrencyTotals[] = currencies.map((currency) => {
    const total = sumOrNull(projectCosts.filter((l) => (l.currency ?? '?') === currency).map(cents));
    const directCost = sumOrNull(directRows.filter((l) => l.workOrderId !== null && (l.currency ?? '?') === currency).map(cents));
    const planSum = (kind: 'direct_budget' | 'indirect_budget') => {
      const values = figures.filter((f) => f.currency === currency).map((f) => f.plan[kind]).filter((v) => v !== null);
      return values.length ? text(sumOrNull(values.map(moneyUnits))) : null;
    };
    const bucket = input.projectRevenue?.find((b) => b.currency === currency);
    const revenue = bucket ? bucket.work_revenue : input.projectRevenue != null ? '0.00' : null;
    const complete = input.projectRevenue != null && revenue !== null && (bucket?.missing_work ?? 0) === 0;
    return { currency, planDirect: planSum('direct_budget'), planIndirect: planSum('indirect_budget'), direct: text(directCost), total: text(total), notAssigned: text(notAssigned.get(currency) ?? null), revenue: complete ? revenue : null,
      otherRevenue: text(sumOrNull(lines.filter((l) => l.reason === 'other-revenue' && l.currency === currency).map(cents))),
      hasOtherRevenue: lines.some((l) => l.reason === 'other-revenue' && l.currency === currency),
      directMargin: marginOf(currency, revenue, complete, directCost, true),
      result: marginOf(currency, revenue, complete, total, true) };
  });

  const projectPlanHours = (kind: PlanKind) => {
    const matching = plans.filter((p) => p.kind === kind);
    return matching.length ? sumHours(matching.map((p) => Number(p.value))) : null;
  };
  return {
    restricted: false,
    hours: { ...hourFigures([...lines]), planEquipmentHours: projectPlanHours('equipment_hours'), planCrewHours: projectPlanHours('crew_hours') },
    allocation: { basis, stale, mixedCurrency, byCurrency },
    workOrders: figures,
    disciplines: [...projectDisciplines.values()].map((x) => ({ disciplineId: x.disciplineId, currency: x.currency, direct: text(x.direct), allocated: text(x.allocated), planDirect: text(x.planDirect), planIndirect: text(x.planIndirect) })),
    totals,
    sharedLines: lines.filter((l) => l.workOrderId === null && l.reason !== 'other-revenue'),
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
