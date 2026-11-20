import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { DsrReportDetail } from '@/src/lib/db/dailySiteReports';

/** #1522 site report record page: what each role is offered, and what the day shows (AC-DSR-004/005/008/011/013). */
const h = vi.hoisted(() => ({
  detail: null as unknown,
  revenue: [] as unknown[],
  equipment: [] as unknown[],
  peopleHours: '8',
  userId: 'eng',
  realRole: 'Engineer',
  pm: 'pm',
  m: {
    save: { mutateAsync: vi.fn(), isPending: false }, submit: { mutateAsync: vi.fn(), isPending: false },
    validate: { mutateAsync: vi.fn(), isPending: false }, returnReport: { mutateAsync: vi.fn(), isPending: false },
    correct: { mutateAsync: vi.fn(), isPending: false }, uploadPhoto: { mutateAsync: vi.fn(), isPending: false },
  },
}));
vi.mock('@/src/hooks/useDailySiteReports', () => ({
  useDailySiteReport: () => ({ data: h.detail, isPending: false, isError: false, refetch: vi.fn() }),
  useDailySiteReportRevenue: (_id: string, enabled: boolean) => ({ data: enabled ? h.revenue : undefined }),
  useWorkOrderValidatedRevenue: (_id: string, enabled: boolean) => ({ data: enabled ? 140 : undefined }),
  useDsrLookups: () => ({
    idle: { data: [{ id: 'ir1', label: 'Weather' }] }, weather: { data: [{ id: 'wx1', label: 'Rain' }] },
    items: { data: [{ id: 'l1', boq_item_id: 'b1', item_code: 'W-1', description: 'Weld', unit: 'm' }, { id: 'l2', boq_item_id: 'b2', item_code: 'X-9', description: 'Unpriced', unit: 'ea' }] },
    hours: { data: { peopleHours: h.peopleHours, equipment: h.equipment } },
  }),
  useDailySiteReportMutations: () => h.m,
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: { id: 'p1', name: 'Pipeline', project_manager_id: h.pm } }) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master: { listItems: async () => [] } }, dailySiteReport: { photoUrl: vi.fn() } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'o1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.realRole }) }));

import SiteReportDetail from './SiteReportDetail';

const make = (status: string, extra: Partial<DsrReportDetail['report']> = {}): DsrReportDetail => ({
  report: {
    id: 'r1', org_id: 'o1', project_id: 'p1', work_order_id: 'w1', work_date: '2026-03-10', status: status as DsrReportDetail['report']['status'],
    version: 1, supersedes_id: null, superseded_at: null, correction_reason: null, author_id: 'eng', submitted_at: null, validated_by: null,
    validated_at: null, returned_reason: null, variant_id: null, start_time: '07:00:00', end_time: '17:30:00', total_minutes: 630,
    weather_id: null, weather_note: null, note: null, ...extra,
  },
  workOrder: { label: 'WO-1 · Pipe run', currency: 'USD', orderValue: 1000 },
  progress: [
    { id: 'pl1', position: 1, work_order_line_id: 'l1', sub_stage: null, quantity: 10, unit: 'm' },
    { id: 'pl2', position: 2, work_order_line_id: 'l2', sub_stage: null, quantity: 2, unit: 'ea' },
  ],
  idle: [], consumables: [],
  photos: [{ id: 'ph1', kind: 'paper_form', file_path: 'o1/r1/x/form.jpg', created_at: '2026-03-10T10:00:00Z' }],
  events: [
    { id: 'e1', action: 'created', actor_id: 'eng', reason: null, at: '2026-03-10T08:00:00Z' },
    { id: 'e2', action: 'returned', actor_id: 'fin', reason: 'Quantity looks too high', at: '2026-03-11T08:00:00Z' },
  ],
});

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/site-reports/r1']}>
      <ToastProvider><Routes><Route path="/site-reports/:reportId" element={<SiteReportDetail />} /></Routes></ToastProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => {
  h.userId = 'eng'; h.realRole = 'Engineer'; h.pm = 'pm'; h.equipment = []; h.peopleHours = '8';
  h.revenue = [{ line_id: 'pl1', rate: 5, rate_source: 'catalogue', amount: 50, frozen: false }, { line_id: 'pl2', rate: null, rate_source: null, amount: null, frozen: false }];
  Object.values(h.m).forEach((x) => x.mutateAsync.mockReset());
});

