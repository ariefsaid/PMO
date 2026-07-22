/**
 * AC-BUD-050/051 — budget/budgetProjection.ts: PMO's FORWARD VIEW (FR-BUD-151).
 *
 * ⚑ "Projection" here is PMO's own forward-looking derived view — NOT ADR-0055 §6's "projected into the
 * ERP object" (that means PUSHED; see bodies/budget.ts). Nothing computed here is ever sent to ERP
 * (structural proof: budgetNeverPushesProjection.test.ts, AC-BUD-054).
 *
 * This module is the unit ORACLE; the RPC (mig 0141 get_budget_projection) computes the identical
 * arithmetic in SQL `numeric` for the real read path — AC-BUD-050 and AC-BUD-053 must agree.
 */
import { describe, it, expect } from 'vitest';
import { deriveProjectionCell } from './budgetProjection';

describe('budgetProjection (FR-BUD-151 — PMO forward view, never pushed)', () => {
  it('AC-BUD-050 EAC = actuals + etc; variance = PMO budget − EAC; utilization = EAC / PMO budget', () => {
    const cell = deriveProjectionCell({
      category: 'Labor',
      pmoBudgetAmount: '100000.00',
      actualsToDate: '40000.00',
      pmoEtc: '35000.00',
    });
    expect(cell.projectedFinalCost).toBe('75000.00');
    expect(cell.projectedVariance).toBe('25000.00');
    expect(cell.projectedUtilization).toBe(0.75);
  });

  it('AC-BUD-050 sums exactly in cents — no binary-float drift on a non-terminating fraction', () => {
    const cell = deriveProjectionCell({
      category: 'Materials',
      pmoBudgetAmount: '300.00',
      actualsToDate: '100.10',
      pmoEtc: '100.20',
    });
    expect(cell.projectedFinalCost).toBe('200.30'); // NOT 200.29999999999998 (a plain float sum)
    expect(cell.projectedVariance).toBe('99.70');
  });

  it('AC-BUD-051 a zero PMO budget yields utilization NULL — never 0, never Infinity, never a throw', () => {
    const cell = deriveProjectionCell({
      category: 'Labor',
      pmoBudgetAmount: '0.00',
      actualsToDate: '10.00',
      pmoEtc: '0.00',
    });
    expect(cell.projectedUtilization).toBeNull();
  });

  it('AC-BUD-051 a NULL PMO budget (unbudgeted category) yields utilization NULL, not a throw', () => {
    const cell = deriveProjectionCell({
      category: 'Labor',
      pmoBudgetAmount: null,
      actualsToDate: '10.00',
      pmoEtc: '0.00',
    });
    expect(cell.projectedUtilization).toBeNull();
    expect(cell.pmoBudgetAmount).toBeNull();
    // ⚑ no budget line for this category ⇒ variance is reported as the full negative of EAC, never NULL
    // (a silently-dropped variance would hide an actual with no budget line at all — worse than a big number)
    expect(cell.projectedVariance).toBe('-10.00');
  });

  it('AC-BUD-051 an absent ETC row is treated as 0 so EAC = actuals (not an error, not a throw)', () => {
    const cell = deriveProjectionCell({
      category: 'Labor',
      pmoBudgetAmount: '100000.00',
      actualsToDate: '40000.00',
      pmoEtc: null,
    });
    expect(cell.projectedFinalCost).toBe('40000.00');
    expect(cell.projectedVariance).toBe('60000.00');
  });

  it('AC-BUD-051 a MAPPED category with no GL activity yet is a real 0, not an error', () => {
    const cell = deriveProjectionCell({
      category: 'Equipment',
      pmoBudgetAmount: '5000.00',
      // '' = "the account was queried and the ledger holds nothing" — a computed zero.
      actualsToDate: '',
      pmoEtc: '1000.00',
    });
    expect(cell.projectedFinalCost).toBe('1000.00');
    expect(cell.actualsToDate).toBe('0.00');
  });
});

/**
 * ⚑ C-1 / C-2 (rendered Discover pass, 2026-07-22) — the oracle must make the SAME distinction the RPC
 * now makes, or the two drift and this module stops being an oracle.
 *
 * `null` used to mean "no GL rows yet" and was folded to 0. That merged it with "there is no ERP
 * account mapped for this category at all", where the figure is not zero but UNKNOWABLE — and every
 * figure derived from it (EAC, variance, utilization) was then stated with equal confidence: a
 * full-budget variance and 0% utilization for a category the same screen was simultaneously banner-ing
 * as unmapped.
 */
describe('deriveProjectionCell — an unobtainable actual is never a zero (C-1/C-2)', () => {
  const unmapped = () =>
    deriveProjectionCell({
      category: 'Equipment',
      pmoBudgetAmount: '20000.00',
      actualsToDate: null, // no ERP account mapped ⇒ PMO cannot know
      pmoEtc: '1000.00',
    });

  it('C-1 reports NO actuals figure rather than 0.00', () => {
    expect(unmapped().actualsToDate).toBeNull();
  });

  it('C-2 derives no projected final cost from an unobtainable actual', () => {
    expect(unmapped().projectedFinalCost).toBeNull();
  });

  it('C-2 derives no variance — never "the entire budget is still available"', () => {
    expect(unmapped().projectedVariance).toBeNull();
  });

  it('C-2 derives no utilization — never a confident 0%', () => {
    expect(unmapped().projectedUtilization).toBeNull();
  });

  it('C-1 the PMO-owned halves are still stated: they are knowable without the ERP map', () => {
    const cell = unmapped();
    expect(cell.pmoBudgetAmount).toBe('20000.00');
    expect(cell.pmoEtc).toBe('1000.00');
  });
});
