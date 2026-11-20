import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state = vi.hoisted(() => ({ result: { data: [{ boqItemId: 'b1', itemCode: 'A', description: 'Pipe', unit: 'm', scopeQty: 10, progressQty: null, measuredQty: 7, billedQty: 4, billedAmount: 400, unbilledQty: null, surplusQty: 0, status: 'partly_billed' }], isError: false, isPending: false, isFetching: false, refetch: vi.fn() } }));
vi.mock('@/src/hooks/useBillingStages', () => ({ useBillingReconciliation: () => state.result }));
import { BillingReconciliation } from '../BillingReconciliation';

beforeEach(() => { state.result.isError = false; state.result.isPending = false; state.result.isFetching = false; state.result.refetch.mockReset(); });

describe('BillingReconciliation', () => {
  it('offers retry after the reconciliation read fails', async () => {
    state.result.isError = true;
    const user = userEvent.setup();
    render(<BillingReconciliation projectId="p1" workOrderId={null} currency="IDR" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Reconciliation could not be loaded.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.result.refetch).toHaveBeenCalled();
  });
  it('does not present stale numbers while refreshing the reconciliation', () => {
    state.result.isFetching = true;
    render(<BillingReconciliation projectId="p1" workOrderId={null} currency="IDR" />);
    expect(screen.getByText('Loading reconciliation…')).toBeInTheDocument();
    expect(screen.queryByText('Pipe')).not.toBeInTheDocument();
    state.result.isFetching = false;
  });
  it('shows progress, measured and billed quantities without inventing unknown progress', () => {
    render(<BillingReconciliation projectId="p1" workOrderId="w1" currency="IDR" />);
    expect(screen.getByText('Pipe')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown')).toHaveLength(2);
    expect(screen.getByText('Partly billed')).toBeInTheDocument();
    expect(screen.getByText('Progress for shared items is recorded at project level.')).toBeInTheDocument();
  });
});
