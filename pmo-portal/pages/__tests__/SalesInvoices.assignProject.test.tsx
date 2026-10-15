import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

const h = vi.hoisted(() => ({
  invoices: [] as SalesInvoiceRow[],
  assignProject: vi.fn().mockResolvedValue(undefined),
  refetchProjects: vi.fn().mockResolvedValue({ data: [{ value: 'project-1', label: 'Project One' }], error: null }),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: h.invoices, isPending: false, isError: false, refetch: vi.fn() }),
  useRevenueMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false }, submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false }, pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
  useAssignInvoiceProject: () => ({ mutateAsync: h.assignProject, isPending: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-test', org_id: 'org-test' } }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'erp' }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useInvoiceProjectOptions: () => ({ data: [{ value: 'project-1', label: 'Project One' }], refetch: h.refetchProjects }),
  useClientCompanyOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useInvoicePdfDownload', () => ({ useInvoicePdfDownload: () => ({ inFlightIds: new Set(), download: vi.fn() }) }));
vi.mock('@/src/lib/analytics', () => ({ trackFilterApplied: vi.fn(), trackSaveFailed: vi.fn() }));

import SalesInvoices from '../SalesInvoices';

const invoice = (id: string, projectId: string | null, overrides: Partial<SalesInvoiceRow> = {}): SalesInvoiceRow => ({
  id, org_id: 'org-test', project_id: projectId, erp_project: null, customer_id: null, customer_name: 'Customer',
  si_number: `SI-${id}`, reference_number: null, invoice_date: '2026-10-01', amount: 100,
  currency: 'USD', tax_treatment: 'inclusive', tax_amount: 0, erp_outstanding_amount: 100,
  status: 'Unpaid', erp_docstatus: 1, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-10-01T00:00:00Z', author_user_id: null, author_user_ids: [], pmo_native: false,
  erp_payment_terms_days: null, erp_due_date: null, received_date: null, efaktur_number: null, efaktur_date: null,
  ...overrides,
});

function renderAs(role: Role, entry = '/sales-invoices') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ImpersonationProvider realRole={role} demoEligibility="eligible">
      <MemoryRouter initialEntries={[entry]}><ToastProvider><SalesInvoices /></ToastProvider></MemoryRouter>
    </ImpersonationProvider>
  </QueryClientProvider>);
}
function rowFor(number: string) {
  const row = screen.getByText(number).closest('tr');
  if (!row) throw new Error(`missing invoice row ${number}`);
  return row;
}
async function openActions(number: string) {
  await userEvent.click(within(rowFor(number)).getByRole('button', { name: 'Row actions' }));
}

beforeEach(() => {
  h.invoices = [invoice('unassigned', null), invoice('assigned', 'project-1')];
  h.assignProject.mockReset().mockResolvedValue(undefined);
  h.refetchProjects.mockReset().mockResolvedValue({ data: [{ value: 'project-1', label: 'Project One' }], error: null });
});

describe('SalesInvoices project attribution', () => {
  it('AC-PFIN-009 Finance/Admin can assign or change eligible invoice attribution; viewers cannot', async () => {
    for (const role of ['Finance', 'Admin'] as const) {
      const { unmount } = renderAs(role);
      await openActions('SI-unassigned');
      expect(screen.getByRole('menuitem', { name: 'Assign project' })).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
      await openActions('SI-assigned');
      expect(screen.getByRole('menuitem', { name: 'Change project' })).toBeInTheDocument();
      unmount();
    }
    for (const role of ['Project Manager', 'Executive'] as const) {
      const { unmount } = renderAs(role);
      await openActions('SI-unassigned');
      expect(screen.queryByRole('menuitem', { name: 'Assign project' })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('AC-PFIN-009 omits attribution actions for native and PMO-authored invoices', async () => {
    h.invoices = [
      invoice('native', null, { pmo_native: true }),
      invoice('authored', null, { author_user_id: 'user-test', author_user_ids: ['user-test'] }),
    ];
    renderAs('Finance');
    for (const number of ['SI-native', 'SI-authored']) {
      await openActions(number);
      expect(screen.queryByRole('menuitem', { name: 'Assign project' })).not.toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    }
  });

  it('AC-PFIN-009 opens the shared modal, filters unassigned before search, and sends the existing project context', async () => {
    renderAs('Finance', '/sales-invoices?attribution=unassigned&status=Unpaid&q=SI-unassigned');
    expect(screen.getByText('Unassigned invoices')).toBeInTheDocument();
    expect(screen.getByText('SI-unassigned')).toBeInTheDocument();
    expect(screen.queryByText('SI-assigned')).not.toBeInTheDocument();
    await openActions('SI-unassigned');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Assign project' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Project One' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save project' }));
    await waitFor(() => expect(h.assignProject).toHaveBeenCalledWith({
      siId: 'unassigned', projectId: 'project-1', oldProjectId: null,
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.queryByText('Unassigned invoices')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search sales invoices' })).toHaveValue('SI-unassigned');
    expect(screen.getByRole('tab', { name: 'Unpaid' })).toHaveAttribute('aria-selected', 'true');
  });
});
