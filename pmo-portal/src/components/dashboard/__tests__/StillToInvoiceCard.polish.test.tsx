import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  state: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
}));

vi.mock('@/src/hooks/useWorkOrderBilling', () => ({ useUnbilledWorkOrders: () => h.state }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));

import { StillToInvoiceCard } from '../StillToInvoiceCard';

const POPULATED = {
  totals: [{ currency: 'USD', remaining: 1300, count: 2 }],
  incompleteCount: 1,
  rows: [
    { workOrderId: 'wo-1', woNumber: 'WO-1', title: 'Survey', projectId: 'p1', projectName: 'Harbor Tower', status: 'Issued', currency: 'USD', remaining: 1000, daysSinceClosed: null, clientPoNumber: 'PO-77' },
  ],
  incomplete: [{ workOrderId: 'wo-8', woNumber: 'WO-8', title: 'Cabling', projectId: 'p2', projectName: 'Annex' }],
};

const renderCard = () => render(<MemoryRouter><StillToInvoiceCard /></MemoryRouter>);

beforeEach(() => {
  h.role = 'Finance';
  h.state = { data: POPULATED, isPending: false, isError: false, refetch: vi.fn() };
});

describe('StillToInvoiceCard dashboard polish', () => {
  it('UIP-010: presents a genuinely clear issued-work-order queue in a compact, explicit status', () => {
    h.state = {
      data: { totals: [], incompleteCount: 0, rows: [], incomplete: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };

    const utilities = document.createElement('style');
    utilities.textContent = `
      .p-2 { padding: 8px; }
      .px-4 { padding-left: 16px; padding-right: 16px; }
      .py-2 { padding-top: 8px; padding-bottom: 8px; }
      /* Match Tailwind's conflicting-utility outcome: p-4 follows and overrides py-2. */
      .p-4 { padding: 16px; }
    `;
    document.head.append(utilities);

    renderCard();

    const clear = screen.getByTestId('still-to-invoice-clear');
    expect(clear).toHaveAttribute('role', 'status');
    expect(clear).toHaveTextContent('Nothing left to invoice on issued work orders');
    expect(Number.parseFloat(getComputedStyle(clear.parentElement!).paddingTop)).toBeLessThanOrEqual(8);
    utilities.remove();
    expect(clear).not.toHaveTextContent(/\b0\b|\$/);
    expect(screen.queryByTestId('liststate-loading')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(clear.querySelector('svg')).toBeNull();
  });

  it('UIP-010: keeps loading distinct from a clear queue', () => {
    h.state = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };

    renderCard();

    expect(screen.getByTestId('still-to-invoice-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('still-to-invoice-clear')).not.toBeInTheDocument();
  });

  it('UIP-010: keeps errors retryable instead of describing them as clear', () => {
    const refetch = vi.fn();
    h.state = { data: undefined, isPending: false, isError: true, refetch };

    renderCard();

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load what is still to invoice");
    expect(screen.queryByTestId('still-to-invoice-clear')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('UIP-010: keeps incomplete or unavailable figures visible without substituting zero', () => {
    h.state = {
      data: { totals: [], incompleteCount: 2, rows: [], incomplete: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };

    renderCard();

    expect(screen.getByTestId('still-to-invoice-incomplete')).toHaveTextContent('Work orders not totalled');
    expect(screen.getByTestId('still-to-invoice-incomplete')).toHaveTextContent(': 2');
    expect(screen.queryByTestId('still-to-invoice-clear')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\s*0(?:\.00)?/)).not.toBeInTheDocument();
  });

  it('UIP-010: preserves populated totals, tax basis, work-order details, and canonical links', () => {
    renderCard();

    expect(screen.getByTestId('still-to-invoice-totals')).toHaveTextContent('$1,300.00');
    expect(screen.getByTestId('still-to-invoice-totals')).toHaveTextContent('excl. PPN');
    expect(screen.getByTestId('still-to-invoice-totals')).toHaveTextContent('Work orders: 2');
    expect(screen.getByRole('link', { name: /WO-1/ })).toHaveAttribute('href', '/projects/p1/work-orders?wo=wo-1');
    expect(screen.getByRole('link', { name: /WO-8/ })).toHaveAttribute('href', '/projects/p2/work-orders?wo=wo-8');
  });
});
