import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import type { ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';
import type { CompanyCollectionsHookResult } from '@/src/hooks/useCompanyCollections';

const h = vi.hoisted(() => ({ useCompanyCollections: vi.fn() }));
vi.mock('@/src/hooks/useCompanyCollections', () => ({ useCompanyCollections: h.useCompanyCollections }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

import { CompanyCollections } from './CompanyCollections';

const row: ErpAgingSnapshotRow = {
  party: 'Customer:C-0001',
  partyType: 'Customer',
  currency: 'USD',
  totalOutstanding: 250,
  current: 0,
  bucket0to30: 250,
  bucket31to60: 0,
  bucket61to90: 0,
  bucketOver90: 0,
  rangeLabels: { b_0_30: '0–30 days' },
  reportDate: '2026-10-18',
  ageingBasedOn: 'Due Date',
  asOf: '2026-10-18T00:00:00Z',
  sourceReport: 'Accounts Receivable',
  reportVersion: '15',
  snapshotId: 'snapshot-1',
};

const baseResult = (overrides: Partial<CompanyCollectionsHookResult> = {}): CompanyCollectionsHookResult => ({
  rows: [row],
  refsBySnapshotCustomer: [],
  byCompany: new Map([['company-1', { state: 'known', positions: [row] }]]),
  customerLinks: new Map(),
  isEnabled: true,
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn(async () => undefined),
  ...overrides,
});

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="Current location">{`${location.pathname}${location.search}`}</output>;
}

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={['/companies/company-1']}>
      <CompanyCollections companyId="company-1" />
      <CurrentLocation />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.useCompanyCollections.mockReturnValue(baseResult());
});
afterEach(cleanup);

describe('company collections floor controls', () => {
  it('floor: Open invoices opens receivables for this company', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('link', { name: 'Open invoices' }));
    expect(screen.getByLabelText('Current location').textContent).toBe('/finance/receivables?customer=company-1');
  });

  it('floor: Overdue invoices first opens this company’s overdue receivables', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('link', { name: 'Overdue invoices first' }));
    expect(screen.getByLabelText('Current location').textContent).toBe('/finance/receivables?customer=company-1&overdue=true');
  });

  it('floor: collections Retry reloads the aging rows', () => {
    const refetch = vi.fn(async () => undefined);
    h.useCompanyCollections.mockReturnValue(baseResult({ isError: true, error: new Error('read failed'), refetch }));
    const view = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();

    h.useCompanyCollections.mockReturnValue(baseResult());
    view.rerender(
      <MemoryRouter initialEntries={['/companies/company-1']}>
        <CompanyCollections companyId="company-1" />
        <CurrentLocation />
      </MemoryRouter>,
    );
    expect(screen.getByText('Customer:C-0001')).toBeInTheDocument();
  });
});
