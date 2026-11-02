/**
 * budget.push (v1) — an active budget version reaches the ERP only whole and attributed: every category maps to an
 * account, and the project is the caller's own. A refusal costs zero ERP calls (a category resolved to the wrong
 * account, or a budget with no project dimension, would mis-configure the client's real ledger controls).
 * The ERP-already-holds-a-budget cases are `budget.unowned-occupant`.
 */
import { describe, expect, it } from 'vitest';
import type { ErpHarness } from './harness.ts';

const CATEGORIES = ['Labor', 'Materials'];

export function budgetPushSuite(h: ErpHarness): void {
  describe(`budget.push (${h.tier})`, () => {
    it('AC-BUD-012 a version with every category mapped and the caller\'s own project is pushed', async () => {
      const r = await h.pushBudgetVersion({ categories: CATEGORIES, mappedCategories: CATEGORIES, project: 'own' });
      expect(r).toMatchObject({ outcome: 'accepted' });
      expect(r.erpCalls).toBeGreaterThan(0);
    });

    it('AC-BUD-011 an UNMAPPED category refuses the whole push with zero ERP calls (no partial budget)', async () => {
      expect(await h.pushBudgetVersion({ categories: [...CATEGORIES, 'Contingency'], mappedCategories: CATEGORIES, project: 'own' }))
        .toMatchObject({ outcome: 'refused', code: 'budget-category-unmapped', erpCalls: 0 });
    });

    it('AC-BUD-011 an org with NO category mapped pushes nothing at all (fail closed, not an empty budget)', async () => {
      expect(await h.pushBudgetVersion({ categories: CATEGORIES, mappedCategories: [], project: 'own' }))
        .toMatchObject({ outcome: 'refused', code: 'budget-category-unmapped', erpCalls: 0 });
    });

    it('AC-BUD-012 a project owned by ANOTHER tenant is refused before any ERP write', async () => {
      expect(await h.pushBudgetVersion({ categories: CATEGORIES, mappedCategories: CATEGORIES, project: 'other-tenant' }))
        .toMatchObject({ outcome: 'refused', code: 'cross-org-link-rejected', erpCalls: 0 });
    });

    it('AC-BUD-012 a version with NO project is refused: never an unattributed, org-wide budget', async () => {
      expect(await h.pushBudgetVersion({ categories: CATEGORIES, mappedCategories: CATEGORIES, project: 'none' }))
        .toMatchObject({ outcome: 'refused', code: 'commit-rejected', erpCalls: 0 });
    });
  });
}
