import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({
  useExpensePostingReadiness: () => ({ state: 'inactive', retry: vi.fn() }),
}));

vi.mock('@/src/hooks/useImprest', () => ({ useImprestFloatChoices: () => ({ data: [] }) }));

import { ExpenseClaimFormModal, type ExpenseCategoryPrecedent } from './ExpenseClaimFormModal';

describe('AC-S29-001 receipt or first expense starts a new claim', () => {
  const renderForm = (
    onSubmit = vi.fn().mockResolvedValue(undefined),
    categoryPrecedents: ExpenseCategoryPrecedent[] = [],
    onClose = vi.fn(),
  ) => {
    render(
      <ToastProvider>
        <ExpenseClaimFormModal
          kind="claim"
          projectOptions={[{ value: 'p1', label: 'Harbour Upgrade' }]}
          advanceOptions={[]}
          advanceLoad={{ isPending: false, isError: false, refetch: vi.fn() }} projectLoad={{ isPending: false, isError: false, refetch: vi.fn() }}
          categoryPrecedents={categoryPrecedents}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      </ToastProvider>,
    );
    return onSubmit;
  };

  it('puts an optional receipt and the first line before secondary claim details', () => {
    renderForm();
    const dialog = screen.getByRole('dialog');
    const sections = within(dialog).getAllByRole('group');
    expect(sections[0]).toHaveAccessibleName('First expense');
    expect(within(sections[0]).getByLabelText('Date')).toBeInTheDocument();
    expect(within(sections[0]).getByLabelText('Type')).toHaveValue('');
    expect(within(sections[0]).getByLabelText('Description')).toBeInTheDocument();
    expect(within(sections[0]).getByLabelText('Amount')).toBeInTheDocument();
    expect(within(sections[0]).getByLabelText('Choose a receipt file')).toHaveAttribute('type', 'file');
    expect(sections[1]).toHaveAccessibleName('Details');
    expect(within(dialog).getByRole('status')).toHaveTextContent("This saves in PMO only");
  });

  it('uses a filename or first-line description as an editable title and waits for Save before capture', async () => {
    const onSubmit = renderForm();
    const dialog = screen.getByRole('dialog');
    const file = new File(['receipt'], 'Harbor taxi.pdf', { type: 'application/pdf' });
    fireEvent.change(within(dialog).getByLabelText('Choose a receipt file'), { target: { files: [file] } });
    expect(within(dialog).getByLabelText(/Title/)).toHaveValue('Harbor taxi');
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText('Description'), 'Taxi to project site');
    const title = within(dialog).getByLabelText(/Title/);
    expect(title).toHaveValue('Taxi to project site');
    await userEvent.clear(title);
    await userEvent.type(title, 'Reviewed travel');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Type/), 'Travel');
    await userEvent.type(within(dialog).getByLabelText(/^Amount/), '150000');
    fireEvent.change(within(dialog).getByLabelText(/^Date/), { target: { value: '2026-10-07' } });
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      { kind: 'claim', title: 'Reviewed travel', purpose: null, projectId: null, budgetCategory: null, advanceId: null },
      {
        firstLine: { expenseDate: '2026-10-07', expenseType: 'Travel', description: 'Taxi to project site', amount: 150000 },
        receiptFile: file,
      },
    );
  });

  it('lets the claimant remove a selected receipt before saving', async () => {
    const onSubmit = renderForm();
    const dialog = screen.getByRole('dialog');
    const file = new File(['receipt'], 'Harbor taxi.pdf', { type: 'application/pdf' });
    fireEvent.change(within(dialog).getByLabelText('Choose a receipt file'), { target: { files: [file] } });
    expect(within(dialog).getByText('Harbor taxi.pdf')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(within(dialog).queryByText('Harbor taxi.pdf')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('guards a selected receipt as unsaved work until the claimant confirms discard', async () => {
    const onClose = vi.fn();
    renderForm(vi.fn().mockResolvedValue(undefined), [], onClose);
    const dialog = screen.getByRole('dialog');
    const file = new File(['receipt'], 'Harbor taxi.pdf', { type: 'application/pdf' });
    fireEvent.change(within(dialog).getByLabelText('Choose a receipt file'), { target: { files: [file] } });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const discardDialog = await screen.findByRole('alertdialog');
    expect(within(discardDialog).getByText(/unsaved changes|not saved/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(within(discardDialog).getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('requires a complete valid first line once the claimant starts entering one', async () => {
    const onSubmit = renderForm();
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Taxi to project site');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findAllByText('Enter the date of the expense.')).not.toHaveLength(0);
    expect(within(dialog).getAllByText('Choose an expense type.')).not.toHaveLength(0);
    expect(within(dialog).getByLabelText(/^Type/)).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getAllByText('Enter an amount greater than zero.')).not.toHaveLength(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('proposes the last same-project category with its source and lets the claimant clear it', async () => {
    renderForm(undefined, [{ projectId: 'p1', budgetCategory: 'Special expenses', sourceTitle: 'Previous site visit' }]);
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Project'), 'p1');

    const category = within(dialog).getByLabelText('Budget category');
    expect(category).toHaveValue('Special expenses');
    expect(within(dialog).getByText(/Previous site visit/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Decides who approves/)).toBeInTheDocument();

    await userEvent.selectOptions(category, '');
    expect(category).toHaveValue('');
  });
});
