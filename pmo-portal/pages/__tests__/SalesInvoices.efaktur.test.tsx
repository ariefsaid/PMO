import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { SalesInvoiceRow } from '@/src/lib/db/revenue';
import { formatDateOnly } from '@/src/lib/format';
import { FinanceI18nTestProvider } from './financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from './financeI18nTestInstance';

const h = vi.hoisted(() => ({
  invoices: [] as SalesInvoiceRow[],
  projectOptions: [{ value: 'project-1', label: 'Project North' }],
  projectOptionsPending: false,
  projectOptionsError: false,
  setEfaktur: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/hooks/useRevenue', () => ({
  useAssignInvoiceProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSalesInvoices: () => ({ data: h.invoices, isPending: false, isError: false, refetch: vi.fn() }),
  useRevenueMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    setReceivedDate: { mutateAsync: vi.fn(), isPending: false },
    setEfaktur: { mutateAsync: h.setEfaktur, isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-test', org_id: 'org-test' } }) }));
vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useInvoiceProjectOptions: () => ({ data: h.projectOptions, isPending: h.projectOptionsPending, isError: h.projectOptionsError }),
  useClientCompanyOptions: () => ({ data: [] }),
}));
type Analytics = typeof import('@/src/lib/analytics');
vi.mock('@/src/lib/analytics', async importOriginal => ({
  ...await importOriginal<Analytics>(),
  trackFilterApplied: vi.fn<Analytics['trackFilterApplied']>(),
  trackSaveFailed: vi.fn<Analytics['trackSaveFailed']>(),
} satisfies Analytics));

import SalesInvoices from '../SalesInvoices';

const invoice = (id: string, status: SalesInvoiceRow['status'], number: string | null, date: string | null): SalesInvoiceRow => ({
  id, org_id: 'org-test', project_id: null, erp_project: null, customer_id: null, customer_name: 'Customer',
  si_number: `SI-${id}`, reference_number: null, invoice_date: '2026-10-01', amount: 100,
  currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 0, erp_outstanding_amount: 100,
  status, erp_docstatus: status === 'Cancelled' ? 2 : 1, erp_modified: null, erp_amended_from: null,
  erp_cancelled_at: status === 'Cancelled' ? '2026-10-01T00:00:00Z' : null,
  created_at: '2026-10-01T00:00:00Z', author_user_id: null, author_user_ids: [],
  erp_payment_terms_days: null, erp_due_date: null, received_date: null,
  efaktur_number: number, efaktur_date: date,
});

/** `siNumber`'s cell under the column headed `header`. */
function cellOf(siNumber: string, header: string): HTMLElement {
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
  const col = headers.indexOf(header);
  expect(col).toBeGreaterThanOrEqual(0);
  const row = screen.getByText(siNumber).closest('tr');
  if (!row) throw new Error(`no table row for ${siNumber}`);
  return within(row).getAllByRole('cell')[col];
}

function renderAs(role: Role) {
  return render(
    // The page's PDF hook (#912) reads the query cache — give it the standard provider.
    <FinanceI18nTestProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ImpersonationProvider realRole={role}>
          <MemoryRouter><ToastProvider><SalesInvoices /></ToastProvider></MemoryRouter>
        </ImpersonationProvider>
      </QueryClientProvider>
    </FinanceI18nTestProvider>,
  );
}

beforeEach(async () => {
  await financeTestI18nReady;
  await financeTestI18n.changeLanguage('en');
  h.invoices = [invoice('one', 'Submitted', '010.001-26.12345678', '2026-09-28'), invoice('two', 'Draft', null, null)];
  h.projectOptions = [{ value: 'project-1', label: 'Project North' }];
  h.projectOptionsPending = false;
  h.projectOptionsError = false;
  h.setEfaktur.mockReset().mockResolvedValue(undefined);
});

describe('SalesInvoices e-Faktur details', () => {
  it('UXS-042 formats invoice amount and outstanding in tabular UI numerals, not the identifier typeface', () => {
    renderAs('Finance');
    for (const header of ['Amount', 'Outstanding']) {
      const money = within(cellOf('SI-one', header)).getByText(/IDR/, { selector: 'span.tabular' });
      expect(money).toHaveClass('tabular');
      expect(money).not.toHaveClass('font-mono');
    }
  });

  it('AC-EFK-004 shows number + date in ONE e-Faktur cell after Due Date, and an honest dash when empty', () => {
    renderAs('Finance');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    // one merged column (a second one pushed the row ⋯ trigger out of the 1440 view), placed after Due Date
    expect(headers).not.toContain('e-Faktur number');
    expect(headers).not.toContain('e-Faktur date');
    expect(headers.indexOf('e-Faktur')).toBe(headers.indexOf('Due Date') + 1);

    const cell = cellOf('SI-one', 'e-Faktur');
    const number = within(cell).getByText('010.001-26.12345678');
    expect(number).toHaveClass('font-mono'); // machine-ID style, as Invoice #
    // the e-Faktur date is its own fact (not the 2026-10-01 invoice date), as a muted second line
    const date = within(cell).getByText(formatDateOnly('2026-09-28'));
    expect(date).toHaveClass('text-muted-foreground');
    expect(cellOf('SI-two', 'e-Faktur').textContent?.trim()).toBe('—');
  });

  it('AC-EFK-004 offers Record e-Faktur to Finance/Admin across Draft, Submitted, and Paid but not PM/Executive', async () => {
    h.invoices = [invoice('draft', 'Draft', null, null), invoice('issued', 'Submitted', null, null), invoice('paid', 'Paid', null, null)];
    for (const role of ['Finance', 'Admin'] as const) {
      const { unmount } = renderAs(role);
      for (const id of ['draft', 'issued', 'paid']) {
        const row = screen.getByText(`SI-${id}`).closest('tr');
        if (!row) throw new Error(`no table row for SI-${id}`);
        fireEvent.click(within(row).getByRole('button', { name: 'Row actions' }));
        expect(screen.getByRole('menuitem', { name: 'Record e-Faktur' })).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      }
      unmount();
    }
    renderAs('Project Manager');
    expect(screen.getAllByRole('button', { name: 'Row actions' })).toHaveLength(3);
    await fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    expect(screen.getByRole('menuitem', { name: 'View invoice' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it.each(['en', 'id'] as const)('AC-UXT-006 keeps sales e-Faktur identities human across project lookup states in %s', async (locale) => {
    await financeTestI18n.changeLanguage(locale);
    const copy = locale === 'en'
      ? {
          issued: 'Issued sales invoice number: SI-issued', draft: 'Draft invoice', project: 'Project: Project North',
          pending: 'Project: Project details loading', unavailable: 'Project: Project details unavailable',
          notRecorded: 'Project: Project not recorded', customer: 'Customer: Acme customer', customerResolved: 'Customer: Customer', customerMissing: 'Customer: Customer not recorded',
          instruction: 'Copy the number from the issued e-Faktur document.',
        }
      : {
          issued: 'Nomor faktur penjualan terbit: SI-issued', draft: 'Draf faktur', project: 'Proyek: Project North',
          pending: 'Proyek: Detail proyek sedang dimuat', unavailable: 'Proyek: Detail proyek tidak tersedia',
          notRecorded: 'Proyek: Proyek belum dicatat', customer: 'Pelanggan: Acme customer', customerResolved: 'Pelanggan: Customer', customerMissing: 'Pelanggan: Pelanggan belum dicatat',
          instruction: 'Salin nomor dari dokumen e-Faktur yang diterbitkan.',
        };
    const scenarios = [
      {
        row: { ...invoice('f29c4a00-3929-4c13-a470-6d2aa43ae001', 'Submitted', '010.001-26.12345678', '2026-09-28'), si_number: 'SI-issued' },
        options: [{ value: 'project-1', label: 'Project North' }], pending: false, error: false, expected: [copy.issued],
      },
      {
        row: { ...invoice('resolved', 'Draft', null, null), si_number: null, project_id: 'project-1' },
        options: [{ value: 'project-1', label: 'Project North' }], pending: false, error: false, expected: [copy.draft, copy.project, copy.customerResolved],
      },
      {
        row: { ...invoice('pending-project', 'Draft', null, null), si_number: null, project_id: 'project-pending' },
        options: [], pending: true, error: false, expected: [copy.draft, copy.pending],
      },
      {
        row: { ...invoice('missing-project', 'Draft', null, null), si_number: null, project_id: 'project-missing', customer_name: 'Acme customer' },
        options: [], pending: false, error: false, expected: [copy.draft, copy.unavailable, copy.customer],
      },
      {
        row: { ...invoice('no-context', 'Draft', null, null), si_number: null, project_id: null, customer_name: null },
        options: [], pending: false, error: false, expected: [copy.draft, copy.notRecorded, copy.customerMissing],
      },
    ];

    for (const scenario of scenarios) {
      h.invoices = [scenario.row];
      h.projectOptions = scenario.options;
      h.projectOptionsPending = scenario.pending;
      h.projectOptionsError = scenario.error;
      const rendered = renderAs('Finance');
      const action = screen.getAllByRole('button').find((button) => button.getAttribute('aria-haspopup') === 'menu');
      if (!action) throw new Error('No sales invoice row action');
      fireEvent.click(action);
      fireEvent.click(screen.getByRole('menuitem', { name: financeTestI18n.t('efaktur.record') }));
      const dialog = screen.getByRole('dialog');
      for (const text of scenario.expected) expect(dialog).toHaveTextContent(text);
      expect(dialog).toHaveTextContent(copy.instruction);
      expect(dialog).not.toHaveTextContent(scenario.row.id);
      rendered.unmount();
    }
  });

  it('AC-EFK-004 does not offer e-Faktur editing on cancelled invoices', () => {
    h.invoices = [invoice('cancelled', 'Cancelled', '010-01', '2026-10-01')];
    renderAs('Finance');
    fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menuitem', { name: 'View invoice' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Record e-Faktur' })).not.toBeInTheDocument();
  });

  it('AC-EFK-004 saves trimmed values through setEfaktur and keeps a classified failure in the open dialog', async () => {
    renderAs('Finance');
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Record e-Faktur' }));
    fireEvent.change(screen.getByLabelText('e-Faktur number'), { target: { value: ' 010.001-26.12345678 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.setEfaktur).toHaveBeenCalledWith({
      siId: 'one', efakturNumber: '010.001-26.12345678', efakturDate: '2026-09-28',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    h.setEfaktur.mockRejectedValueOnce(Object.assign(new Error('save refused'), { code: '42501' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Row actions' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Record e-Faktur' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert', { name: 'Save failed' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
