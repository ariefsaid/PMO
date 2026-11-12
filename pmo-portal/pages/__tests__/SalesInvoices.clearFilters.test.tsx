import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';

/**
 * T4 (dropped-restored §2): two different controls on /sales-invoices both read "Clear filter" —
 * the shared FilterBar's (search + status + the attribution filter, i.e. all of them) and the
 * attribution chip's (attribution only). Identical names over different scopes made the reader
 * guess. The chip now names its scope ("Clear attribution"); the bar keeps "Clear all".
 */
const h = vi.hoisted(() => ({ invoices: [] as SalesInvoiceRow[] }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useSalesInvoices: () => ({ data: h.invoices, isPending: false, isError: false, refetch: vi.fn() }),
  useIncomingPayments: () => ({ data: [], isPending: false, isError: false }),
  useRevenueMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false }, setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    setEfaktur: { mutateAsync: vi.fn(), isPending: false }, submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false }, pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
  useAssignInvoiceProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-test', org_id: 'org-test' } }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => 'erp' }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useInvoiceProjectOptions: () => ({ data: [], refetch: vi.fn() }),
  useClientCompanyOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useInvoicePdfDownload', () => ({ useInvoicePdfDownload: () => ({ inFlightIds: new Set(), download: vi.fn() }) }));
vi.mock('@/src/lib/analytics', () => ({ trackFilterApplied: vi.fn(), trackSaveFailed: vi.fn(), trackSearchUsed: vi.fn() }));

import SalesInvoices from '../SalesInvoices';

const invoice = (id: string, projectId: string | null): SalesInvoiceRow => ({
  id, org_id: 'org-test', project_id: projectId, erp_project: null, billing_kind: 'contract', customer_id: null, customer_name: 'Customer',
  si_number: `SI-${id}`, reference_number: null, invoice_date: '2026-10-01', amount: 100,
  currency: 'USD', tax_treatment: 'inclusive', tax_amount: 0, erp_outstanding_amount: 100,
  status: 'Unpaid', erp_docstatus: 1, erp_modified: null, erp_amended_from: null, erp_cancelled_at: null,
  created_at: '2026-10-01T00:00:00Z', author_user_id: null, author_user_ids: [], pmo_native: false,
  erp_payment_terms_days: null, erp_due_date: null, received_date: null, efaktur_number: null, efaktur_date: null,
});

const FILTERED = '/sales-invoices?attribution=unassigned&status=Unpaid&q=SI-unassigned';

function renderFiltered() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole="Finance" demoEligibility="eligible">
        <MemoryRouter initialEntries={[FILTERED]}>
          <ToastProvider><SalesInvoices /></ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
}

const attributionChipButton = () =>
  within(screen.getByText('Unassigned invoices').closest('div') as HTMLElement);

beforeEach(() => {
  h.invoices = [invoice('unassigned', null), invoice('assigned', 'project-1')];
});

describe('T4: the two clear controls name their own scope', () => {
  it('renders distinct names: the bar clears all, the chip clears attribution', () => {
    renderFiltered();
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear attribution' })).toBeInTheDocument();
    // No third, ambiguous "Clear filter" is left on this page.
    expect(screen.queryByRole('button', { name: 'Clear filter' })).not.toBeInTheDocument();
  });

  it('the chip clears attribution only: search and status stay applied', async () => {
    renderFiltered();
    await userEvent.click(attributionChipButton().getByRole('button', { name: 'Clear attribution' }));
    expect(screen.queryByText('Unassigned invoices')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search sales invoices' })).toHaveValue('SI-unassigned');
    expect(screen.getByRole('tab', { name: 'Unpaid' })).toHaveAttribute('aria-selected', 'true');
  });

  it('the bar clears every filter it owns, including attribution', async () => {
    renderFiltered();
    expect(screen.getByText('Unassigned invoices')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.queryByText('Unassigned invoices')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search sales invoices' })).toHaveValue('');
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  });
});
