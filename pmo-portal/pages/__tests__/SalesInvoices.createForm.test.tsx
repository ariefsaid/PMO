import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { getPageAnnouncement } from '@/src/components/ui/__tests__/announcementTestQueries';
import { ImpersonationProvider } from '@/src/auth/impersonation';

/**
 * SalesInvoices — the create-invoice journey (read-model audit BLOCK 1 + 1b).
 *
 * Before the fix a Finance user could NOT raise an invoice from PMO at all: all four money
 * pickers were `loadOptions={async () => []}` stubs, so `customerId` could never leave '' (the
 * Combobox only emits on select), `isComplete` stayed false and "Create invoice" was permanently
 * disabled. And the line items lived in a DETACHED `useState`, so whatever the user typed never
 * reached the submitted `values.lineItems` — a $50,000 invoice would have posted as $0.
 *
 * These tests drive the real journey: open the form, pick a real customer, type a real line item,
 * submit, and assert what the mutation actually receives.
 *
 * NOTE: the affordance gate is stubbed here — this file tests the FORM, not the gate. The gate is
 * owned by src/auth/policy.test.ts (`create salesInvoice` = Finance + Admin, owner ruling 2026-07-20).
 */

const hoisted = vi.hoisted(() => ({
  createMutate: vi.fn(async () => ({ id: 'si-new', si_number: 'ACC-SINV-0001' })),
  salesInvoicesState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  navigateMock: vi.fn(),
  clientOptions: [
    { value: 'cust-1', label: 'Acme Energy', sub: 'Client' },
    { value: 'cust-2', label: 'Borealis Marine', sub: 'Client' },
  ],
  projectOptions: [{ value: 'proj-1', label: 'Alpha Platform', sub: 'ALP-01', clientId: 'cust-1', subjectToVat: false, taxRate: null, archived: false, currency: 'EUR' as string | undefined }],
  clientOptionsQuery: { data: null as unknown, isPending: false, isError: false, refetch: vi.fn() },
  projectOptionsQuery: { data: null as unknown, isPending: false, isError: false, refetch: vi.fn() },
  connected: false,
  revenueMode: 'native' as 'native' | 'erp',
}));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: hoisted.connected, loadOptions: async () => [{ value: 'ITEM-TEST', label: 'ITEM-TEST', sub: 'Test service' }] }) }));
vi.mock('@/src/hooks/useRevenueMode', () => ({ useRevenueMode: () => hoisted.revenueMode }));

// #731: the create form's money adornment reads the org currency. Pinned here rather than left to a
// real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a syntax error.
vi.mock('@/src/hooks/useOrgCurrency', () => ({
  useOrgCurrency: () => 'USD',
  useOrgCurrencyState: () => ({ currency: 'USD', isResolved: true, isError: false }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-12', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useFxRates', () => ({ useFxRate: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useRevenue', () => ({
  useAssignInvoiceProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSalesInvoices: () => hoisted.salesInvoicesState,
  useRevenueMutations: () => ({
    create: { mutateAsync: hoisted.createMutate, isPending: false },
    submitInvoice: { mutateAsync: vi.fn(), isPending: false },
    cancelInvoice: { mutateAsync: vi.fn(), isPending: false },
    pendingPush: { status: 'idle', lastError: null, lastPushAt: null },
  }),
}));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useClientCompanyOptions: () => hoisted.clientOptionsQuery,
  useInvoiceProjectOptions: () => hoisted.projectOptionsQuery,
}));

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => true,
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-fin', org_id: 'org-1' }, role: 'Finance' }),
}));

vi.mock('@/src/lib/adapterSeam/ownershipCache', () => ({ routeDomainWrite: vi.fn(() => 'pmo') }));
vi.mock('@/src/hooks/useExternalDomainOwnership', () => ({ useExternalDomainOwnership: () => ({ data: [], isError: false }) }));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => hoisted.navigateMock };
});

import SalesInvoices from '../SalesInvoices';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { FinanceI18nTestProvider } from './financeI18nTestProvider';
import { financeTestI18n } from './financeI18nTestInstance';

