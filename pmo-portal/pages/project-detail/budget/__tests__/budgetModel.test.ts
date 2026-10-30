import { describe, expect, it } from 'vitest';
import { buildBudgetSummaryRows, committedTotal, compareBudgetVersions } from '../budgetModel';

const line = (category: string, description: string, budgeted_amount: number) => ({
  category,
  description,
  budgeted_amount,
});

describe('budgetModel', () => {
  it('groups active lines by category and keeps actual and committed spend separate', () => {
    const rows = buildBudgetSummaryRows({
      lines: [line('Labor', 'Design', 80), line('Labor', 'Build', 20), line('Materials', 'Steel', 50)],
      actuals: [
        { category: 'Labor', budget: 100, actual: 120 },
        { category: 'Materials', budget: 50, actual: null },
      ],
      procurements: [
        { status: 'Ordered', budget_category: 'Labor', approved_total_value: 40, total_value: 45, currency: 'USD' },
        { status: 'Received', budget_category: 'Labor', approved_total_value: null, total_value: 10, currency: 'USD' },
        { status: 'Approved', budget_category: 'Labor', approved_total_value: 100, total_value: 100, currency: 'USD' },
      ],
      canReadProcurements: true,
      currency: 'USD',
    });

    expect(rows.map(({ category, budget, spent, committed }) => ({ category, budget, spent, committed }))).toEqual([
      { category: 'Labor', budget: 100, spent: 120, committed: 50 },
      { category: 'Materials', budget: 50, spent: null, committed: 0 },
    ]);
    expect(rows[0]?.lines.map(({ description, budgeted_amount }) => [description, budgeted_amount])).toEqual([
      ['Design', 80],
      ['Build', 20],
    ]);
  });

  it('omits commitment figures when procurement data is unreadable or mixes currencies', () => {
    const input = {
      lines: [line('Labor', 'Work', 100)],
      actuals: [{ category: 'Labor', budget: 100, actual: null }],
      procurements: [
        { status: 'Paid', budget_category: 'Labor', approved_total_value: 25, total_value: 25, currency: 'EUR' },
      ],
      currency: 'USD',
    };

    expect(buildBudgetSummaryRows({ ...input, canReadProcurements: true })[0]?.committed).toBeNull();
    expect(buildBudgetSummaryRows({ ...input, canReadProcurements: false })[0]?.committed).toBeNull();
  });

  it('includes actual or committed categories even when the active version has no line for them', () => {
    const rows = buildBudgetSummaryRows({
      lines: [line('Labor', 'Work', 100)],
      actuals: [
        { category: 'Labor', budget: 100, actual: 10 },
        { category: 'Travel', budget: 0, actual: 25 },
      ],
      procurements: [
        { status: 'Ordered', budget_category: 'Equipment', approved_total_value: 40, total_value: 45, currency: 'USD' },
      ],
      canReadProcurements: true,
      currency: 'USD',
    });

    expect(rows.map(({ category, budget, spent, committed }) => ({ category, budget, spent, committed }))).toEqual([
      { category: 'Labor', budget: 100, spent: 10, committed: 0 },
      { category: 'Travel', budget: 0, spent: 25, committed: 0 },
      { category: 'Equipment', budget: 0, spent: null, committed: 40 },
    ]);
  });

  it('counts commitments with no budget category in an Uncategorized row so the totals include them', () => {
    const rows = buildBudgetSummaryRows({
      lines: [line('Labor', 'Work', 100)],
      actuals: [{ category: 'Labor', budget: 100, actual: 10 }],
      procurements: [
        { status: 'Ordered', budget_category: null, approved_total_value: 40, total_value: 40, currency: 'USD' },
        { status: 'Paid', budget_category: null, approved_total_value: null, total_value: 15, currency: 'USD' },
        { status: 'Requested', budget_category: null, approved_total_value: 99, total_value: 99, currency: 'USD' },
      ],
      canReadProcurements: true,
      currency: 'USD',
    });

    expect(rows.map(({ category, budget, spent, committed }) => ({ category, budget, spent, committed }))).toEqual([
      { category: 'Labor', budget: 100, spent: 10, committed: 0 },
      { category: 'Uncategorized', budget: 0, spent: 0, committed: 55 },
    ]);
  });

  it('counts the server open commitment, so an amount the ERP ledger already counts as spent is not committed twice', () => {
    const rows = buildBudgetSummaryRows({
      lines: [line('Labor', 'Work', 100)],
      actuals: [{ category: 'Labor', budget: 100, actual: 30 }],
      procurements: [
        // 50 ordered, 30 of it already posted to the ledger (in "spent"): 20 is still open.
        { status: 'Ordered', budget_category: 'Labor', approved_total_value: 50, total_value: 50, open_commitment: 20, currency: 'USD' },
      ],
      canReadProcurements: true,
      currency: 'USD',
    });

    expect(rows[0]).toMatchObject({ category: 'Labor', spent: 30, committed: 20 });
  });

  it('totals committed spend from the category rows, Uncategorized included, and stays unknown when a row is unknown', () => {
    const base = {
      lines: [line('Labor', 'Work', 100)],
      actuals: [{ category: 'Labor', budget: 100, actual: 10 }],
      canReadProcurements: true,
      currency: 'USD',
    };
    expect(committedTotal(buildBudgetSummaryRows({ ...base, procurements: [
      { status: 'Ordered', budget_category: 'Labor', approved_total_value: 40, total_value: 45, currency: 'USD' },
      { status: 'Vendor Invoiced', budget_category: null, approved_total_value: null, total_value: 62, currency: 'USD' },
    ] }))).toBe(102);
    expect(committedTotal(buildBudgetSummaryRows({ ...base, procurements: [
      { status: 'Ordered', budget_category: 'Labor', approved_total_value: 40, total_value: 45, currency: 'EUR' },
    ] }))).toBeNull();
    expect(committedTotal([])).toBeNull();
  });

  it('compares any two versions by category and signs the proposed change', () => {
    const rows = compareBudgetVersions(
      [line('Labor', 'Design', 100), line('Materials', 'Steel', 50)],
      [line('Labor', 'Design', 125), line('Travel', 'Site visit', 10)],
    );

    expect(rows).toEqual([
      { category: 'Labor', a: 100, b: 125, change: 25 },
      { category: 'Materials', a: 50, b: 0, change: -50 },
      { category: 'Travel', a: 0, b: 10, change: 10 },
    ]);
  });
});