describe('site report record', () => {
  it('AC-DSR-013 the field author can save and submit a draft, sees no Validate and no money', () => {
    h.detail = make('draft');
    renderPage();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validate' })).toBeNull();
    expect(screen.queryByTestId('dsr-total')).toBeNull();
    expect(screen.queryAllByTestId('dsr-line-amount')).toHaveLength(0);
  });

  it('AC-DSR-005 the author is never offered Validate, even as Admin', () => {
    h.detail = make('submitted'); h.realRole = 'Admin';
    renderPage();
    expect(screen.queryByRole('button', { name: 'Validate' })).toBeNull();
  });

  it('AC-DSR-004 a validator sees the exact day total and "No rate" on the unpriced line', () => {
    h.detail = make('submitted'); h.userId = 'fin'; h.realRole = 'Finance';
    renderPage();
    expect(screen.getByRole('button', { name: 'Validate' })).toBeEnabled();
    expect(screen.getByTestId('dsr-total')).toHaveTextContent('50.00');
    const amounts = screen.getAllByTestId('dsr-line-amount');
    expect(amounts[0]).toHaveTextContent('50.00');
    expect(within(amounts[1]).getByText('No rate')).toBeInTheDocument();
  });

  it('AC-DSR-005 a validator validates through the RPC', async () => {
    h.detail = make('submitted'); h.userId = 'fin'; h.realRole = 'Finance';
    h.m.validate.mutateAsync.mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Validate' }));
    expect(h.m.validate.mutateAsync).toHaveBeenCalledWith('r1');
  });

  it('AC-DSR-008 a returned report shows its reason and lets the author edit and resubmit', async () => {
    h.detail = make('returned', { returned_reason: 'Quantity looks too high' });
    h.m.save.mutateAsync.mockResolvedValue('r1'); h.m.submit.mutateAsync.mockResolvedValue(undefined);
    renderPage();
    expect(screen.getByTestId('dsr-returned')).toHaveTextContent('Quantity looks too high');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(h.m.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', workOrderId: 'w1' }));
    expect(h.m.submit.mutateAsync).toHaveBeenCalledWith('r1');
  });

  it('a draft with an invalid quantity is not saved', async () => {
    h.detail = make('draft');
    renderPage();
    const qty = screen.getAllByLabelText(/Quantity/)[0];
    await userEvent.clear(qty);
    await userEvent.type(qty, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(h.m.save.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('More than 0, up to 3 decimals')).toBeInTheDocument();
  });

  it('AC-DSR-011 equipment hours on the work order and date are shown from usage entries', () => {
    h.detail = make('validated', { validated_by: 'fin', validated_at: '2026-03-11T09:00:00Z' });
    h.equipment = [{ id: 'eq1', asset_name: 'Excavator 2', quantity: 6.5, unit: 'hours', kind: 'work', status: 'Approved' }];
    renderPage();
    const block = screen.getByTestId('dsr-equipment');
    expect(within(block).getByText('Excavator 2')).toBeInTheDocument();
    expect(within(block).getByText(/6.5/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  });

  it('#2619 people hours show the figure the hours read returns for the whole crew', () => {
    h.detail = make('validated', { validated_by: 'fin', validated_at: '2026-03-11T09:00:00Z' });
    h.peopleHours = '42.5';
    renderPage();
    expect(within(screen.getByTestId('dsr-equipment')).getByText('42.5')).toBeInTheDocument();
  });

  it('a validated report offers Correct to a validator, not to its field author', () => {
    h.detail = make('validated', { validated_by: 'fin', validated_at: '2026-03-11T09:00:00Z' });
    renderPage();
    expect(screen.queryByRole('button', { name: 'Correct' })).toBeNull();
  });
});
