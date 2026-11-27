import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  headers: vi.fn(),
  detail: vi.fn(),
  workOrderRead: vi.fn(),
  waiting: [{ requestId: 'r2', stepPosition: 2, role: 'Finance', label: 'Billable change', actingFor: null, submittedAt: '2026-11-19T08:00:00Z' }] as unknown[],
}));
const row = (id: string, number: string) => ({ id, number, workOrderId: 'w', projectId: 'p', toWarehouseId: null, neededBy: '2026-11-25', note: null, status: 'pending', round: 1,
  createdBy: 'u', createdAt: '2026-11-19T07:00:00Z', submittedAt: '2026-11-19T07:30:00Z', transferDocumentId: null, transferCancelled: false });

vi.mock('@/src/hooks/useMaterialRequests', () => ({
  useMaterialRequest: (id?: string) => { h.detail(id); return ({ data: id === 'r99' ? row('r99', 'MRQ-0099') : undefined }); },
  useMaterialRequestHeaders: (ids: string[]) => { h.headers(ids); return { data: ids.map(id => ({ ...row(id, id === 'r99' ? 'MRQ-0099' : 'MRQ-0002'), workOrder: { wo_number: 'WO-0042', title: 'Slab pour' } })) }; },
  useWaitingForMe: () => ({ data: h.waiting, isPending: false, isError: false, refetch: vi.fn() }),
  useMaterialRequests: () => ({ data: { rows: [row('r1', 'MRQ-0001'), row('r2', 'MRQ-0002')].map((r) => ({ ...r, workOrder: { wo_number: 'WO-0042', title: 'Slab pour' } })), nextCursor: null }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useWorkOrderRecord', () => ({ useWorkOrder: (id?: string) => { h.workOrderRead(id); return { data: { id: 'w', wo_number: 'WO-0042', title: 'Slab pour' } }; } }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [{ id: 'p', name: 'Harbour Road', short_name: null, code: null }] }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));

import MaterialRequestsPage from './MaterialRequests';

const renderPage = (url = '/material-requests') => render(<MemoryRouter initialEntries={[url]}><ToastProvider><MaterialRequestsPage /></ToastProvider></MemoryRouter>);

describe('material requests list', () => {
  it('batches 60 waiting headers without request detail reads', () => {
    h.headers.mockClear(); h.detail.mockClear();
    h.waiting = Array.from({ length: 60 }, (_, n) => ({ requestId: `r${n}`, stepPosition: 1, label: `Step ${n}` }));
    renderPage();
    expect(h.headers).toHaveBeenCalledWith(Array.from({ length: 60 }, (_, n) => `r${n}`));
    expect(h.detail).not.toHaveBeenCalled();
    h.waiting = [{ requestId: 'r2', stepPosition: 2, label: 'Billable change' }];
  });
  it('AC-MRQ-013 "Waiting for me" lists only the caller\'s open steps', () => {
    renderPage();
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('MRQ-0002');
    expect(table).toHaveTextContent('Step 2: Billable change');
    expect(table).not.toHaveTextContent('MRQ-0001');
  });

  it('FR-MRQ-017 a waiting request beyond the first page of the list still shows its number', () => {
    h.waiting = [{ requestId: 'r99', stepPosition: 1, role: 'Finance', label: 'Stock', actingFor: null, submittedAt: '2026-11-01T08:00:00Z' }];
    renderPage();
    expect(screen.getByRole('table')).toHaveTextContent('MRQ-0099');
  });

  it('#2609 shows the work order, linked, and the project on each waiting row', () => {
    h.waiting = [{ requestId: 'r2', stepPosition: 2, role: 'Finance', label: 'Billable change', actingFor: null, submittedAt: '2026-11-19T08:00:00Z' }];
    renderPage();
    expect(screen.getByRole('link', { name: 'WO-0042 · Slab pour' })).toHaveAttribute('href', '/work-orders/w');
    expect(screen.getByRole('table')).toHaveTextContent('Harbour Road');
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

  it('AC-1128-002 the All view shows each work order from the list read and reads no work order per row', async () => {
    renderPage('/material-requests?view=all');
    expect(screen.getAllByText('WO-0042 · Slab pour')).toHaveLength(2);
    expect(h.workOrderRead.mock.calls.filter(([id]) => id !== undefined)).toEqual([]);
  });

  it('All requests marks the ones waiting for me', async () => {
    h.waiting = [{ requestId: 'r2', stepPosition: 1, role: 'Finance', label: 'x', actingFor: null, submittedAt: '2026-11-19T08:00:00Z' }];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /All requests/ }));
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
  });
});
