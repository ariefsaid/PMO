import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ProcurementBlock } from '@/src/components/procurement/ProcurementBlock';

const makeRow = (over: Record<string, unknown> = {}) => ({
  id: 'p-1', code: 'PR-1', title: 'Inverters', status: 'Vendor Invoiced', total_value: 62_000, approved_total_value: null, currency: 'USD',
  project_id: 'proj-1', budget_category: 'Materials', requested_by_id: 'u-requester', approved_by_id: 'u-approver', vendor_id: 'v-1',
  created_at: '2026-10-27T00:00:00.000Z', updated_at: '2026-10-27T00:00:00.000Z', status_events: [],
  project: { name: 'Site', code: 'P1' }, vendor: { name: 'Acme Supply' }, requested_by: { full_name: 'Rina Requester' },
  purchase_requests: [], purchase_orders: [], receipts: [], procurement_invoices: [{ amount: 62_000, erp_outstanding_amount: 62_000, invoice_date: '2026-10-20' }], payments: [],
  ...over,
});

const procState = { data: [makeRow()] as unknown[], isPending: false, isError: false, refetch: vi.fn() };
const authState = { userId: 'u-finance', role: 'Finance' };
const transitionSpy = vi.hoisted(() => vi.fn(async () => undefined));
const exportSpy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/src/lib/repositories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/repositories')>();
  return { ...actual, repositories: { ...actual.repositories, procurement: { ...actual.repositories.procurement, transition: transitionSpy } } };
});
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx: exportSpy, busy: false }) }));
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: [], isError: false, isPending: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({
  useProcurementDetail: (id?: string) => {
    const found = (procState.data as Array<ReturnType<typeof makeRow>>).find((candidate) => candidate.id === id);
    return { data: found ? { ...found, items: [{ id: 'item-1', name: 'Inverter', quantity: 2 }], quotations: [], invoices: found.procurement_invoices } : undefined, isPending: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock('@/src/hooks/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: authState.role, effectiveRole: authState.role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: authState.userId, org_id: 'org-1' }, role: authState.role }) }));

const RouteProbe = () => {
  const location = useLocation();
  return <output data-testid="route-probe" data-state={JSON.stringify(location.state ?? null)}>{location.pathname}</output>;
};
const renderBlock = (path = '/procurement') => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <MemoryRouter initialEntries={[path]}><ToastProvider><Routes>
      <Route path="/procurement" element={<ProcurementBlock showCreate={false} />} />
      <Route path="/procurement/:procurementId" element={<RouteProbe />} />
      <Route path="*" element={<RouteProbe />} />
    </Routes></ToastProvider></MemoryRouter>
  </QueryClientProvider>,
);
const select = async (title: string) => userEvent.click(screen.getByRole('checkbox', { name: `Select ${title}` }));
const openFirstRowMenu = async () => {
  await userEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]!);
};

beforeEach(() => {
  procState.data = [makeRow()];
  authState.userId = 'u-finance';
  authState.role = 'Finance';
  transitionSpy.mockClear();
  exportSpy.mockClear();
  sessionStorage.clear();
  window.matchMedia = ((query: string) => ({ matches: query.includes('min-width:'), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});

describe('ProcurementBlock floor controls', () => {
  it('floor: Select visible checks every filtered row and updates the selected count', async () => {
    procState.data = [makeRow(), makeRow({ id: 'p-2', code: 'PR-2', title: 'Batteries' })];
    renderBlock();
    await select('Inverters');
    await userEvent.click(screen.getByRole('button', { name: 'Select visible' }));
    expect(screen.getByRole('checkbox', { name: 'Select Inverters' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Batteries' })).toBeChecked();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('floor: Clear visible unchecks visible rows and preserves hidden selections', async () => {
    procState.data = [
      makeRow({ status: 'Requested', approved_by_id: null }),
      makeRow({ id: 'p-2', code: 'PR-2', title: 'Batteries', status: 'Ordered' }),
    ];
    renderBlock();
    const stageBand = screen.getByRole('group', { name: 'Procurement stages' });
    const requestStage = within(stageBand).getByRole('button', { name: /^Request/ });
    const orderStage = within(stageBand).getByRole('button', { name: /^Order/ });

    await userEvent.click(requestStage);
    await select('Inverters');
    await userEvent.click(orderStage);
    await userEvent.click(screen.getByRole('button', { name: 'Select visible' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear visible' }));
    expect(screen.getByRole('checkbox', { name: 'Select Batteries' })).not.toBeChecked();
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    await userEvent.click(requestStage);
    expect(screen.getByRole('checkbox', { name: 'Select Inverters' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Clear visible' }));
    expect(screen.getByRole('checkbox', { name: 'Select Inverters' })).not.toBeChecked();
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it('floor: Bulk Approve confirms then transitions only selected procurement ids', async () => {
    procState.data = [makeRow({ status: 'Requested', approved_by_id: null }), makeRow({ id: 'p-2', title: 'Batteries', status: 'Requested', approved_by_id: null })];
    await renderBlock();
    await select('Inverters');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const confirm = await screen.findByRole('dialog', { name: 'Approve this procurement?' });
    expect(transitionSpy).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(transitionSpy).toHaveBeenCalledTimes(1));
    expect(transitionSpy).toHaveBeenCalledWith('p-1', 'Approved');
  });

  it('floor: Bulk Return sends the entered reason with only selected procurement ids', async () => {
    procState.data = [makeRow({ status: 'Requested', approved_by_id: null }), makeRow({ id: 'p-2', title: 'Batteries', status: 'Requested', approved_by_id: null })];
    renderBlock();
    await select('Inverters');
    await userEvent.click(screen.getByRole('button', { name: 'Return' }));
    const dialog = await screen.findByRole('dialog', { name: 'Return procurement' });
    await userEvent.type(within(dialog).getByLabelText(/Reason for returning/i), 'Update the quantity');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Return' }));
    await waitFor(() => expect(transitionSpy).toHaveBeenCalledWith('p-1', 'Rejected', 'Update the quantity'));
    expect(transitionSpy).toHaveBeenCalledTimes(1);
  });

  it('floor: Bulk Export passes only selected rows to the export action', async () => {
    procState.data = [makeRow(), makeRow({ id: 'p-2', code: 'PR-2', title: 'Batteries' })];
    renderBlock();
    await select('Inverters');
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(exportSpy).toHaveBeenCalledTimes(1);
    expect(exportSpy.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ id: 'p-1' })]);
  });

  it('floor: Clear selection unchecks rows and closes the selection bar', async () => {
    renderBlock();
    await select('Inverters');
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('checkbox', { name: 'Select Inverters' })).not.toBeChecked();
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
  });

  it('floor: phone next-step button opens the matching procurement record', async () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('max-width: 639px'), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    renderBlock();
    await userEvent.click(screen.getByRole('button', { name: 'Pay' }));
    expect(screen.getByTestId('route-probe')).toHaveTextContent('/procurement/p-1');
  });

  it('floor: Row menu Open procurement opens that record', async () => {
    renderBlock();
    await openFirstRowMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open procurement' }));
    expect(screen.getByTestId('route-probe')).toHaveTextContent('/procurement/p-1');
  });

  it('floor: Row menu Record another document opens that procurement record', async () => {
    renderBlock();
    await openFirstRowMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Record another document' }));
    expect(screen.getByTestId('route-probe')).toHaveTextContent('/procurement/p-1');
  });

  it('floor: Row menu Approve confirms the selected procurement id', async () => {
    procState.data = [makeRow({ status: 'Requested', approved_by_id: null })];
    renderBlock();
    await openFirstRowMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Approve' }));
    const confirm = await screen.findByRole('dialog', { name: 'Approve this procurement?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(transitionSpy).toHaveBeenCalledWith('p-1', 'Approved'));
  });

  it('floor: Row menu Link a file opens the document surface for that procurement', async () => {
    renderBlock();
    await openFirstRowMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Link a file' }));
    expect(screen.getByTestId('route-probe')).toHaveTextContent('/procurement/p-1/documents');
  });

  it('floor: Row menu Export passes just that row to the export action', async () => {
    renderBlock();
    await openFirstRowMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Export' }));
    expect(exportSpy).toHaveBeenCalledTimes(1);
    expect(exportSpy.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ id: 'p-1' })]);
  });

  it('floor: Copy link writes the selected procurement URL and announces success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderBlock();
    await openFirstRowMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/procurement/p-1`));
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('floor: Cancel procurement confirms then transitions that row to Cancelled', async () => {
    procState.data = [makeRow({ status: 'Requested', approved_by_id: null })];
    renderBlock();
    await openFirstRowMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancel procurement' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Cancel this procurement?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel procurement' }));
    await waitFor(() => expect(transitionSpy).toHaveBeenCalledWith('p-1', 'Cancelled'));
  });

  it('floor: Drawer More procurement actions opens its action menu', async () => {
    renderBlock('/procurement?open=p-1');
    const drawer = screen.getByRole('dialog');
    await userEvent.click(within(drawer).getByRole('button', { name: 'More procurement actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Record another document' })).toBeInTheDocument();
  });

  it('floor: Procurement sort orders titles ascending then descending', async () => {
    procState.data = [makeRow({ id: 'p-b', title: 'Bravo' }), makeRow({ id: 'p-a', title: 'Alpha' }), makeRow({ id: 'p-c', title: 'Charlie' })];
    renderBlock();
    const order = () => screen.getAllByRole('button', { name: /^Open / }).map((button) => button.getAttribute('aria-label')!.replace('Open ', ''));
    await userEvent.click(screen.getByRole('button', { name: /^Procurement/ }));
    expect(order()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    await userEvent.click(screen.getByRole('button', { name: /^Procurement/ }));
    expect(order()).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('floor: Category sort orders categories ascending then descending', async () => {
    procState.data = [makeRow({ id: 'p-s', title: 'Services row', budget_category: 'Services' }), makeRow({ id: 'p-m', title: 'Materials row', budget_category: 'Materials' })];
    renderBlock();
    const order = () => screen.getAllByRole('button', { name: /^Open / }).map((button) => button.getAttribute('aria-label')!.replace('Open ', ''));
    await userEvent.click(screen.getByRole('button', { name: /^Category/ }));
    expect(order()).toEqual(['Materials row', 'Services row']);
    await userEvent.click(screen.getByRole('button', { name: /^Category/ }));
    expect(order()).toEqual(['Services row', 'Materials row']);
  });

  it('floor: Status sort orders status labels ascending then descending', async () => {
    procState.data = [makeRow({ id: 'p-d', title: 'Draft row', status: 'Draft' }), makeRow({ id: 'p-a', title: 'Approved row', status: 'Approved' })];
    renderBlock();
    const order = () => screen.getAllByRole('button', { name: /^Open / }).map((button) => button.getAttribute('aria-label')!.replace('Open ', ''));
    await userEvent.click(screen.getByRole('button', { name: /^Status/ }));
    expect(order()).toEqual(['Approved row', 'Draft row']);
    await userEvent.click(screen.getByRole('button', { name: /^Status/ }));
    expect(order()).toEqual(['Draft row', 'Approved row']);
  });

  it('floor: Raised by sort orders owners ascending then descending', async () => {
    procState.data = [makeRow({ id: 'p-r', title: 'Rina row', requested_by: { full_name: 'Rina' } }), makeRow({ id: 'p-a', title: 'Alice row', requested_by: { full_name: 'Alice' } }), makeRow({ id: 'p-z', title: 'Zoe row', requested_by: { full_name: 'Zoe' } })];
    renderBlock();
    const order = () => screen.getAllByRole('button', { name: /^Open / }).map((button) => button.getAttribute('aria-label')!.replace('Open ', ''));
    await userEvent.click(screen.getByRole('button', { name: /^Raised by/ }));
    expect(order()).toEqual(['Alice row', 'Rina row', 'Zoe row']);
    await userEvent.click(screen.getByRole('button', { name: /^Raised by/ }));
    expect(order()).toEqual(['Zoe row', 'Rina row', 'Alice row']);
  });
});
