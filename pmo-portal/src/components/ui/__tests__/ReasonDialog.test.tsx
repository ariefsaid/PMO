import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReasonDialog } from '../ReasonDialog';

const setup = (over: Partial<React.ComponentProps<typeof ReasonDialog>> = {}) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<ReasonDialog open kind="return" subject="timesheet" onConfirm={onConfirm} onCancel={onCancel} {...over} />);
  return { onConfirm, onCancel, ...utils };
};

describe('ReasonDialog: one Return / Reject dialog', () => {
  it('Return: reason field first in focus, confirm disabled until a reason is typed, then sends the trimmed reason', async () => {
    const { onConfirm } = setup();
    const dialog = await screen.findByRole('dialog', { name: 'Return timesheet' });
    const reason = within(dialog).getByRole('textbox', { name: /Reason for returning/ });
    expect(reason).toBeRequired();
    expect(reason).toHaveFocus();
    const confirm = within(dialog).getByRole('button', { name: 'Return' });
    expect(confirm).toBeDisabled();
    await userEvent.type(reason, '  Hours missing for Tuesday  ');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Hours missing for Tuesday');
  });

  it('whitespace is not a reason', async () => {
    const { onConfirm } = setup();
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), '   ');
    expect(within(dialog).getByRole('button', { name: 'Return' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Reject has the same layout: reason, quiet Cancel, filled confirm (destructive tone)', async () => {
    setup({ kind: 'reject', subject: 'purchase request' });
    const dialog = await screen.findByRole('alertdialog', { name: 'Reject purchase request' });
    const row = within(dialog).getByTestId('confirm-action-row');
    const buttons = within(row).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Reject']);
    expect(within(dialog).getByRole('textbox', { name: /Reason for rejecting/ })).toBeRequired();
    // Cancel is the outline (quiet) button; the confirm is a filled one.
    expect(buttons[0].className).toContain('bg-card');
    expect(buttons[1].className).toContain('bg-destructive-solid');
  });

  it('Return confirm is the filled primary button', async () => {
    setup();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Return' }).className).toContain('bg-primary');
  });

  it('Cancel and Escape close without sending', async () => {
    const { onConfirm, onCancel } = setup();
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the context (evidence) line and a failed-write error', async () => {
    setup({ context: 'Week of 3 Nov · 38 h', error: 'Could not save. Try again.' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Week of 3 Nov · 38 h')).toBeInTheDocument();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not save. Try again.');
  });

  it('every open starts with an empty reason', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<ReasonDialog open kind="return" subject="timesheet" onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.type(await screen.findByRole('textbox'), 'old reason');
    rerender(<ReasonDialog open={false} kind="return" subject="timesheet" onConfirm={onConfirm} onCancel={onCancel} />);
    rerender(<ReasonDialog open kind="return" subject="timesheet" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(await screen.findByRole('textbox')).toHaveValue('');
  });

  it('title and confirm label can be overridden', async () => {
    setup({ title: 'Send back for correction', confirmLabel: 'Send back' });
    const dialog = await screen.findByRole('dialog', { name: 'Send back for correction' });
    expect(within(dialog).getByRole('button', { name: 'Send back' })).toBeInTheDocument();
  });
});
