/** budget.unowned-occupant (v1) — PMO never amends an ERP budget it did not create, and writes nothing. */
import { describe, expect, it } from 'vitest';
import type { ErpHarness } from './harness.ts';

const GRAIN = { account: 'Salary', fiscalYear: '2026' };

export function budgetSuite(h: ErpHarness): void {
  describe(`budget.unowned-occupant (${h.tier})`, () => {
    it('AC-BFY-027 an empty grain is pushed (the refusals below are not vacuous)', async () => {
      const r = await h.pushBudget({ ...GRAIN, occupant: 'none' });
      expect(r).toMatchObject({ outcome: 'pushed' });
      expect(r.erpWrites).toBeGreaterThan(0);
    });

    it('AC-BFY-027 a live budget PMO did not create is refused, naming the account and year, with no write', async () => {
      const r = await h.pushBudget({ ...GRAIN, occupant: 'one-live' });
      expect(r).toMatchObject({ outcome: 'refused', code: 'budget-unowned-live-occupant', erpWrites: 0 });
      expect(r.message).toMatch(/Salary.*2026|2026.*Salary/);
    });

    it('two live budgets on the grain are refused with no write', async () => {
      const r = await h.pushBudget({ ...GRAIN, occupant: 'two-live' });
      expect(r).toMatchObject({ outcome: 'refused', code: 'commit-rejected', erpWrites: 0 });
      expect(r.message).toMatch(/Salary.*2026|2026.*Salary/);
    });

    it('AC-BFY-027 a draft rival is refused with its own code and no write', async () => {
      const r = await h.pushBudget({ ...GRAIN, occupant: 'draft' });
      expect(r).toMatchObject({ outcome: 'refused', code: 'budget-draft-rival-on-grain', erpWrites: 0 });
    });
  });
}
