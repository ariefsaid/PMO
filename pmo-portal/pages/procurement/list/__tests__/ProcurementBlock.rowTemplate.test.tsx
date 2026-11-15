import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ProcurementBlock } from '@/src/components/procurement/ProcurementBlock';

/**
 * #2134: the company list row fits 1440 — age rides in the identity line, the raiser is an avatar with
 * initials, paid / invoiced is the Value cell's second line — and the stage strip carries the figures the
 * separate summary tiles used to (the unpaid supplier-invoice balance sits on the Pay chip).
 */
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const makeRow = (over: Record<string, unknown> = {}) => ({
  id: 'p-1', code: 'PR-1', title: 'Inverters', status: 'Vendor Invoiced', total_value: 500, approved_total_value: null, currency: 'USD',
  project_id: 'proj-1', budget_category: 'Materials', requested_by_id: 'u-requester', approved_by_id: 'u-approver', vendor_id: 'v-1',
  created_at: daysAgo(40), updated_at: daysAgo(40), status_events: [{ to_status: 'Vendor Invoiced', created_at: daysAgo(10) }],
  project: { name: 'Site', code: 'P1' }, vendor: { name: 'Acme Supply' }, requested_by: { full_name: 'Rina Requester' },
  purchase_requests: [], purchase_orders: [], receipts: [],
  procurement_invoices: [{ amount: 300, erp_outstanding_amount: 200, invoice_date: daysAgo(12).slice(0, 10) }],
  payments: [{ amount: 100, status: 'Paid' }],
  ...over,
});

const procState = { data: [makeRow()] as unknown[], isPending: false, isError: false, refetch: vi.fn() };
const authState = { userId: 'u-finance', role: 'Finance' };
const exportSpy = vi.hoisted(() => vi.fn(async (_rows: unknown[], ..._args: unknown[]) => undefined));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx: exportSpy, busy: false }) }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isError: false, isPending: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: new Date().toISOString().slice(0, 10), isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: undefined, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: authState.role, effectiveRole: authState.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: authState.userId, org_id: 'org-1' }, role: authState.role }) }));

const renderBlock = (props: Partial<React.ComponentProps<typeof ProcurementBlock>> = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/procurement']}><ToastProvider><Routes>
      <Route path="/procurement" element={<ProcurementBlock showCreate={false} {...props} />} />
    </Routes></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);
const rowOf = (title: string) => screen.getByRole('button', { name: `Open ${title}` }).closest('tr')!;
const headers = () => screen.getAllByRole('columnheader').map((header) => header.textContent ?? '');

describe('Procurement row template fits the 1440 column budget (#2134)', () => {
  beforeEach(() => {
    procState.data = [makeRow()];
    authState.userId = 'u-finance';
    authState.role = 'Finance';
    exportSpy.mockClear();
  });

  it('has no separate In stage or Paid / invoiced column; Value, Status, Next step and Raised by stay', () => {
    renderBlock();
    const names = headers();
    expect(names.some((name) => /^Value/.test(name))).toBe(true);
    expect(names.some((name) => /^Status/.test(name))).toBe(true);
    expect(names.some((name) => /^Next step/.test(name))).toBe(true);
    expect(names.some((name) => /^Raised by/.test(name))).toBe(true);
    expect(names.some((name) => /In stage|Paid \/ invoiced/.test(name))).toBe(false);
  });

  it('shows the days in stage on the identity line, after the code and supplier', () => {
    renderBlock();
    const identity = within(rowOf('Inverters')).getByRole('rowheader');
    expect(identity).toHaveTextContent('PR-1 · Acme Supply · 10 days in stage');
  });

  it('shows the raiser as initials, with the full name kept as its accessible name and title', () => {
    renderBlock();
    const avatar = within(rowOf('Inverters')).getByRole('img', { name: 'Rina Requester' });
    expect(avatar).toHaveTextContent('RR');
    expect(avatar).toHaveAttribute('title', 'Rina Requester');
    expect(rowOf('Inverters')).not.toHaveTextContent('Rina Requester');
  });

  it('a request with no raiser says Unassigned, not a person-like avatar', () => {
    procState.data = [makeRow({ requested_by_id: null, requested_by: null })];
    renderBlock();
    expect(within(rowOf('Inverters')).getByText('Unassigned')).toBeInTheDocument();
    expect(within(rowOf('Inverters')).queryByRole('img')).toBeNull();
  });

  it('folds paid / invoiced under the amount as a rounded percent, the exact pair in its title', () => {
    renderBlock();
    const settlement = within(rowOf('Inverters')).getByText('33%');
    expect(settlement).toHaveAttribute('title', '$100 / $300');
  });

  it('keeps the full status name on the stage pill title, so a truncated pill is still readable', () => {
    renderBlock();
    expect(within(rowOf('Inverters')).getByTitle('Supplier invoice')).toHaveTextContent('Supplier invoice');
  });

  it('Status sort orders by stage, then by days in stage', async () => {
    procState.data = [
      makeRow({ id: 'a', title: 'Older order', status: 'Ordered', status_events: [{ to_status: 'Ordered', created_at: daysAgo(20) }], procurement_invoices: [], payments: [] }),
      makeRow({ id: 'b', title: 'Newer order', status: 'Ordered', status_events: [{ to_status: 'Ordered', created_at: daysAgo(2) }], procurement_invoices: [], payments: [] }),
      makeRow({ id: 'c', title: 'Middle order', status: 'Ordered', status_events: [{ to_status: 'Ordered', created_at: daysAgo(9) }], procurement_invoices: [], payments: [] }),
    ];
    renderBlock();
    const order = () => screen.getAllByRole('button', { name: /^Open / }).map((button) => button.getAttribute('aria-label')!.replace('Open ', ''));
    await userEvent.click(screen.getByRole('button', { name: /^Status/ }));
    expect(order()).toEqual(['Newer order', 'Middle order', 'Older order']);
    await userEvent.click(screen.getByRole('button', { name: /^Status/ }));
    expect(order()).toEqual(['Older order', 'Middle order', 'Newer order']);
  });

  it('the export still carries days in stage, paid / invoiced and the raiser full name', async () => {
    renderBlock();
    await userEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]!);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Export' }));
    const columns = exportSpy.mock.calls[0]?.[1] as Array<{ header: string; exportValue?: (row: unknown) => unknown }>;
    const byHeader = (header: string) => columns.find((column) => column.header === header)!;
    const row = procState.data[0];
    expect(byHeader('In stage').exportValue!(row)).toBe(10);
    expect(byHeader('Paid / invoiced').exportValue!(row)).toBe('100 / 300');
    expect(byHeader('Raised by').exportValue!(row)).toBe('Rina Requester');
  });
});

