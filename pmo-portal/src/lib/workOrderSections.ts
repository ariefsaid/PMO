/**
 * workOrderSections.ts (#2576) — the pure arithmetic and shape behind a work order's sections. No I/O.
 *
 * Quantities and money are exact decimals held as integer units (BigInt) at a fixed scale, never floats; parsing and
 * formatting come from the one decimal module (`exactDecimal`, #2748) and a figure is rounded only for display
 * (NFR-WOS-003). The roll-up invariant (spec): for every measure, sum(sections) + the unsectioned remainder = the
 * work-order total, exactly. The server read (`work_order_section_rollup`, 1098) is the source of every figure the
 * screen shows; this module only restates it in the shapes the screen needs and is the unit proof of the invariant.
 */

import { formatDecimal, parseDecimal } from './exactDecimal';

export interface SectionFigure {
  /** null = the unsectioned remainder ("Not in a section"). */
  sectionId: string | null;
  /** The measure as the server returned it; null = no figure (never read as zero). */
  value: string | null;
}

export interface MeasureRollup {
  /** One entry per section, in input order, carrying its exact figure (null = none). */
  sections: Array<{ sectionId: string; value: string | null }>;
  /** The unsectioned remainder; '0.00' when no record is unsectioned. */
  remainder: string;
  /** sum(sections) + remainder. */
  total: string;
  /** True when no row carried a figure at all. */
  empty: boolean;
}

/**
 * Roll a measure up over sections plus the unsectioned remainder. A malformed figure throws: a silent zero would
 * break the invariant without anyone noticing.
 */
export function rollupBySection(rows: readonly SectionFigure[], scale = 2): MeasureRollup {
  let remainder = 0n;
  let total = 0n;
  let any = false;
  const sections: MeasureRollup['sections'] = [];
  for (const row of rows) {
    if (row.value !== null) {
      const units = parseDecimal(row.value, scale);
      if (units === null) throw new Error(`rollupBySection: unreadable figure "${row.value}"`);
      total += units;
      any = true;
      if (row.sectionId === null) remainder += units;
    }
    if (row.sectionId !== null) sections.push({ sectionId: row.sectionId, value: row.value === null ? null : formatDecimal(parseDecimal(row.value, scale) as bigint, scale) });
  }
  return { sections, remainder: formatDecimal(remainder, scale), total: formatDecimal(total, scale), empty: !any };
}

export interface UnitQuantity { unit: string; quantity: string }

/**
 * Validated daily-report quantity per section, summed by unit (a quantity of metres and one of cubic metres never add).
 * The key is the section id, or `null` for the unsectioned remainder. Exact decimals; a malformed figure throws.
 */
export function quantitiesByUnit(rows: readonly { sectionId: string | null; unit: string; quantity: string }[], scale = 3): Map<string | null, UnitQuantity[]> {
  const sums = new Map<string | null, Map<string, bigint>>();
  for (const r of rows) {
    const units = parseDecimal(r.quantity, scale);
    if (units === null) throw new Error(`quantitiesByUnit: unreadable quantity "${r.quantity}"`);
    const perUnit = sums.get(r.sectionId) ?? new Map<string, bigint>();
    perUnit.set(r.unit, (perUnit.get(r.unit) ?? 0n) + units);
    sums.set(r.sectionId, perUnit);
  }
  const out = new Map<string | null, UnitQuantity[]>();
  for (const [key, perUnit] of sums) {
    out.set(key, [...perUnit].sort(([a], [b]) => a.localeCompare(b)).map(([unit, units]) => ({ unit, quantity: formatDecimal(units, scale) })));
  }
  return out;
}

/** The readiness counts as the server's `work_order_section_readiness` view returns them (live sections only). */
export interface ReadinessCounts {
  live_sections: number;
  not_ready: number;
  ready: number;
  blocked: number;
  all_ready: boolean;
}

export type ReadinessState = 'none' | 'all_ready' | 'blocked' | 'in_progress';

export interface ReadinessSummary {
  live: number;
  notReady: number;
  ready: number;
  blocked: number;
  /** True only with at least one live section and every live section ready. */
  allReady: boolean;
  state: ReadinessState;
}

/** The work-order readiness roll-up (AC-WOS-014): a work order with no live section has none (`null` in → state 'none'). */
export function readinessRollup(counts: ReadinessCounts | null | undefined): ReadinessSummary {
  if (!counts || counts.live_sections <= 0) {
    return { live: 0, notReady: 0, ready: 0, blocked: 0, allReady: false, state: 'none' };
  }
  const allReady = counts.all_ready === true && counts.ready === counts.live_sections;
  const state: ReadinessState = allReady ? 'all_ready' : counts.blocked > 0 ? 'blocked' : 'in_progress';
  return { live: counts.live_sections, notReady: counts.not_ready, ready: counts.ready, blocked: counts.blocked, allReady, state };
}

export interface AllocationHeadroom {
  /** Sum of the section allocations. */
  allocated: string;
  /** Work-order plan minus allocated; negative when the plan has fallen below the allocations. */
  remaining: string;
  /** The work order's plan fell below the sum of allocations: flag it, never rewrite a figure (AC-WOS-008). */
  overAllocated: boolean;
}

/** AC-WOS-008: allocations of a planned quantity (3 decimals) against the work order's plan. */
export function allocationHeadroom(workOrderPlan: string, allocations: readonly string[], scale = 3): AllocationHeadroom {
  const plan = parseDecimal(workOrderPlan, scale);
  if (plan === null) throw new Error(`allocationHeadroom: unreadable plan "${workOrderPlan}"`);
  let sum = 0n;
  for (const a of allocations) {
    const units = parseDecimal(a, scale);
    if (units === null) throw new Error(`allocationHeadroom: unreadable allocation "${a}"`);
    sum += units;
  }
  return { allocated: formatDecimal(sum, scale), remaining: formatDecimal(plan - sum, scale), overAllocated: sum > plan };
}
