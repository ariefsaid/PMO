/**
 * #2104 perf(rbp) — budget editor lane. `BudgetLineItemEditor` rebuilt its `columns` array on
 * every render (a fresh literal per render), so every parent-driven re-render handed DataTable
 * a new column identity and re-derived its table model for nothing.
 *
 * This test pins column-identity stability across same-props re-renders (the memoisation the
 * issue names): the captured `columns` reference seen by DataTable must not change when the
 * editor re-renders with unchanged inputs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

const probes = vi.hoisted(() => ({
  columnIdentities: [] as unknown[],
}));

vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  const CountingDataTable: React.FC<React.ComponentProps<typeof actual.DataTable>> = (props) => {
    probes.columnIdentities.push(props.columns);
    return <actual.DataTable {...props} />;
  };
  return { ...actual, DataTable: CountingDataTable };
});

import BudgetLineItemEditor from '../BudgetLineItemEditor';
import type { BudgetLineItemRow } from '@/src/lib/db/budgets';

function makeLineItem(i: number): BudgetLineItemRow {
  return {
    id: `li-${i}`,
    budget_version_id: 'bv-1',
    category: 'Labor',
    description: `Line ${i}`,
    budgeted_amount: 1000 + i,
    fiscal_year: 'FY2026',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  } as unknown as BudgetLineItemRow;
}

const LINE_ITEMS = [makeLineItem(0), makeLineItem(1)];
const stableProps = {
  lineItems: LINE_ITEMS,
  currency: 'USD',
  onCreateLineItem: vi.fn(),
  onDeleteLineItem: vi.fn(),
  onUpdateLineItem: vi.fn(),
  onSaveSuccess: vi.fn(),
  onOpenBuffersChange: vi.fn(),
  onSaveError: undefined,
  fiscalYearNames: ['FY2026'] as string[] | null,
  budgetMode: 'per_year' as const,
};

beforeEach(() => {
  probes.columnIdentities = [];
  vi.clearAllMocks();
});

describe('#2104 budget editor lane — column identity is stable', () => {
  it('a same-props re-render (parent tick) keeps the exact same columns reference', () => {
    const { rerender } = render(<BudgetLineItemEditor {...stableProps} />);
    rerender(<BudgetLineItemEditor {...stableProps} />);
    rerender(<BudgetLineItemEditor {...stableProps} />);

    expect(probes.columnIdentities.length).toBe(3);
    expect(probes.columnIdentities[1]).toBe(probes.columnIdentities[0]);
    expect(probes.columnIdentities[2]).toBe(probes.columnIdentities[0]);
  });
});
