import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({ useExpensePostingReadiness: () => ({ state: 'ready', retry: vi.fn() }) }));
vi.mock('@/src/hooks/useImprest', () => ({ useImprestFloatChoices: () => ({ data: [] }) }));

import { ExpenseClaimFormModal } from './ExpenseClaimFormModal';

const INITIAL = { title: 'Site visit', projectId: null, budgetCategory: null, purpose: null, amount: 0, advanceId: null };

describe('AC-EXP-062 the claim form does not save past an unloaded advance list', () => {
  const renderForm = (load: { isPending: boolean; isError: boolean }, initial?: typeof INITIAL) => {
    const refetch = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <ExpenseClaimFormModal kind="claim" projectOptions={[]} advanceOptions={[]} advanceLoad={{ ...load, refetch }}
          initial={initial} onClose={vi.fn()} onSubmit={onSubmit} />
      </ToastProvider>,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: 'Site visit' } });
    return { dialog, refetch, onSubmit, submit: () => within(dialog).getByRole('button', { name: initial ? 'Save' : 'Create' }) };
  };

  it('a failed read pauses Create, explains why and retries', () => {
    const { dialog, refetch, onSubmit, submit } = renderForm({ isPending: false, isError: true });
    expect(within(dialog).getByText(/Couldn't load your advances/)).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    fireEvent.submit(submit().closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
  it('a pending read holds Create', () => {
    const { dialog, submit } = renderForm({ isPending: true, isError: false });
    expect(within(dialog).getByText('Loading your advances…')).toBeInTheDocument();
    expect(submit()).toBeDisabled();
  });
  it('a loaded read lets Create through', () => {
    const { submit } = renderForm({ isPending: false, isError: false });
    expect(submit()).toBeEnabled();
  });
  it('editing an existing claim keeps its link and is not blocked, but still says the list failed', () => {
    const { dialog, submit } = renderForm({ isPending: false, isError: true }, INITIAL);
    expect(within(dialog).getByText(/Couldn't load your advances/)).toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });
});
