import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { ManagementPositionDetail, ManagementPositionRow } from '@/src/lib/repositories/managementPosition';
import type { ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';

const h = vi.hoisted(() => ({
  role: 'Finance',
  view: null as unknown,
  detail: null as unknown,
  useManagementPosition: vi.fn(),
  may: vi.fn(),
  agingRows: [] as ErpAgingSnapshotRow[],
}));

vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPosition: (...args: unknown[]) => h.useManagementPosition(...args),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => h.may }));
vi.mock('@/src/components/dashboard/AccountingSnapshotsSection', () => ({
  AccountingSnapshotsSection: ({ arAging }: { arAging: ErpAgingSnapshotRow[] }) => (
    <div data-testid="customer-aging">{arAging.map((row) => `${row.party} ${row.totalOutstanding}`).join(' · ')}</div>
  ),
}));

const positionRow = (projectId: string, actual: Partial<ManagementPositionRow['actual']> = {}): ManagementPositionRow => ({
  projectId,
  projectName: `Project ${projectId}`,
  projectNumber: null,
  actual: {
    state: 'known', amount: '0.00', currency: 'USD', asOf: '2026-10-18T08:00:00Z',
    basis: 'pmo', complete: true, categories: [], excludesRestrictedRows: false,
    ...actual,
  },
});

const aging: ErpAgingSnapshotRow = {
  party: 'Customer:C-0001', partyType: 'Customer', currency: 'USD', totalOutstanding: 200,
  current: null, bucket0to30: 0, bucket31to60: null, bucket61to90: null, bucketOver90: null,
  rangeLabels: { b_0_30: 'ERP supplied window' }, reportDate: '2026-10-18', ageingBasedOn: 'Due Date',
  asOf: '2026-10-18T00:00:00Z', sourceReport: 'Accounts Receivable', reportVersion: '1', snapshotId: 'snapshot-1',
};

const detail: ManagementPositionDetail = {
  projectId: 'p1',
  projectCurrency: 'USD',
  cash: { state: 'known', buckets: [{ currency: 'USD', amount: '1000.00' }], receipt_count: 1 },
  billedWork: [{ currency: 'USD', work_revenue: '1200.00', missing_work: 0 }],
  margins: [
    { currency: 'USD', value: { amount: '50.00', reason: null } },
    { currency: 'EUR', value: { amount: null, reason: 'different-currencies' } },
  ],
  projectOutstanding: [{ currency: 'USD', outstanding: '200.00', missing_outstanding: 0, tax_basis: 'exclusive' }],
  customerId: 'company-id',
  collections: { state: 'known', positions: [aging] },
  limitation: null,
};

const pack = {
  from: '2026-01-01', to: '2026-01-31', timezone: 'UTC', months: ['2026-01'], rows: [], totals: [], undatedInvoiceCount: 0,
};

beforeEach(() => {
  h.role = 'Finance';
  h.detail = detail;
  h.view = {
    identityReady: true,
    rows: [positionRow('p1'), positionRow('p2', { amount: '-25.00' })],
    pageIndex: 0, pageCount: 1, expandedProjectId: null, detail: null,
    actualState: 'known', projectState: 'not-requested', financeState: 'not-requested', collectionsState: 'not-requested',
    retryActual: vi.fn(), retryProject: vi.fn(), retryFinances: vi.fn(), retryCollections: vi.fn(),
  };
  h.useManagementPosition.mockReset().mockImplementation((_pack, page, expanded) => ({
    ...(h.view as object),
    pageIndex: page,
    expandedProjectId: expanded,
    detail: expanded ? h.detail : null,
  }));
  h.may.mockReset().mockImplementation((_action: string, entity: string) => {
    if (entity === 'financialStatements') return h.role === 'Finance' || h.role === 'Executive' || h.role === 'Admin';
    if (entity === 'projectProfitLoss') return true;
    if (entity === 'salesInvoice') return h.role !== 'Engineer';
    return true;
  });
});