const EN_LOCALE = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
};

const renderPage = (initialEntry = '/sales-invoices') => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const page = () => (
    // The page's PDF hook reads the query cache (AC-PDF-011 list invalidation) — give it the
    // standard provider even though `useRevenue` itself is mocked here.
    <QueryClientProvider client={queryClient}>
      <FinanceI18nTestProvider>
        <ImpersonationProvider realRole="Finance">
          <MemoryRouter initialEntries={[initialEntry]}>
            <ToastProvider>
              <SalesInvoices />
              <LocationProbe />
            </ToastProvider>
          </MemoryRouter>
        </ImpersonationProvider>
      </FinanceI18nTestProvider>
    </QueryClientProvider>
  );
  const result = render(page());
  return { ...result, rerenderPage: () => result.rerender(page()) };
};

/** Opens the create form (the header action; the empty state offers the same button). */
async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /New Invoice/i })[0]);
}

/** Picks `label` in the named picker. */
async function pick(user: ReturnType<typeof userEvent.setup>, picker: string, label: string) {
  await user.click(screen.getByRole('combobox', { name: picker }));
  const option = await screen.findByRole('option', { name: new RegExp(label) });
  await user.click(option);
}

beforeEach(async () => {
  hoisted.createMutate.mockClear();
  hoisted.navigateMock.mockClear();
  hoisted.salesInvoicesState.data = [];
  hoisted.connected = false;
  hoisted.revenueMode = 'native';
  hoisted.clientOptionsQuery = { data: hoisted.clientOptions, isPending: false, isError: false, refetch: vi.fn() };
  hoisted.projectOptionsQuery = { data: hoisted.projectOptions, isPending: false, isError: false, refetch: vi.fn() };
  setActiveLocale(EN_LOCALE);
  await financeTestI18n.changeLanguage('en');
});
afterEach(() => resetActiveLocale());

