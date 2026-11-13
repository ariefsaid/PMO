import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BudgetLineItemRow, NewLineItem } from '@/src/lib/db/budgets';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import BudgetLineItemEditor from './BudgetLineItemEditor';

describe('BudgetLineItemEditor controls', () => {
  const renderEditor = (lineItems: BudgetLineItemRow[], onCreateLineItem = vi.fn<(item: NewLineItem) => Promise<unknown>>().mockResolvedValue(undefined), onUpdateLineItem = vi.fn()) => render(
    <FinanceI18nTestProvider>
      <BudgetLineItemEditor
        lineItems={lineItems}
        currency="USD"
        onCreateLineItem={onCreateLineItem}
        onDeleteLineItem={vi.fn()}
        onUpdateLineItem={onUpdateLineItem}
        onSaveSuccess={vi.fn()}
        onOpenBuffersChange={vi.fn()}
        onDirtyChange={vi.fn()}
      />
    </FinanceI18nTestProvider>,
  );

  it('keeps category, description, amount, and fiscal year values when creating a line', async () => {
    const onCreateLineItem = vi.fn<(item: NewLineItem) => Promise<unknown>>().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderEditor([], onCreateLineItem);

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

  it('keeps edited category, description, and fiscal year values when saving a line', async () => {
    const onUpdateLineItem = vi.fn().mockResolvedValue(undefined);
    const line = {
      id: 'line-1', category: 'Labor', description: 'Survey', budgeted_amount: 1000, fiscal_year: 'FY-A',
    } as unknown as BudgetLineItemRow;
    const user = userEvent.setup();
    renderEditor([line], undefined, onUpdateLineItem);

    await user.click(screen.getByRole('button', { name: 'Edit line item Labor' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Equipment');
    await user.clear(screen.getByRole('textbox', { name: 'Description' }));
    await user.type(screen.getByRole('textbox', { name: 'Description' }), 'Replacement');
    await user.clear(screen.getByRole('textbox', { name: 'Fiscal year' }));
    await user.type(screen.getByRole('textbox', { name: 'Fiscal year' }), 'FY-B');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onUpdateLineItem).toHaveBeenCalledWith('line-1', {
      category: 'Equipment', description: 'Replacement', budgeted_amount: 1000, fiscal_year: 'FY-B',
    });
  });
});