describe('Procurement stage strip carries the summary figures (#2134)', () => {
  beforeEach(() => {
    authState.userId = 'u-finance';
    authState.role = 'Finance';
  });

  it('the Pay chip carries the unpaid supplier-invoice balance and the oldest invoice age', () => {
    procState.data = [makeRow(), makeRow({ id: 'p-2', title: 'Cables', status: 'Ordered', purchase_orders: [{ amount: 900 }], procurement_invoices: [], payments: [] })];
    renderBlock();
    const strip = screen.getByRole('group', { name: 'Procurement stages' });
    const pay = within(strip).getByRole('button', { name: /^Pay/ });
    expect(within(pay).getByTestId('summary-total-unpaid')).toHaveTextContent('$200 unpaid');
    expect(within(pay).getByTestId('summary-total-unpaid')).toHaveAttribute('title', expect.stringMatching(/unpaid balance/i));
    expect(pay).toHaveTextContent(/Invoice age 12 days/);
    // Ordered, not invoiced is the Order chip itself: its count and amount.
    expect(within(strip).getByRole('button', { name: /^Order/ })).toHaveTextContent(/Order\s*1\s*\$900/);
  });

  it('the stage chips still filter the rows', async () => {
    procState.data = [makeRow(), makeRow({ id: 'p-2', title: 'Cables', status: 'Ordered', procurement_invoices: [], payments: [] })];
    renderBlock();
    await userEvent.click(within(screen.getByRole('group', { name: 'Procurement stages' })).getByRole('button', { name: /^Order/ }));
    expect(screen.getByRole('button', { name: 'Open Cables' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Inverters' })).not.toBeInTheDocument();
  });

  it('a host can hide the strip (the Needs-you queue) and the rows remain', () => {
    procState.data = [makeRow()];
    renderBlock({ showStageStrip: false });
    expect(screen.queryByRole('group', { name: 'Procurement stages' })).toBeNull();
    expect(screen.queryByTestId('summary-total-unpaid')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Inverters' })).toBeInTheDocument();
  });

  it('an Engineer sees request amounts only on the strip, with that basis named, and no unpaid figure', () => {
    authState.userId = 'u-requester';
    authState.role = 'Engineer';
    procState.data = [makeRow({ status: 'Ordered', total_value: 1_000, purchase_orders: [{ amount: 900 }], procurement_invoices: [], payments: [] })];
    renderBlock();
    const strip = screen.getByRole('group', { name: 'Procurement stages' });
    const total = within(strip).getByTestId('stage-total-Order');
    expect(total).toHaveTextContent('$1K');
    expect(total).toHaveAttribute('title', expect.stringMatching(/supplier invoice and payment amounts are not shown/i));
    expect(screen.queryByTestId('summary-total-unpaid')).toBeNull();
  });
});
