import { describe, expect, it } from 'vitest';
import { budgetArchiveConfirmFromTargets } from './BudgetVersionActions';
import type { BudgetArchiveTarget } from '@/src/lib/db/budgets';

/**
 * AC-BUD-122 (#1462) — the archive decision is derived from the SERVER's inventory, never re-derived in
 * the browser. These pin the three promises that make the dialog truthful:
 *   • every named target is shown (legacy with nothing but a year and a document name — no account is
 *     invented for it), including null/stale-witness and unavailable-binding rows;
 *   • cancellation is offered only when EVERY named target is eligible (the RPC is all-or-nothing);
 *   • no targets means no cancellation affordance at all.
 */

function target(overrides: Partial<BudgetArchiveTarget> = {}): BudgetArchiveTarget {
  return {
    source_kind: 'account',
    fiscal_year: '2026',
    erp_budget_name: 'BUD-2026',
    eligible: true,
    reason: 'eligible',
    push_state: 'pushed',
    erp_docstatus: 1,
    ...overrides,
    to_fiscal_year: overrides.to_fiscal_year ?? null,
  };
}

describe('#1462 budgetArchiveConfirmFromTargets', () => {
  it('offers cancellation for a single eligible legacy v15 target and keeps its year and name', () => {
    const confirm = budgetArchiveConfirmFromTargets('v1', 'Budget v1', [
      target({ source_kind: 'legacy', erp_budget_name: 'BUD-OLD' }),
    ]);

    expect(confirm.kind).toBe('archive');
    expect(confirm.cancellable).toBe(true);
    expect(confirm.cancelErp).toBe(true);
    expect(confirm.targets).toEqual([
      { source_kind: 'legacy', fiscal_year: '2026', to_fiscal_year: null, erp_budget_name: 'BUD-OLD', eligible: true, reason: 'eligible', push_state: 'pushed', erp_docstatus: 1 },
    ]);
    // No account is fabricated for a year-grained document.
    expect('erp_account' in confirm.targets[0]).toBe(false);
  });

  it('keeps a v16 legacy target visible but withholds cancellation until its ERP shape is proven', () => {
    const confirm = budgetArchiveConfirmFromTargets('v2', 'Budget v2', [
      target({ source_kind: 'legacy', erp_budget_name: 'BUD-OLD', eligible: false, reason: 'legacy-v16-shape-unproven' }),
      target({ erp_budget_name: 'BUD-ACCOUNT' }),
    ]);

    expect(confirm.cancellable).toBe(false);
    expect(confirm.targets.map((row) => row.source_kind)).toEqual(['legacy', 'account']);
    expect(confirm.targets[0]).toMatchObject({ fiscal_year: '2026', erp_budget_name: 'BUD-OLD' });
  });

  it('withholds the cancellation offer when ANY named target is ineligible, still listing all of them', () => {
    const confirm = budgetArchiveConfirmFromTargets('v3', 'Budget v3', [
      target({ erp_budget_name: 'BUD-OK' }),
      target({ erp_budget_name: 'BUD-AMBIGUOUS', eligible: false, reason: 'ambiguous-sources' }),
    ]);

    expect(confirm.cancellable).toBe(false);
    expect(confirm.cancelErp).toBe(false);
    expect(confirm.targets.map((row) => row.erp_budget_name)).toEqual(['BUD-OK', 'BUD-AMBIGUOUS']);
  });

  it.each([
    ['a null activation witness', { eligible: false, reason: 'witness-changed' }],
    ['an unavailable binding', { eligible: false, reason: 'binding-unavailable' }],
    ['an unsettled ERPNext command', { eligible: false, reason: 'command-unsettled' }],
    ['an unproven upgraded legacy shape', { eligible: false, reason: 'legacy-v16-shape-unproven' }],
  ])('keeps a target with %s visible as a warning instead of hiding it', (_label, overrides) => {
    const confirm = budgetArchiveConfirmFromTargets('v4', 'Budget v4', [target({ source_kind: 'legacy', ...overrides })]);

    expect(confirm.targets).toHaveLength(1);
    expect(confirm.cancellable).toBe(false);
    expect(confirm.cancelErp).toBe(false);
  });

  it('offers nothing when the server reports no live target', () => {
    const confirm = budgetArchiveConfirmFromTargets('v5', 'Budget v5', []);
    expect(confirm.targets).toEqual([]);
    expect(confirm.cancellable).toBe(false);
    expect(confirm.cancelErp).toBe(false);
  });

  it('preserves duplicate same-name sources so an ambiguous inventory is not collapsed', () => {
    const confirm = budgetArchiveConfirmFromTargets('v6', 'Budget v6', [
      target({ erp_budget_name: 'BUD-DUPLICATE', eligible: false, reason: 'ambiguous-sources' }),
      target({ erp_budget_name: 'BUD-DUPLICATE', eligible: false, reason: 'ambiguous-sources' }),
    ]);

    expect(confirm.targets).toHaveLength(2);
    expect(confirm.cancellable).toBe(false);
  });
});