describe('AC-S15-002 project context on the invoice form', () => {
  it('waits for authorized project and customer options, then opens once with the matching context', async () => {
    hoisted.clientOptionsQuery = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    hoisted.projectOptionsQuery = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    const { rerenderPage } = renderPage('/sales-invoices?create=1&project=proj-1');

    expect(screen.queryByRole('dialog', { name: 'New invoice' })).not.toBeInTheDocument();

    hoisted.projectOptionsQuery = { data: hoisted.projectOptions, isPending: false, isError: false, refetch: vi.fn() };
    rerenderPage();
    expect(screen.queryByRole('dialog', { name: 'New invoice' })).not.toBeInTheDocument();

    hoisted.clientOptionsQuery = { data: hoisted.clientOptions, isPending: false, isError: false, refetch: vi.fn() };
    rerenderPage();
    const dialog = await screen.findByRole('dialog', { name: 'New invoice' });

    expect(within(dialog).getByRole('combobox', { name: 'Customer' })).toHaveTextContent('Acme Energy');
    expect(within(dialog).getByRole('combobox', { name: 'Project' })).toHaveTextContent('Alpha Platform');
    const location = new URL(screen.getByTestId('location').textContent ?? '/sales-invoices', 'https://pmo.test');
    expect(location.searchParams.get('create')).toBeNull();
    expect(location.searchParams.get('project')).toBe('proj-1');

    rerenderPage();
    expect(screen.getAllByRole('dialog', { name: 'New invoice' })).toHaveLength(1);
  });

  it('AC-S15-002 shows the selected project currency on the contextual native rate input', async () => {
    renderPage('/sales-invoices?create=1&project=proj-1');
    const dialog = await screen.findByRole('dialog', { name: 'New invoice' });
    expect(within(dialog).getByText('€')).toBeInTheDocument();
  });

  it('AC-S15-002 never substitutes the organization currency when selected project currency is unavailable', async () => {
    hoisted.projectOptionsQuery = {
      data: [{ ...hoisted.projectOptions[0], currency: undefined }],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderPage('/sales-invoices?create=1&project=proj-1');
    const dialog = await screen.findByRole('dialog', { name: 'New invoice' });
    expect(within(dialog).queryByText('$')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Project currency unavailable.')).toBeInTheDocument();
  });

  it('refuses a project whose customer is not in the authorized client options', async () => {
    hoisted.clientOptionsQuery = {
      data: [{ value: 'cust-2', label: 'Borealis Marine', sub: 'Client' }],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    renderPage('/sales-invoices?create=1&project=proj-1');

    expect(await screen.findByText(/This project or its customer is no longer available/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New invoice' })).not.toBeInTheDocument();
    expect(hoisted.createMutate).not.toHaveBeenCalled();
    const location = new URL(screen.getByTestId('location').textContent ?? '/sales-invoices', 'https://pmo.test');
    expect(location.searchParams.get('create')).toBeNull();
    expect(location.searchParams.get('project')).toBe('proj-1');
  });

  it('offers a retry when authorized options fail, then preserves the project context after they resolve', async () => {
    const refetchClients = vi.fn();
    const refetchProjects = vi.fn();
    hoisted.clientOptionsQuery = { data: undefined, isPending: false, isError: true, refetch: refetchClients };
    hoisted.projectOptionsQuery = { data: undefined, isPending: false, isError: true, refetch: refetchProjects };
    const user = userEvent.setup();
    const { rerenderPage } = renderPage('/sales-invoices?create=1&project=proj-1');

    expect(await screen.findByText(/Project and customer options could not be loaded/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry context' }));
    expect(refetchClients).toHaveBeenCalledOnce();
    expect(refetchProjects).toHaveBeenCalledOnce();

    hoisted.clientOptionsQuery = { data: hoisted.clientOptions, isPending: false, isError: false, refetch: refetchClients };
    hoisted.projectOptionsQuery = { data: hoisted.projectOptions, isPending: false, isError: false, refetch: refetchProjects };
    rerenderPage();
    expect(await screen.findByRole('dialog', { name: 'New invoice' })).toBeInTheDocument();
    expect(screen.queryByText(/Project and customer options could not be loaded/)).not.toBeInTheDocument();
  });

  it('keeps ordinary project filtering and global New Invoice unscoped', async () => {
    const user = userEvent.setup();
    renderPage('/sales-invoices?project=proj-1');

    expect(screen.queryByRole('dialog', { name: 'New invoice' })).not.toBeInTheDocument();
    expect(new URL(screen.getByTestId('location').textContent ?? '/sales-invoices', 'https://pmo.test').searchParams.get('project')).toBe('proj-1');
    await openForm(user);
    const dialog = screen.getByRole('dialog', { name: 'New invoice' });
    expect(within(dialog).getByRole('combobox', { name: 'Customer' })).toHaveTextContent('Select or search customer…');
    expect(within(dialog).getByRole('combobox', { name: 'Project' })).not.toHaveTextContent('Alpha Platform');
  });

  it('clears a contextual project when the user changes to another authorized customer', async () => {
    const user = userEvent.setup();
    renderPage('/sales-invoices?create=1&project=proj-1');
    const dialog = await screen.findByRole('dialog', { name: 'New invoice' });

    await pick(user, 'Customer', 'Borealis Marine');

    expect(within(dialog).getByRole('combobox', { name: 'Customer' })).toHaveTextContent('Borealis Marine');
    expect(within(dialog).getByRole('combobox', { name: 'Project' })).not.toHaveTextContent('Alpha Platform');
  });

  it('retains the contextual draft and command identity after a failed save and retry', async () => {
    hoisted.createMutate.mockRejectedValueOnce(new Error('temporary save failure'));
    const user = userEvent.setup();
    renderPage('/sales-invoices?create=1&project=proj-1');
    const dialog = await screen.findByRole('dialog', { name: 'New invoice' });
    await user.type(within(dialog).getByLabelText(/Item code/), 'ITEM-001');

    await user.click(within(dialog).getByRole('button', { name: 'Create invoice' }));
    expect(await screen.findByTestId('entity-modal-save-error')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'New invoice' })).getByLabelText(/Item code/)).toHaveValue('ITEM-001');
    expect(within(screen.getByRole('dialog', { name: 'New invoice' })).getByRole('combobox', { name: 'Customer' })).toHaveTextContent('Acme Energy');
    expect(within(screen.getByRole('dialog', { name: 'New invoice' })).getByRole('combobox', { name: 'Project' })).toHaveTextContent('Alpha Platform');

    const firstArgs = (hoisted.createMutate.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    await user.click(within(screen.getByRole('dialog', { name: 'New invoice' })).getByRole('button', { name: 'Create invoice' }));
    const secondArgs = (hoisted.createMutate.mock.calls[1] as unknown as [Record<string, unknown>])[0];
    expect(secondArgs.intent).toEqual(firstArgs.intent);
    expect(secondArgs).toEqual(expect.objectContaining({ customerId: 'cust-1', projectId: 'proj-1' }));
    expect(hoisted.createMutate).toHaveBeenCalledTimes(2);
  });
});

describe('SalesInvoices — a Finance user can actually raise an invoice (BLOCK 1)', () => {
  it('keeps the status filters inside a keyboard-accessible horizontal region', async () => {
    renderPage();

    const filterRegion = screen.getByRole('region', { name: 'Filter by status' });
    expect(filterRegion).toHaveAttribute('tabindex', '0');
    expect(filterRegion).toHaveClass('min-w-0', 'max-w-full', 'overflow-x-auto');
    expect(within(filterRegion).getByRole('tablist', { name: 'Filter by status' })).toBeInTheDocument();
  });

  it('groups the invoice amount and its tax-basis note for narrow card layouts', () => {
    hoisted.salesInvoicesState.data = [
      {
        id: 'si-1',
        si_number: 'ACC-SINV-0001',
        status: 'Draft',
        amount: 12345678900,
        currency: 'IDR',
        tax_treatment: 'exclusive',
        tax_rate: 11,
        erp_docstatus: 1,
      },
    ];
    renderPage();

    const taxBasis = screen.getByText(/excl\. PPN/);
    expect(taxBasis.parentElement).toHaveClass('w-full', 'flex-col', 'items-end');
  });

  it('AC-L10N-B01 renders the Finance page title in Bahasa from the shipped catalogue', async () => {
    await financeTestI18n.changeLanguage('id');
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Faktur Penjualan' })).toBeInTheDocument();
  });

  it('AC-L10N-B01 renders invoice form section labels from the shipped Bahasa catalogue', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await financeTestI18n.changeLanguage('id');
    expect(await screen.findByText('Detail faktur')).toBeInTheDocument();
    expect(screen.getByText('Item faktur')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Tinjauan draf faktur' })).toBeInTheDocument();
  });

  it('AC-S16-003 leads with native work description and previews totals in the project currency', async () => {
    hoisted.projectOptionsQuery = {
      data: [{
        value: 'proj-1', label: 'Alpha Platform', sub: 'ALP-01', clientId: 'cust-1', archived: false,
        currency: 'EUR', subjectToVat: true, taxRate: 12, taxBaseNumerator: 11, taxBaseDenominator: 12,
      }],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    const dialog = screen.getByRole('dialog', { name: 'New invoice' });

    const description = within(dialog).getByLabelText('Description');
    const itemCode = within(dialog).getByLabelText(/Item code/);
    expect(description.compareDocumentPosition(itemCode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(itemCode).toHaveAccessibleName('Item code');
    expect(within(dialog).getByText('Optional. Use an item code when your project tracks one.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Qty/)).toHaveAttribute('step', '0.001');

    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    await user.type(description, 'Installation support');
    await user.clear(within(dialog).getByLabelText(/Qty/));
    await user.type(within(dialog).getByLabelText(/Qty/), '2');
    await user.clear(within(dialog).getByLabelText(/Rate/));
    await user.type(within(dialog).getByLabelText(/Rate/), '100');
    await user.click(within(dialog).getByRole('button', { name: /Add line item/i }));
    await user.type(within(dialog).getAllByLabelText('Description')[1], 'Travel');
    await user.clear(within(dialog).getAllByLabelText(/Qty/)[1]);
    await user.type(within(dialog).getAllByLabelText(/Qty/)[1], '1');
    await user.clear(within(dialog).getAllByLabelText(/Rate/)[1]);
    await user.type(within(dialog).getAllByLabelText(/Rate/)[1], '50');

    const review = within(dialog).getByRole('region', { name: 'Invoice draft review' });
    expect(review).toHaveTextContent('Project tax base: 11/12');
    expect(review).toHaveTextContent('€250.00');
    expect(review).toHaveTextContent('€27.50');
    expect(review).toHaveTextContent('€277.50');
  });

  it('AC-S16-003 keeps ERP tax and final total unavailable until the draft exists', async () => {
    hoisted.connected = true;
    hoisted.revenueMode = 'erp';
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await user.click(screen.getByRole('combobox', { name: 'ERP item' }));
    await user.type(screen.getByRole('searchbox', { name: /ERP items/i }), 'Test service');
    await user.click(await screen.findByRole('option', { name: /ITEM-TEST/ }));
    await user.type(screen.getByLabelText('Description'), 'Monthly support');
    await user.clear(screen.getByLabelText(/Rate/));
    await user.type(screen.getByLabelText(/Rate/), '100');

    const review = screen.getByRole('region', { name: 'Invoice draft review' });
    expect(review).toHaveTextContent('Subtotal');
    expect(review).toHaveTextContent('Tax and final total are available after the ERP draft is created.');
    expect(review).not.toHaveTextContent('$0.00');
  });

  it('AC-S16-003 refuses a native quantity with more precision than the saved line', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    await user.type(screen.getByLabelText('Description'), 'Measured work');
    await user.clear(screen.getByLabelText(/Qty/));
    const quantity = screen.getByLabelText(/Qty/);
    await user.type(quantity, '0.0001');
    expect(quantity).toHaveValue('0.0001');
    await user.clear(screen.getByLabelText(/Rate/));
    await user.type(screen.getByLabelText(/Rate/), '100');
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(getPageAnnouncement('alert', /quantity|decimal/i)).toBeInTheDocument();
    expect(hoisted.createMutate).not.toHaveBeenCalled();
  });

  it('AC-S16-003 focuses the leading description when a native line has no identity', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(getPageAnnouncement('alert', /item code or a description/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toHaveFocus();
    expect(hoisted.createMutate).not.toHaveBeenCalled();
  });

  it('AC-S16-003 focuses the required ERP item picker when the connected line has no item', async () => {
    hoisted.connected = true;
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(getPageAnnouncement('alert', /item code is required/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'ERP item' })).toHaveFocus();
    expect(hoisted.createMutate).not.toHaveBeenCalled();
  });

  it('AC-S16-002 distinguishes a known no-VAT zero from unavailable project tax facts', async () => {
    const user = userEvent.setup();
    const { rerenderPage } = renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    await user.type(screen.getByLabelText('Description'), 'Non-taxable work');
    await user.clear(screen.getByLabelText(/Rate/));
    await user.type(screen.getByLabelText(/Rate/), '100');

    const noVatReview = screen.getByRole('region', { name: 'Invoice draft review' });
    expect(noVatReview).toHaveTextContent('€100.00');
    expect(noVatReview).toHaveTextContent('€0.00');

    hoisted.projectOptionsQuery = {
      data: [{
        value: 'proj-1', label: 'Alpha Platform', sub: 'ALP-01', clientId: 'cust-1', archived: false,
        currency: 'EUR', subjectToVat: true, taxRate: 12, taxBaseNumerator: null, taxBaseDenominator: null,
      }],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    rerenderPage();

    const missingTaxReview = screen.getByRole('region', { name: 'Invoice draft review' });
    expect(missingTaxReview).toHaveTextContent('€100.00');
    expect(missingTaxReview).toHaveTextContent('Project tax details are unavailable');
    expect(missingTaxReview).not.toHaveTextContent('€0.00');
  });

  it('AC-S16-004 keeps the preview out of the create command and retains it for a retry', async () => {
    hoisted.projectOptionsQuery = {
      data: [{
        value: 'proj-1', label: 'Alpha Platform', sub: 'ALP-01', clientId: 'cust-1', archived: false,
        currency: 'EUR', subjectToVat: true, taxRate: 12, taxBaseNumerator: 11, taxBaseDenominator: 12,
      }],
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    };
    hoisted.createMutate.mockRejectedValueOnce(new Error('temporary save failure'));
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    await user.type(screen.getByLabelText('Description'), 'Support work');
    await user.clear(screen.getByLabelText(/Rate/));
    await user.type(screen.getByLabelText(/Rate/), '100');

    const dialog = screen.getByRole('dialog', { name: 'New invoice' });
    const review = within(dialog).getByRole('region', { name: 'Invoice draft review' });
    expect(review).toHaveTextContent('€111.00');
    await user.click(within(dialog).getByRole('button', { name: 'Create invoice' }));
    expect(await screen.findByTestId('entity-modal-save-error')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'New invoice' })).getByRole('region', { name: 'Invoice draft review' })).toHaveTextContent('€111.00');

    const first = (hoisted.createMutate.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    await user.click(within(screen.getByRole('dialog', { name: 'New invoice' })).getByRole('button', { name: 'Create invoice' }));
    const second = (hoisted.createMutate.mock.calls[1] as unknown as [Record<string, unknown>])[0];
    expect(hoisted.createMutate).toHaveBeenCalledTimes(2);
    expect(second).toEqual(expect.objectContaining({
      customerId: 'cust-1',
      projectId: 'proj-1',
      items: [{ item_code: '', description: 'Support work', qty: 1, rate: 100 }],
      intent: first.intent,
    }));
    expect(second).not.toHaveProperty('preview');
    expect(second).not.toHaveProperty('tax');
  });

  it('AC-ITM-001/002 connected invoice searches ERP item name and submits separate authored description', async () => {
    hoisted.connected = true;
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    await user.click(screen.getByRole('combobox', { name: 'ERP item' }));
    await user.type(screen.getByRole('searchbox', { name: /ERP items/i }), 'Test service');
    await user.click(await screen.findByRole('option', { name: /ITEM-TEST/ }));
    await user.type(screen.getByLabelText('Description'), 'Inspection of test unit');
    await user.clear(screen.getByLabelText(/Rate/));
    await user.type(screen.getByLabelText(/Rate/), '100');
    await user.click(screen.getByRole('button', { name: /Create invoice/i }));
    expect(hoisted.createMutate).toHaveBeenCalledWith(expect.objectContaining({ items: [{ item_code: 'ITEM-TEST', description: 'Inspection of test unit', qty: 1, rate: 100 }] }));
  });

  it('AC-L10N-B01 connected ERP line fields use the shipped Bahasa catalogue', async () => {
    hoisted.connected = true;
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await financeTestI18n.changeLanguage('id');

    expect(await screen.findByRole('combobox', { name: 'Item ERP' })).toBeInTheDocument();
    expect(screen.getByLabelText('Deskripsi')).toHaveAttribute('placeholder', 'Jelaskan pekerjaan atau barang…');
    expect(screen.getByText('Pilih atau cari item…')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Item ERP' }));
    expect(screen.getByPlaceholderText('Cari kode atau nama item…')).toBeInTheDocument();
  });

  it('AC-ITM-004 standalone invoices retain the free-text item code field', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    expect(screen.getByLabelText(/Item code/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'ERP item' })).not.toBeInTheDocument();
  });
  it('offers the org\'s real client companies in the customer picker', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await user.click(screen.getByRole('combobox', { name: 'Customer' }));

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /Acme Energy/ })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: /Borealis Marine/ })).toBeInTheDocument();
  });

  it('offers the org\'s real projects in the project picker', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await user.click(screen.getByRole('combobox', { name: 'Project' }));

    expect(await screen.findByRole('option', { name: /Alpha Platform/ })).toBeInTheDocument();
  });

  it('enables "Create invoice" once a customer and project are chosen (it was permanently disabled)', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    const submit = screen.getByRole('button', { name: 'Create invoice' });
    expect(submit).toBeDisabled();

    await pick(user, 'Customer', 'Acme Energy');

    expect(screen.getByRole('button', { name: 'Create invoice' })).toBeDisabled();
    await pick(user, 'Project', 'Alpha Platform');

    expect(screen.getByRole('button', { name: 'Create invoice' })).toBeEnabled();
  });

  it('submits the line items the USER typed — never the untouched $0 stub (BLOCK 1b)', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');

    await user.type(screen.getByLabelText(/Item code/), 'ITEM-001');
    const qty = screen.getByLabelText(/Qty/);
    await user.clear(qty);
    await user.type(qty, '2');
    const rate = screen.getByLabelText(/Rate/);
    await user.clear(rate);
    await user.type(rate, '25000');

    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(hoisted.createMutate).toHaveBeenCalledWith({
      customerId: 'cust-1',
      projectId: 'proj-1',
      items: [{ item_code: 'ITEM-001', qty: 2, rate: 25000 }],
      // BLOCK 2 (ADR-0058): the form session's command identity rides along with the body.
      intent: { id: expect.any(String), idempotencyKey: expect.any(String) },
    });
    expect(await findToastAnnouncement('status', 'Invoice created')).toBeInTheDocument();
    expect(screen.queryByText('cust-1')).not.toBeInTheDocument();
  });

  it('AC-PLC-009: rejects an en-US sales-invoice rate with excess precision before creating', async () => {
    setActiveLocale(EN_LOCALE);
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    await user.type(screen.getByLabelText(/Item code/), 'ITEM-001');
    const rate = screen.getByLabelText(/Rate/);
    await user.clear(rate);
    await user.type(rate, '1.234');
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(getPageAnnouncement('alert', /rate|decimal/i).textContent).toMatch(/rate|decimal/i);
    expect(hoisted.createMutate).not.toHaveBeenCalled();
  });

  it('AC-PLC-009: persists an id-ID grouped sales-invoice rate as 1234', async () => {
    setActiveLocale(ID_LOCALE);
    const user = userEvent.setup();
    renderPage();
    await openForm(user);
    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    await user.type(screen.getByLabelText(/Item code/), 'ITEM-001');
    const rate = screen.getByLabelText(/Rate/);
    await user.clear(rate);
    await user.type(rate, '1.234');
    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(hoisted.createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ item_code: 'ITEM-001', qty: 1, rate: 1234 }] }),
    );
  });

  it('submits every line the user added, not just the first', async () => {
    const user = userEvent.setup();
    renderPage();
    await openForm(user);

    await pick(user, 'Customer', 'Acme Energy');
    await pick(user, 'Project', 'Alpha Platform');
    await user.type(screen.getByLabelText(/Item code/), 'ITEM-001');
    await user.click(screen.getByRole('button', { name: /Add line item/i }));

    const codes = screen.getAllByLabelText(/Item code/);
    expect(codes).toHaveLength(2);
    await user.type(codes[1], 'ITEM-002');

    await user.click(screen.getByRole('button', { name: 'Create invoice' }));

    expect(hoisted.createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          { item_code: 'ITEM-001', qty: 1, rate: 0 },
          { item_code: 'ITEM-002', qty: 1, rate: 0 },
        ],
      }),
    );
  });

  it('does not expose a row activation that navigates to a missing invoice detail route', async () => {
    hoisted.salesInvoicesState.data = [
      {
        id: 'si-1',
        si_number: 'ACC-SINV-0001',
        status: 'Draft',
        amount: 410000000,
        currency: 'USD',
        tax_treatment: 'exclusive',
      },
    ];
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByRole('button', { name: 'Open ACC-SINV-0001' })).not.toBeInTheDocument();
    await user.click(screen.getByText('ACC-SINV-0001'));

    expect(hoisted.navigateMock).not.toHaveBeenCalled();
  });
});