async function renderSection() {
  const module = await import('./ManagementPositionSection');
  expect(module.ManagementPositionSection).toBeTypeOf('function');
  const Component = module.ManagementPositionSection;
  const view = render(<MemoryRouter><Component pack={pack as never} /></MemoryRouter>);
  return { ...view, Component };
}

describe('ManagementPositionSection', () => {
  it('AC-S35-005: labels latest Actual separately and preserves known zero and negative values', async () => {
    await renderSection();

    expect(screen.getByRole('heading', { name: 'Current project position' })).toBeInTheDocument();
    expect(screen.getByText('Latest recorded position; separate from selected-period revenue.')).toBeInTheDocument();
    expect(screen.getAllByText('Recorded cost to date')).toHaveLength(2);
    expect(screen.getByText((_content, element) => element?.textContent === '$0.00 USD')).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === '−$25.00 USD')).toBeInTheDocument();
    expect(screen.queryByText(/bank balance|cash on hand|period profit/i)).not.toBeInTheDocument();
  });

  it('AC-S35-005: keeps cash, billed work, invoice outstanding and customer aging in separate scopes', async () => {
    h.useManagementPosition.mockImplementation((_pack, page, expanded) => ({
      ...(h.view as object), pageIndex: page, expandedProjectId: expanded, detail: expanded ? h.detail : null,
      projectState: 'known', financeState: 'known', collectionsState: 'known',
    }));

    await renderSection();
    fireEvent.click(screen.getAllByRole('button', { name: 'Position details' })[0]);

    expect(screen.getByText('Cash received')).toBeInTheDocument();
    expect(screen.getByText('Receipt-backed cash, separate from invoice settlement.')).toBeInTheDocument();
    expect(screen.getByText('Source update time not supplied')).toBeInTheDocument();
    expect(screen.getByText('Billed work to date · net of tax')).toBeInTheDocument();
    expect(screen.getByText('Billed-work margin to date')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('Invoice work and Actual use different currencies.')).toBeInTheDocument();
    expect(screen.getByText('Project invoice outstanding')).toBeInTheDocument();
    expect(screen.getByText('Customer balance — includes other projects')).toBeInTheDocument();
    expect(screen.getByTestId('customer-aging')).toHaveTextContent('Customer:C-0001 200');
    expect(screen.getByRole('link', { name: 'Open customer collections' })).toHaveAttribute('href', '/companies/company-id#collections');
    expect(screen.getByRole('link', { name: 'Open customer invoices' })).toHaveAttribute('href', '/sales-invoices?customer=company-id');
  });

  it('AC-S35-005: invoice totals with every row known show their exact amounts', async () => {
    h.useManagementPosition.mockImplementation((_pack, page, expanded) => ({
      ...(h.view as object), pageIndex: page, expandedProjectId: expanded, detail: expanded ? h.detail : null,
      projectState: 'known', financeState: 'known', collectionsState: 'known',
    }));

    await renderSection();
    fireEvent.click(screen.getAllByRole('button', { name: 'Position details' })[0]);

    const billed = screen.getByRole('region', { name: 'Billed work to date' });
    expect(within(billed).getByText('$1,200.00')).toBeInTheDocument();
    expect(within(billed).queryByText(/Incomplete/)).not.toBeInTheDocument();
    const outstanding = screen.getByRole('region', { name: 'Project invoice outstanding' });
    expect(within(outstanding).getByText('$200.00')).toBeInTheDocument();
    expect(within(outstanding).queryByText(/Incomplete/)).not.toBeInTheDocument();
  });

  it('AC-S35-005: a partial invoice sum shows Incomplete instead of the partial amount', async () => {
    // Three open invoices; the source summed the two known rows and skipped the one whose amount is unknown.
    h.detail = {
      ...detail,
      billedWork: [{ currency: 'USD', work_revenue: '1200.00', missing_work: 1 }],
      projectOutstanding: [{ currency: 'USD', outstanding: '200.00', missing_outstanding: 1, tax_basis: 'exclusive' }],
    };
    h.useManagementPosition.mockImplementation((_pack, page, expanded) => ({
      ...(h.view as object), pageIndex: page, expandedProjectId: expanded, detail: expanded ? h.detail : null,
      projectState: 'known', financeState: 'known', collectionsState: 'known',
    }));

    await renderSection();
    fireEvent.click(screen.getAllByRole('button', { name: 'Position details' })[0]);

    const billed = screen.getByRole('region', { name: 'Billed work to date' });
    expect(within(billed).queryByText('$1,200.00')).not.toBeInTheDocument();
    expect(within(billed).getByText('Incomplete — invoice work amount missing')).toBeInTheDocument();
    expect(within(billed).getByText('1 invoice row lacks a work amount.')).toBeInTheDocument();
    const outstanding = screen.getByRole('region', { name: 'Project invoice outstanding' });
    expect(within(outstanding).queryByText('$200.00')).not.toBeInTheDocument();
    expect(within(outstanding).getByText('Incomplete — ERP outstanding missing')).toBeInTheDocument();
    expect(within(outstanding).getByText('1 invoice row lacks a known outstanding amount.')).toBeInTheDocument();
  });

  it('AC-S35-005: plural counts read naturally for several missing invoice rows', async () => {
    h.detail = {
      ...detail,
      billedWork: [{ currency: 'USD', work_revenue: '1200.00', missing_work: 2 }],
      projectOutstanding: [{ currency: 'USD', outstanding: '200.00', missing_outstanding: 3, tax_basis: 'exclusive' }],
    };
    h.useManagementPosition.mockImplementation((_pack, page, expanded) => ({
      ...(h.view as object), pageIndex: page, expandedProjectId: expanded, detail: expanded ? h.detail : null,
      projectState: 'known', financeState: 'known', collectionsState: 'known',
    }));

    await renderSection();
    fireEvent.click(screen.getAllByRole('button', { name: 'Position details' })[0]);

    expect(screen.getByText('2 invoice rows lack a work amount.')).toBeInTheDocument();
    expect(screen.getByText('3 invoice rows lack a known outstanding amount.')).toBeInTheDocument();
  });

  it('AC-S35-005: known zero cash shows a formatted zero like the project page', async () => {
    h.detail = { ...detail, cash: { state: 'known', buckets: [], receipt_count: 0 } };
    h.useManagementPosition.mockImplementation((_pack, page, expanded) => ({
      ...(h.view as object), pageIndex: page, expandedProjectId: expanded, detail: expanded ? h.detail : null,
      projectState: 'known', financeState: 'known', collectionsState: 'known',
    }));

    await renderSection();
    fireEvent.click(screen.getAllByRole('button', { name: 'Position details' })[0]);

    const cash = screen.getByRole('region', { name: 'Cash received' });
    expect(within(cash).getByText('$0.00')).toBeInTheDocument();
    expect(within(cash).queryByText(/No receipt-backed amount/)).not.toBeInTheDocument();
  });

  it('AC-S35-005: ambiguous customer aging never renders its supplied amount', async () => {
    h.detail = { ...detail, collections: { state: 'ambiguous', positions: [aging] } };
    h.useManagementPosition.mockImplementation((_pack, page, expanded) => ({
      ...(h.view as object), pageIndex: page, expandedProjectId: expanded, detail: expanded ? h.detail : null,
      projectState: 'known', financeState: 'known', collectionsState: 'unavailable',
    }));

    await renderSection();
    fireEvent.click(screen.getAllByRole('button', { name: 'Position details' })[0]);

    expect(screen.getByText(/mapped to multiple companies/i)).toBeInTheDocument();
    expect(screen.queryByTestId('customer-aging')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Customer balance — includes other projects' })).queryByText('$200.00')).not.toBeInTheDocument();
  });

  it('AC-S35-003: ERP Actual disagreement limits margin without hiding cash or customer aging', async () => {
    h.detail = {
      ...detail,
      limitation: 'actuals-changed',
      margins: [{ currency: 'USD', value: { amount: null, reason: 'actuals-unavailable' } }],
    };
    h.useManagementPosition.mockImplementation((_pack, page, expanded) => ({
      ...(h.view as object), pageIndex: page, expandedProjectId: expanded, detail: expanded ? h.detail : null,
      projectState: 'known', financeState: 'known', collectionsState: 'known',
    }));

    await renderSection();
    fireEvent.click(screen.getAllByRole('button', { name: 'Position details' })[0]);

    expect(screen.getByText('ERP Actual readings changed between sources, so margin is unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Cash received')).toBeInTheDocument();
    expect(screen.getByText('Source update time not supplied')).toBeInTheDocument();
    expect(screen.getByTestId('customer-aging')).toHaveTextContent('Customer:C-0001 200');
  });

  it('AC-S35-006: statements link follows real permission and stable project links stay canonical', async () => {
    h.useManagementPosition.mockImplementation((_pack, page, expanded) => ({
      ...(h.view as object), pageIndex: page, expandedProjectId: expanded, detail: expanded ? h.detail : null,
      projectState: 'known', financeState: 'known', collectionsState: 'known',
    }));

    const { rerender, Component } = await renderSection();
    expect(screen.getByRole('link', { name: 'Company statements' })).toHaveAttribute('href', '/financial-statements');
    fireEvent.click(screen.getAllByRole('button', { name: 'Position details' })[0]);
    expect(screen.getAllByRole('link', { name: 'Open project overview' })[0]).toHaveAttribute('href', '/projects/p1/overview');

    h.role = 'Project Manager';
    rerender(<MemoryRouter><Component pack={pack as never} /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Company statements' })).not.toBeInTheDocument();
  });

  it('AC-S35-005: partial Actual keeps exact source time and coverage labels', async () => {
    h.view = {
      ...(h.view as object),
      rows: [positionRow('p1', { state: 'partial', amount: '-9007199254740993.01', asOf: null, basis: 'erp', complete: false, excludesRestrictedRows: true })],
    };

    await renderSection();

    expect(screen.getByText((_content, element) => element?.tagName === 'P'
      && element.textContent?.includes('Partial coverage · ERP ledger · Updated Unavailable') === true)).toBeInTheDocument();
    expect(screen.getByText('Restricted rows are excluded from this reading.')).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent === '−$9,007,199,254,740,993.01 USD')).toBeInTheDocument();
  });

  it('AC-S35-005: finance errors keep Actual visible and retry only the failed source', async () => {
    const retryFinances = vi.fn();
    h.view = { ...(h.view as object), projectState: 'known', financeState: 'error', retryFinances };
    h.useManagementPosition.mockImplementation((_pack, page, expanded) => ({
      ...(h.view as object), pageIndex: page, expandedProjectId: expanded, detail: null,
    }));

    await renderSection();
    expect(screen.getByText((_content, element) => element?.textContent === '$0.00 USD')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Position details' })[0]);
    expect(screen.getByText('Could not load this source.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry source' }));
    expect(retryFinances).toHaveBeenCalledOnce();
    expect(screen.getByText((_content, element) => element?.textContent === '$0.00 USD')).toBeInTheDocument();
  });

  it('AC-S35-005: disclosure supports Enter and changing pages collapses it', async () => {
    const user = userEvent.setup();
    h.view = { ...(h.view as object), pageCount: 2 };
    h.useManagementPosition.mockImplementation((_pack, page, expanded) => ({
      ...(h.view as object),
      rows: [positionRow(page === 0 ? 'p1' : 'p11')],
      pageIndex: page,
      pageCount: 2,
      expandedProjectId: expanded,
      detail: expanded ? h.detail : null,
    }));

    await renderSection();
    const firstDisclosure = screen.getByRole('button', { name: 'Position details' });
    expect(screen.getByRole('button', { name: 'Previous projects' })).toBeDisabled();
    firstDisclosure.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: 'Next projects' }));
    expect(h.useManagementPosition).toHaveBeenLastCalledWith(pack, 1, null);
    expect(screen.queryByRole('button', { name: 'Hide details' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous projects' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next projects' })).toBeDisabled();
  });
});
