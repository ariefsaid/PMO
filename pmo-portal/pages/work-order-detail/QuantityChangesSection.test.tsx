import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

/** #2578 the work order's quantity change section: the count beside the limit, the doorway, and who sees a Raise button (AC-QCR-006). */
const h = vi.hoisted(() => ({
  may: true, budget: { request_count: 2, request_limit: 2 as number | null },
  list: [{ id: 'q1', created_at: '2026-03-10T08:00:00Z', author_name: 'Pat PM', status: 'draft' }] as unknown[], over: [{ boq_item_id: 'b1' }] as unknown[],
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.may }));
vi.mock('@/src/hooks/useQuantityChanges', () => ({
  useQuantityChangeRequests: () => ({ data: { rows: h.list, hasMore: false }, isPending: false, isError: false, refetch: vi.fn() }),
  useWorkOrderRequestBudget: () => ({ data: h.budget }),
  useOverContract: () => ({ data: h.over }),
}));
vi.mock('../quantityChanges/RaiseQuantityChangeDialog', () => ({ RaiseQuantityChangeDialog: () => null }));

import { QuantityChangesSection } from './QuantityChangesSection';

const renderIt = (status = 'Issued') => render(<MemoryRouter><QuantityChangesSection workOrderId="w1" projectId="p1" status={status} /></MemoryRouter>);

beforeEach(() => { h.may = true; h.budget = { request_count: 2, request_limit: 2 }; });

describe('QuantityChangesSection', () => {
  it('shows the request count beside the limit and says when it is reached; the raise action is disabled', () => {
    renderIt();
    expect(screen.getByTestId('wo-qcr-count').textContent).toMatch(/2 \/ 2/);
    expect(screen.getByTestId('wo-qcr-count').textContent).toMatch(/reached its request limit/);
    expect(screen.getByRole('button', { name: 'Request a quantity change' })).toBeDisabled();
  });

  it('offers the raise action under the limit, and links to the project list', () => {
    h.budget = { request_count: 1, request_limit: null };
    renderIt();
    expect(screen.getByRole('button', { name: 'Request a quantity change' })).toBeEnabled();
    expect(screen.getByTestId('wo-qcr-all')).toHaveAttribute('href', '/quantity-changes?project=p1');
    expect(screen.getByText(/1 contract lines over their quantity/)).toBeInTheDocument();
  });

  it('a Closed work order cannot be raised on, and a role without permission sees no action', () => {
    const { unmount } = renderIt('Closed');
    expect(screen.queryByRole('button', { name: 'Request a quantity change' })).not.toBeInTheDocument();
    unmount();
    h.may = false;
    renderIt();
    expect(screen.queryByRole('button', { name: 'Request a quantity change' })).not.toBeInTheDocument();
  });
});
