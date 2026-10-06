import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  addLine: { mutateAsync: vi.fn(), isPending: false },
  updateLine: { mutateAsync: vi.fn(), isPending: false },
  removeLine: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaimMutations: () => h }));

import { ExpenseLinesCard } from './ExpenseLinesCard';

const LINE = { id: 'l1', claim_id: 'c1', org_id: 'o', expense_date: '2026-10-01', expense_type: 'Travel', description: 'Taxi', amount: 150000, created_at: '' };
const renderCard = (editable: boolean, lines: unknown[] = []) =>
  render(<ToastProvider><ExpenseLinesCard claimId="c1" lines={lines as never} isPending={false} isError={false} currency="IDR" editable={editable} /></ToastProvider>);

beforeEach(() => { h.addLine.mutateAsync.mockReset().mockResolvedValue({ id: 'l2' }); });

describe('ExpenseLinesCard', () => {
  it('AC-EXP-062 adding a line sends the parsed amount', async () => {
    renderCard(true);
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Date/), { target: { value: '2026-10-01' } });
    await userEvent.type(within(dialog).getByLabelText(/Description/), 'Taxi to site');
    await userEvent.type(within(dialog).getByLabelText(/Amount/), '150000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add line' }));
    expect(h.addLine.mutateAsync).toHaveBeenCalledWith({
      claimId: 'c1', input: { expenseDate: '2026-10-01', expenseType: 'Travel', description: 'Taxi to site', amount: 150000 },
    });
  });
  it('AC-EXP-062 a zero amount is refused before any write', async () => {
    renderCard(true);
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Date/), { target: { value: '2026-10-01' } });
    await userEvent.type(within(dialog).getByLabelText(/Description/), 'Taxi');
    await userEvent.type(within(dialog).getByLabelText(/Amount/), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add line' }));
    expect(await within(dialog).findAllByText('Enter an amount greater than zero.')).not.toHaveLength(0);
    expect(h.addLine.mutateAsync).not.toHaveBeenCalled();
  });
  it('AC-EXP-062 read-only shows lines and no add/edit/remove', () => {
    renderCard(false, [LINE]);
    expect(screen.getByText('Taxi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add line' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit line/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove line/ })).toBeNull();
  });
});
