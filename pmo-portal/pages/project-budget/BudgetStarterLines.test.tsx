import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import BudgetStarterLines from './BudgetStarterLines';

const renderStarter = (onCreateLineItem = vi.fn().mockResolvedValue({}), onDirtyChange = vi.fn(), onSaveError = vi.fn()) => {
  render(
    <FinanceI18nTestProvider>
      <BudgetStarterLines currency="USD" onCreateLineItem={onCreateLineItem} onDirtyChange={onDirtyChange} onSaveError={onSaveError} />
    </FinanceI18nTestProvider>,
  );
  return { onCreateLineItem, onDirtyChange, onSaveError };
};

describe('BudgetStarterLines (#design-1115 first budget)', () => {
  it('lists every budget category so a new person only types amounts, then saves them in one step', async () => {
    const { onCreateLineItem } = renderStarter();
    expect(screen.getByRole('textbox', { name: 'Labor' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Materials' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save lines' })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Labor' }), '1000');
    await userEvent.type(screen.getByRole('textbox', { name: 'Materials' }), '2500.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save 2 lines' }));
    await waitFor(() => expect(onCreateLineItem).toHaveBeenCalledTimes(2));
    expect(onCreateLineItem).toHaveBeenCalledWith({ category: 'Labor', description: null, budgeted_amount: 1000, fiscal_year: null });
    expect(onCreateLineItem).toHaveBeenCalledWith({ category: 'Materials', description: null, budgeted_amount: 2500.5, fiscal_year: null });
  });

  it('keeps the typed amount of a line that failed to save, and says so beside it', async () => {
    const onCreateLineItem = vi.fn().mockImplementation(async (item: { category: string }) => {
      if (item.category === 'Materials') throw new Error('network');
      return {};
    });
    const { onSaveError } = renderStarter(onCreateLineItem);
    await userEvent.type(screen.getByRole('textbox', { name: 'Labor' }), '1000');
    await userEvent.type(screen.getByRole('textbox', { name: 'Materials' }), '2500');
    await userEvent.click(screen.getByRole('button', { name: 'Save 2 lines' }));
    await waitFor(() => expect(onSaveError).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('textbox', { name: 'Materials' })).toHaveValue('2,500');
    expect(screen.getByRole('textbox', { name: 'Labor' })).toHaveValue('');
    expect(screen.getByText('Not saved; try again')).toBeInTheDocument();
  });

  it('catches a bad amount at the field before anything is written, and reports unsaved typing', async () => {
    const { onCreateLineItem, onDirtyChange } = renderStarter();
    await userEvent.type(screen.getByRole('textbox', { name: 'Labor' }), '0');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 line' }));
    expect(screen.getByText('Enter an amount above 0, up to 2 decimals')).toBeInTheDocument();
    expect(onCreateLineItem).not.toHaveBeenCalled();
  });
});
