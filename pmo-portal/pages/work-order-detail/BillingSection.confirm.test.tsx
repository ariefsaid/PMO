import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BillingSection } from './BillingSection';
import type { WorkOrderAcceptanceWithLines } from '@/src/lib/db/workOrderAcceptances';

const draft = { id: 'a1', acceptance_date: '2026-11-13', status: 'Draft', is_final: false, prepared_by: 'u-pm', lines: [] } as unknown as WorkOrderAcceptanceWithLines;
const confirmed = { ...draft, id: 'a2', status: 'Confirmed' } as unknown as WorkOrderAcceptanceWithLines;

const renderIt = (canConfirm: boolean, onConfirm = vi.fn()) => {
  render(<BillingSection billing={null} acceptances={[draft, confirmed]} acceptancesPending={false} acceptancesError={false}
    onRetryAcceptances={vi.fn()} confirm={{ canConfirm: (a) => canConfirm && a.status === 'Draft', onConfirm }} />);
  return onConfirm;
};

describe('fix-billing item 1: the delivery record (BAST) on the work-order page', () => {
  it('shows a visible Confirm BAST control on the waiting record to the role that may confirm, and it confirms that record', async () => {
    const onConfirm = renderIt(true);
    expect(screen.getAllByRole('button', { name: 'Confirm BAST' })).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm BAST' }));
    expect(onConfirm).toHaveBeenCalledWith(draft);
  });
  it('shows no control to a role that may not confirm, but the chip still says who it waits on', () => {
    renderIt(false);
    expect(screen.queryByRole('button', { name: 'Confirm BAST' })).not.toBeInTheDocument();
    expect(screen.getByText('Waiting for Finance or an Admin to confirm')).toBeInTheDocument();
  });
});
