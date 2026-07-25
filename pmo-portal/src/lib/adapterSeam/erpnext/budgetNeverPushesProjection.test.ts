/**
 * AC-BUD-054 — structural proof (task 7.2, FR-BUD-160): PMO's forward-view projection
 * (`pmo_etc` / EAC / variance / utilization — `src/lib/budget/budgetProjection.ts`) must NEVER reach
 * ERP under any key, at any layer.
 *
 * Two proofs, deliberately in this order:
 *
 *  1. A MUTATION SANITY CHECK — a deliberately-leaky stand-in body is asserted to FAIL the exact same
 *     assertion helper used against the real body below. This is the RED half: it proves the oracle
 *     genuinely discriminates a leak (rather than being a tautology that would pass no matter what
 *     `budgetToBody` does) BEFORE trusting it against the shipped implementation.
 *  2. The REAL, already-shipped `budgetToBody` (`erpnext/bodies/budget.ts`) is asserted clean against a
 *     record carrying every projection-shaped field this program ever computes (via the REAL
 *     `deriveProjectionCell` oracle, with distinctive values that cannot coincidentally collide with a
 *     legitimate budget amount) — the GREEN half, and the one that matters for every future edit to
 *     `budgetToBody`: if a later change ever threads a projection value into the push body, THIS file
 *     goes red.
 */
import { describe, expect, it } from 'vitest';
import { budgetToBody } from './bodies/budget.ts';
import type { PmoRecord } from '../contract.ts';
import type { ErpCtx } from './doctypeRegistry.ts';
import { deriveProjectionCell } from '../../budget/budgetProjection.ts';

const MAP = [{ category: 'Labor', erp_account: 'Salary - PSC' }];
const CTX: ErpCtx = {
  refs: { project: 'PROJ-0001' },
  config: { company: 'PMO Smoke Co', category_account_map: MAP },
};

// Distinctive, non-round values (never `50000.00`, which is also a legitimate ERP budget_amount below)
// so a leak cannot hide behind a coincidental overlap with a real, INTENDED figure in the body.
const CELL = deriveProjectionCell({
  category: 'Labor',
  pmoBudgetAmount: '50000.00',
  actualsToDate: '777701.11',
  pmoEtc: '888802.22',
});

// C-1/C-2: these cells are now nullable (an unobtainable actual makes every derived figure
// unobtainable too). Only a REAL value can leak, so only real values are forbidden.
const FORBIDDEN_VALUES = [CELL.pmoEtc, CELL.projectedFinalCost, CELL.projectedVariance].filter(
  (v): v is string => v !== null,
);

/** The ONE oracle both proofs share: no forbidden projection VALUE, and no projection-shaped KEY
 *  name, may appear anywhere in the serialized body. */
function assertNeverLeaksProjection(body: unknown): void {
  const json = JSON.stringify(body);
  for (const forbidden of FORBIDDEN_VALUES) {
    if (json.includes(forbidden)) {
      throw new Error(`projection value ${JSON.stringify(forbidden)} leaked into the ERP body: ${json}`);
    }
  }
  if (/etc|projected|variance|utilization/i.test(json)) {
    throw new Error(`a projection-shaped key leaked into the ERP body: ${json}`);
  }
}

// A version carrying every projection-shaped field the program ever computes — exactly what a naive
// future edit to `budgetToBody` might accidentally forward.
const versionWithProjection = {
  id: 'ver-1',
  fiscal_year: '2026',
  line_items: [{ category: 'Labor', budgeted_amount: '50000.00' }],
  pmo_etc: CELL.pmoEtc,
  projected_final_cost: CELL.projectedFinalCost,
  projected_variance: CELL.projectedVariance,
  projected_utilization: CELL.projectedUtilization,
} as unknown as PmoRecord;

describe('AC-BUD-054 the projection never reaches ERP (structural)', () => {
  it('AC-BUD-054 ⚑ sanity: the oracle DOES fail a body that leaks the projection (proves it is not vacuous)', () => {
    const leakyBody = {
      accounts: [{ account: 'Salary - PSC', budget_amount: '50000.00' }],
      // a naive implementation might forward the PMO estimate-to-complete under some key:
      pmo_etc: CELL.pmoEtc,
    };
    expect(() => assertNeverLeaksProjection(leakyBody)).toThrow(/leaked/);
  });

  it('AC-BUD-054 ⚑ sanity: the oracle also catches a projection-shaped KEY even with a non-matching value', () => {
    const leakyBody = { accounts: [], projected_variance_note: 'see the forecast' };
    expect(() => assertNeverLeaksProjection(leakyBody)).toThrow(/key/);
  });

  it('AC-BUD-054 the real budgetToBody never carries pmo_etc / EAC / variance / utilization, under any key', () => {
    const body = budgetToBody(versionWithProjection, CTX);
    expect(() => assertNeverLeaksProjection(body)).not.toThrow();
  });

  it('AC-BUD-054 budgetToBody emits ONLY the whitelisted keys — nothing else crosses, even when offered more', () => {
    const body = budgetToBody(versionWithProjection, CTX) as Record<string, unknown>;
    const allowed = new Set([
      'company',
      'fiscal_year',
      'budget_against',
      'project',
      'accounts',
      'action_if_annual_budget_exceeded',
      'action_if_accumulated_monthly_budget_exceeded',
      'action_if_annual_budget_exceeded_on_mr',
      'action_if_accumulated_monthly_budget_exceeded_on_mr',
      'action_if_annual_budget_exceeded_on_po',
      'action_if_accumulated_monthly_budget_exceeded_on_po',
    ]);
    for (const key of Object.keys(body)) {
      expect(allowed.has(key)).toBe(true);
    }
    for (const row of body.accounts as Array<Record<string, unknown>>) {
      expect(Object.keys(row).sort()).toEqual(['account', 'budget_amount']);
    }
  });
});
