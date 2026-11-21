/**
 * consumablePlan.ts (#2577) — the pure maths of the work-order consumable plan. It mirrors the SQL generation
 * (`cus_plan_matches`/`cus_generate_plan`, migration 1076) so the screen can preview a regeneration; the SQL function
 * is the authority. Exact decimals throughout (BigInt, never a JS float): rounded ONCE per item, half up at 3 decimals.
 */

import { subtractDecimal } from '@/src/lib/stockFormat';

export interface UsageStandard {
  id: string;
  itemId: string;
  workUnit: string;
  boqCodePrefix: string | null;
  /** Up to 6 decimals, in the item's own unit, as a decimal string. */
  qtyPerUnit: string;
  /** 0..100, up to 2 decimals. */
  marginPct: string;
}
export interface PlanLineInput { boqItemId: string; code: string; unit: string; quantity: string }
export interface PlanBasisRow { boqItemId: string; code: string; workQty: string; standardId: string; qtyPerUnit: string; marginPct: string }
export interface PlanItem { itemId: string; generatedQty: string; basis: PlanBasisRow[] }
export interface ComputedPlan { items: PlanItem[]; noStandard: PlanLineInput[] }

/** Decimal string -> BigInt scaled by 10^dp (truncating extra digits is never needed: inputs are numeric(14,3)/(14,6)/(5,2)). */
function scaled(value: string, dp: number): bigint {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!m || (m[2] === '' && !m[3])) throw new Error(`not a decimal: ${value}`);
  const frac = (m[3] ?? '').padEnd(dp, '0').slice(0, dp);
  const n = BigInt((m[2] || '0') + frac);
  return m[1] === '-' ? -n : n;
}
function format(n: bigint, dp: number): string {
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().padStart(dp + 1, '0');
  const body = dp === 0 ? digits : `${digits.slice(0, -dp)}.${digits.slice(-dp)}`;
  return neg && n !== 0n ? `-${body}` : body;
}

const norm = (s: string) => s.trim().toLowerCase();
const prefixOf = (s: UsageStandard) => norm(s.boqCodePrefix ?? '');

/** A standard applies when its work unit equals the line's unit (trimmed, case-blind) and the prefix, if set, starts the line code (case-blind). */
function applies(s: UsageStandard, l: PlanLineInput): boolean {
  return norm(s.workUnit) === norm(l.unit) && norm(l.code).startsWith(prefixOf(s));
}

const RESULT_SCALE = 13;   // work qty (3) x qty per unit (6) x (100 + margin) / 100 (4)
export function computeConsumablePlan(lines: PlanLineInput[], standards: UsageStandard[]): ComputedPlan {
  const byItem = new Map<string, { total: bigint; basis: PlanBasisRow[] }>();
  const noStandard: PlanLineInput[] = [];
  for (const line of lines) {
    // per item the longest prefix wins (ties cannot exist: the server refuses a duplicate key)
    const best = new Map<string, UsageStandard>();
    for (const s of standards) {
      if (!applies(s, line)) continue;
      const cur = best.get(s.itemId);
      if (!cur || prefixOf(s).length > prefixOf(cur).length) best.set(s.itemId, s);
    }
    if (best.size === 0) { noStandard.push(line); continue; }
    for (const [itemId, s] of best) {
      const result = scaled(line.quantity, 3) * scaled(s.qtyPerUnit, 6) * (10000n + scaled(s.marginPct, 2));
      const entry = byItem.get(itemId) ?? { total: 0n, basis: [] };
      entry.total += result;
      entry.basis.push({ boqItemId: line.boqItemId, code: line.code, workQty: line.quantity, standardId: s.id, qtyPerUnit: s.qtyPerUnit, marginPct: s.marginPct });
      byItem.set(itemId, entry);
    }
  }
  const drop = 10n ** BigInt(RESULT_SCALE - 3);
  const items = [...byItem].map(([itemId, e]) => ({ itemId, generatedQty: format((e.total + drop / 2n) / drop, 3), basis: e.basis }))
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  return { items, noStandard };
}

/** AC-CUS-013: remaining = planned - already requested, exact at 3 decimals (trailing zeros dropped), shown even when negative (an over-request stays visible). */
export function remainingQuantity(planned: string, requested: string): string {
  return subtractDecimal(planned, requested);
}

export interface PlanDiffRow { itemId: string; oldQty: string | null; newQty: string | null; change: 'added' | 'removed' | 'changed'; keepsAdjustment: boolean }
/** FR-CUS-007: what a regeneration would change per item, for the confirmation step. Unchanged items are left out. */
export function diffPlan(
  current: Array<{ itemId: string; generatedQty: string; adjustedQty: string | null }>,
  next: Array<{ itemId: string; generatedQty: string }>,
): PlanDiffRow[] {
  const nextBy = new Map(next.map((n) => [n.itemId, n.generatedQty]));
  const out: PlanDiffRow[] = [];
  for (const c of current) {
    const n = nextBy.get(c.itemId);
    const adjusted = c.adjustedQty !== null;
    if (n === undefined) {
      // an adjusted row survives with generated 0; an unadjusted one is removed
      if (adjusted) { if (scaled(c.generatedQty, 3) !== 0n) out.push({ itemId: c.itemId, oldQty: c.generatedQty, newQty: '0.000', change: 'changed', keepsAdjustment: true }); }
      else out.push({ itemId: c.itemId, oldQty: c.generatedQty, newQty: null, change: 'removed', keepsAdjustment: false });
    } else if (scaled(n, 3) !== scaled(c.generatedQty, 3)) {
      out.push({ itemId: c.itemId, oldQty: c.generatedQty, newQty: n, change: 'changed', keepsAdjustment: adjusted });
    }
  }
  const have = new Set(current.map((c) => c.itemId));
  for (const n of next) if (!have.has(n.itemId)) out.push({ itemId: n.itemId, oldQty: null, newQty: n.generatedQty, change: 'added', keepsAdjustment: false });
  return out.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}
