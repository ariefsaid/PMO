import { describe, it, expect } from 'vitest';
import { resolveBudgetAccounts, BudgetCategoryUnmappedError } from './categoryAccountMap';

const MAP = [
  { category: 'Labor', erp_account: 'Salary - PSC' },
  { category: 'Materials', erp_account: 'Cost of Goods Sold - PSC' },
  { category: 'Equipment', erp_account: 'Office Maintenance Expenses - PSC' },
];

describe('categoryAccountMap (FR-BUD-110..114 — the PMO category ↔ ERP account boundary)', () => {
  it('AC-BUD-011 resolves mapped non-zero categories to their accounts as decimal-strings', () => {
    const rows = resolveBudgetAccounts(
      [
        { category: 'Labor', budgeted_amount: '50000.00' },
        { category: 'Materials', budgeted_amount: '25000.00' },
      ],
      MAP,
    );
    expect(rows).toEqual([
      { account: 'Salary - PSC', budget_amount: '50000.00' },
      { account: 'Cost of Goods Sold - PSC', budget_amount: '25000.00' },
    ]);
  });

  it('AC-BUD-011 sums several line items of one category into ONE account row, exactly (no float drift)', () => {
    const rows = resolveBudgetAccounts(
      [
        { category: 'Labor', budgeted_amount: '30000.10' },
        { category: 'Labor', budgeted_amount: '20000.20' },
        { category: 'Labor', budgeted_amount: '0.05' },
      ],
      MAP,
    );
    // 0.1 + 0.2 in float is 0.30000000000000004 — the sum must be integer-cent exact.
    expect(rows).toEqual([{ account: 'Salary - PSC', budget_amount: '50000.35' }]);
  });

  it('AC-BUD-011 accepts a number-shaped amount and a bare-integer amount, normalising both to 2dp', () => {
    const rows = resolveBudgetAccounts([{ category: 'Labor', budgeted_amount: '1200' }], MAP);
    expect(rows).toEqual([{ account: 'Salary - PSC', budget_amount: '1200.00' }]);
  });

  it('AC-BUD-011 omits a ZERO-total category (ERP has no meaning for a zero budget line) — not an error', () => {
    expect(resolveBudgetAccounts([{ category: 'Equipment', budgeted_amount: '0.00' }], MAP)).toEqual([]);
  });

  it('AC-BUD-011 ⚑ FAILS CLOSED on an unmapped non-zero category, NAMING every one — never a default account', () => {
    let err: unknown;
    try {
      resolveBudgetAccounts(
        [
          { category: 'Materials', budgeted_amount: '25000.00' }, // mapped
          { category: 'Contingency', budgeted_amount: '10000.00' }, // UNMAPPED
          { category: 'Overheads', budgeted_amount: '5000.00' }, // UNMAPPED
        ],
        MAP,
      );
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(BudgetCategoryUnmappedError);
    expect((err as BudgetCategoryUnmappedError).code).toBe('budget-category-unmapped');
    // ⚑ NAMES them ALL at once — an operator surface must be actionable in ONE round-trip, not
    // whack-a-mole, and the mapped Materials row must NOT have been emitted as a partial body.
    expect((err as BudgetCategoryUnmappedError).unmappedCategories).toEqual(['Contingency', 'Overheads']);
    expect((err as BudgetCategoryUnmappedError).message).toContain('Contingency');
    expect((err as BudgetCategoryUnmappedError).message).toContain('Overheads');
  });

  it('AC-BUD-011 an unmapped ZERO-amount category is NOT an error (nothing would be pushed for it)', () => {
    expect(resolveBudgetAccounts([{ category: 'Contingency', budgeted_amount: '0.00' }], MAP)).toEqual([]);
  });

  it('AC-BUD-011 an EMPTY map fails closed on every non-zero category — never an empty accounts[] array', () => {
    // Empty/absent `accounts` is an UNGUARDED ERP 500 (spike §10(a): `ba.account in ()` — a raw SQL
    // syntax error, not a classifiable 4xx). Refusing here is what keeps that unreachable.
    expect(() => resolveBudgetAccounts([{ category: 'Labor', budgeted_amount: '1.00' }], [])).toThrow(
      BudgetCategoryUnmappedError,
    );
  });

  it('AC-BUD-011 line items with NO non-zero category yield an empty list (the caller must refuse to push)', () => {
    expect(resolveBudgetAccounts([], MAP)).toEqual([]);
  });

  it('AC-BUD-011 a malformed amount is rejected, never coerced to 0 (a silent under-budget in ERP)', () => {
    expect(() => resolveBudgetAccounts([{ category: 'Labor', budgeted_amount: 'abc' }], MAP)).toThrow(/decimal/i);
  });
});
