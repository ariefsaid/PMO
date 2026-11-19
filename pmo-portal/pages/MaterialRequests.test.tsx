import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  waiting: [{ requestId: 'r2', stepPosition: 2, role: 'Finance', label: 'Billable change', actingFor: null, submittedAt: '2026-11-19T08:00:00Z' }] as unknown[],
}));
const row = (id: string, number: string) => ({ id, number, workOrderId: 'w', projectId: 'p', toWarehouseId: null, neededBy: '2026-11-25', note: null, status: 'pending', round: 1,
  createdBy: 'u', createdAt: '2026-11-19T07:00:00Z', submittedAt: '2026-11-19T07:30:00Z', transferDocumentId: null, transferCancelled: false });

vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useWaitingForMe: () => ({ data: h.waiting, isPending: false, isError: false, refetch: vi.fn() }),
  useMaterialRequests: () => ({ data: { rows: [row('r1', 'MRQ-0001'), row('r2', 'MRQ-0002')], nextCursor: null }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));

import MaterialRequestsPage from './MaterialRequests';

const renderPage = (url = '/material-requests') => render(<MemoryRouter initialEntries={[url]}><ToastProvider><MaterialRequestsPage /></ToastProvider></MemoryRouter>);

describe('material requests list', () => {
  it('AC-MRQ-013 "Waiting for me" lists only the caller\'s open steps', () => {
    renderPage();
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('MRQ-0002');
    expect(table).toHaveTextContent('Step 2: Billable change');
    expect(table).not.toHaveTextContent('MRQ-0001');
  });

  it('empty queue says nothing is waiting', () => {
    h.waiting = [];
    renderPage();
    expect(screen.getByText('Nothing is waiting for you')).toBeInTheDocument();
  });

  it('every member can raise a request (FR-MRQ-016)', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /New request/ })).toBeInTheDocument();
  });

  it('All requests marks the ones waiting for me', async () => {
    h.waiting = [{ requestId: 'r2', stepPosition: 1, role: 'Finance', label: 'x', actingFor: null, submittedAt: '2026-11-19T08:00:00Z' }];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /All requests/ }));
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
  });
});
