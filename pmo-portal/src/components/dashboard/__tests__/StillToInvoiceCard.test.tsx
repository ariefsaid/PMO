import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  state: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => h.state }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));

import { StillToInvoiceCard } from '../StillToInvoiceCard';

const DATA = {
  totals: [{ currency: 'USD', remaining: 1300, count: 2 }],
  incompleteCount: 1,
  rows: [
    { workOrderId: 'wo-1', woNumber: 'WO-1', title: 'Survey', projectId: 'p1', projectName: 'Harbor Tower', status: 'Issued', currency: 'USD', remaining: 1000, daysSinceClosed: null, clientPoNumber: 'PO-77' },
    { workOrderId: 'wo-2', woNumber: null, title: 'Fit-out', projectId: 'p2', projectName: 'Annex', status: 'Closed', currency: 'USD', remaining: 300, daysSinceClosed: 3, clientPoNumber: null },
  ],
  incomplete: [{ workOrderId: 'wo-8', woNumber: 'WO-8', title: 'Cabling', projectId: 'p2', projectName: 'Annex' }],
};
const renderCard = () => render(<MemoryRouter><StillToInvoiceCard /></MemoryRouter>);

beforeEach(() => {
  h.role = 'Finance';
  h.state = { data: DATA, isPending: false, isError: false, refetch: vi.fn() };
});

describe('StillToInvoiceCard (OD-BILL-1 / #786)', () => {
  it('AC-UNB-005 shows each currency total excl. PPN with its count', () => {
    renderCard();
    const totals = screen.getByTestId('still-to-invoice-totals');
    expect(totals).toHaveTextContent('$1,300.00');
    expect(totals).toHaveTextContent('excl. PPN');
    expect(totals).toHaveTextContent('Work orders: 2');
  });
  it("AC-UNB-005 lists the work orders with the most left, each linking straight to that work order on its project's Work orders tab", () => {
    renderCard();
    expect(screen.getByRole('link', { name: /WO-1/ })).toHaveAttribute('href', '/projects/p1/work-orders?wo=wo-1');
    expect(screen.getByRole('link', { name: /Fit-out/ })).toHaveAttribute('href', '/projects/p2/work-orders?wo=wo-2');
    expect(screen.getByRole('link', { name: /Fit-out/ })).toHaveTextContent('Days since closed: 3');
    expect(screen.getByRole('link', { name: /WO-1/ })).not.toHaveTextContent('Days since closed');
  });
  it('AC-UNB-005 a row names the work order by number and scope, and its client PO when it has one', () => {
    renderCard();
    const wo1 = screen.getByRole('link', { name: /WO-1/ });
    expect(wo1).toHaveTextContent('WO-1');
    expect(wo1).toHaveTextContent('Survey');
    expect(wo1).toHaveTextContent('Client PO PO-77');
    expect(screen.getByRole('link', { name: /Fit-out/ })).not.toHaveTextContent('Client PO');
  });
  it('AC-UNB-005 says how many could not be totalled, and links to each so it can be fixed', () => {
    renderCard();
    const incomplete = screen.getByTestId('still-to-invoice-incomplete');
    expect(incomplete).toHaveTextContent(': 1');
    expect(screen.getByRole('link', { name: /WO-8/ })).toHaveAttribute('href', '/projects/p2/work-orders?wo=wo-8');
    expect(screen.getByRole('link', { name: /WO-8/ })).toHaveTextContent('Cabling');
  });
  it('AC-UNB-005 when more could not be totalled than are listed, it says how many more', () => {
    h.state = { ...h.state, data: { ...DATA, incompleteCount: 3 } };
    renderCard();
    expect(screen.getByTestId('still-to-invoice-incomplete')).toHaveTextContent('and 2 more');
  });
  it('AC-UNB-005 empty, loading and error states — never a fabricated zero', async () => {
    h.state = { data: { totals: [], incompleteCount: 0, rows: [], incomplete: [] }, isPending: false, isError: false, refetch: vi.fn() };
    const view = renderCard();
    expect(screen.getByText('Nothing left to invoice on issued work orders')).toBeInTheDocument();
    view.unmount();
    h.state = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    const loading = renderCard();
    expect(screen.getByTestId('still-to-invoice-loading')).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
    loading.unmount();
    h.state = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderCard();
    expect(screen.getByText("Couldn't load what is still to invoice")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.state.refetch).toHaveBeenCalled();
  });
  it('AC-UNB-005 a role outside the revenue read set sees no card', () => {
    h.role = 'Engineer';
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
});
