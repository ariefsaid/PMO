import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

/** #2578 raise dialog: only over-contract, allocated, unit-rate lines are offered; R is checked before the server is asked (AC-QCR-004/005/006). */
const h = vi.hoisted(() => ({
  over: [] as unknown[], budget: { request_count: 0, request_limit: null as number | null },
  raise: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock('@/src/hooks/useQuantityChanges', () => ({
  useOverContract: () => ({ data: h.over, isPending: false }),
  useWorkOrderRequestBudget: () => ({ data: h.budget }),
  useQuantityChangeMutations: () => ({ raise: h.raise }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' } }) }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    workOrder: { list: async () => [] },
    dailySiteReport: { listContractItems: async () => [{ id: 'l1', boq_item_id: 'b1', item_code: 'EXC', description: 'Excavation', unit: 'm3' }] },
  },
}));

import { RaiseQuantityChangeDialog } from './RaiseQuantityChangeDialog';

const row = (over: Record<string, unknown> = {}) => ({
  boq_item_id: 'b1', item_code: 'EXC', description: 'Excavation', unit: 'm3', rate: 50000, earning_basis: 'unit_rate', contract_quantity: 1000,
  progress_quantity: 1040, progress_source: 'assessment', forecast_quantity: null, over_progress: true, over_forecast: false, open_request_id: null, ...over,
});
const renderDialog = (onCreated = vi.fn()) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ToastProvider><RaiseQuantityChangeDialog presetProjectId="p1" presetWorkOrderId="w1" onClose={vi.fn()} onCreated={onCreated} /></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  h.over = [row(), row({ boq_item_id: 'b2', item_code: 'PIPE', over_progress: false }), row({ boq_item_id: 'b3', item_code: 'OPEN', open_request_id: 'q9' })];
  h.budget = { request_count: 0, request_limit: null };
  h.raise.mutateAsync.mockReset();
});

describe('RaiseQuantityChangeDialog', () => {
  it('AC-QCR-004 offers only the over-contract line that is allocated to the work order and has no open request', async () => {
    renderDialog();
    expect(await screen.findAllByTestId('qcr-raise-line')).toHaveLength(1);
    expect(screen.getByText(/EXC · Excavation/)).toBeInTheDocument();
  });

  it('AC-QCR-005 a quantity below the trigger figure is explained and nothing is sent', async () => {
    renderDialog();
    await userEvent.type(await screen.findByLabelText(/Requested total quantity/), '1030');
    await userEvent.type(screen.getByLabelText('Reason'), 'Rock');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByText(/Cannot be below 1040/)).toBeInTheDocument();
    expect(h.raise.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-QCR-004 sends the line with a client request id and goes to the new draft', async () => {
    h.raise.mutateAsync.mockResolvedValue('q1');
    const onCreated = vi.fn();
    renderDialog(onCreated);
    await userEvent.type(await screen.findByLabelText(/Requested total quantity/), '1100');
    await userEvent.type(screen.getByLabelText('Reason'), 'Rock found');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(h.raise.mutateAsync).toHaveBeenCalledTimes(1);
    expect(h.raise.mutateAsync.mock.calls[0][0]).toMatchObject({
      workOrderId: 'w1', lines: [{ boqItemId: 'b1', requestedQuantity: '1100', reason: 'Rock found' }],
    });
    expect(typeof h.raise.mutateAsync.mock.calls[0][0].clientRequestId).toBe('string');
    expect(onCreated).toHaveBeenCalledWith('q1');
  });

  it('AC-QCR-006 at the limit the dialog says so and cannot create', async () => {
    h.budget = { request_count: 2, request_limit: 2 };
    renderDialog();
    expect(await screen.findByTestId('qcr-limit-note')).toHaveTextContent(/2 of 2 requests used/);
    expect(screen.getByRole('button', { name: 'Create draft' })).toBeDisabled();
  });
});
