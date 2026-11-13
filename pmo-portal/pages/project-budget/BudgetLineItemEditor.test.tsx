import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BudgetLineItemRow, NewLineItem } from '@/src/lib/db/budgets';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import BudgetLineItemEditor from './BudgetLineItemEditor';

describe('BudgetLineItemEditor controls', () => {
  it('keeps category, description, amount, and fiscal year values when creating a line', async () => {
    const onCreateLineItem = vi.fn<(item: NewLineItem) => Promise<unknown>>().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <FinanceI18nTestProvider>
        <BudgetLineItemEditor
          lineItems={[] as BudgetLineItemRow[]}
          currency="USD"
          onCreateLineItem={onCreateLineItem}
          onDeleteLineItem={vi.fn()}
          onUpdateLineItem={vi.fn()}
          onSaveSuccess={vi.fn()}
          onOpenBuffersChange={vi.fn()}
          onDirtyChange={vi.fn()}
        />
      </FinanceI18nTestProvider>,
    );

    await user.click(screen.getByRole('button', { name: /Add line item/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Line item category' }), 'Equipment');
    await user.type(screen.getByRole('textbox', { name: 'Line item description' }), 'Generator');
    await user.type(screen.getByRole('textbox', { name: 'Line item fiscal year' }), 'FY-2026');
    await user.type(screen.getByRole('textbox', { name: 'Line item amount' }), '2500');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCreateLineItem).toHaveBeenCalledWith({
      category: 'Equipment',
      description: 'Generator',
      budgeted_amount: 2500,
      fiscal_year: 'FY-2026',
    });
  });
});
