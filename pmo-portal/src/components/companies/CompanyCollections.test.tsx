import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';
import type { CompanyCollectionsHookResult } from '@/src/hooks/useCompanyCollections';

const h = vi.hoisted(() => ({ useCompanyCollections: vi.fn() }));
vi.mock('@/src/hooks/useCompanyCollections', () => ({ useCompanyCollections: h.useCompanyCollections }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

import { CompanyCollections } from './CompanyCollections';

const row: ErpAgingSnapshotRow = {
  party: 'Customer:C-0001', partyType: 'Customer', currency: 'USD', totalOutstanding: 250,
  current: 0, bucket0to30: 250, bucket31to60: 0, bucket61to90: 0, bucketOver90: 0,
  rangeLabels: { b_0_30: '0–30 days' }, reportDate: '2026-10-18', ageingBasedOn: 'Due Date',
  asOf: '2026-10-18T00:00:00Z', sourceReport: 'Accounts Receivable', reportVersion: '15', snapshotId: 'snapshot-1',
};
const baseResult = (overrides: Partial<CompanyCollectionsHookResult> = {}): CompanyCollectionsHookResult => ({
  rows: [row], refsBySnapshotCustomer: [],
  byCompany: new Map([['company-1', { state: 'known', positions: [row] }]]),
  customerLinks: new Map(), isEnabled: true, isPending: false, isError: false,
  error: null, refetch: vi.fn(async () => undefined), ...overrides,
});

function renderPanel() {
  return render(<MemoryRouter><CompanyCollections companyId="company-1" /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.useCompanyCollections.mockReturnValue(baseResult());
});

describe('CompanyCollections doorway', () => {
  it('anchors the section, keeps ERP currency/window rows verbatim, and links by canonical PMO company ID', () => {
    renderPanel();

    const section = document.getElementById('collections');
    expect(section).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Customer collections' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('Customer:C-0001')).toBeInTheDocument();
    expect(screen.getByText('Report date: 2026-10-18')).toBeInTheDocument();
    expect(screen.getByText('Ageing basis: Due Date')).toBeInTheDocument();
    expect(screen.getByText('ERP ranges: b_0_30: 0–30 days')).toBeInTheDocument();
    expect(screen.getByText('Accounts Receivable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open invoices' })).toHaveAttribute('href', '/sales-invoices?customer=company-1');
    expect(screen.getByRole('link', { name: 'Overdue invoices first' })).toHaveAttribute(
      'href', '/sales-invoices?customer=company-1&overdue=true&sort=oldest-overdue',
    );
    expect(screen.queryByText('Actuals (ERP ledger)')).not.toBeInTheDocument();
    expect(screen.queryByText('AP aging')).not.toBeInTheDocument();
  });

  it('shows ambiguous party mappings without assigning their amount to the company', () => {
    h.useCompanyCollections.mockReturnValue(baseResult({
      byCompany: new Map([['company-1', { state: 'ambiguous', positions: [row] }]]),
    }));
    renderPanel();

    expect(screen.getByText(/mapped to multiple companies/i)).toBeInTheDocument();
    expect(screen.queryByText('$250')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open invoices' })).toBeInTheDocument();
  });

  it('keeps missing positions unavailable rather than showing a zero balance', () => {
    h.useCompanyCollections.mockReturnValue(baseResult({
      byCompany: new Map([['company-1', { state: 'unavailable', positions: [] }]]),
    }));
    renderPanel();

    expect(screen.getByText(/does not indicate a zero balance/i)).toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });

  it('renders a retryable error and loading state from the hook', () => {
    const refetch = vi.fn(async () => undefined);
    h.useCompanyCollections.mockReturnValue(baseResult({ isError: true, error: new Error('read failed'), refetch }));
    const { rerender } = renderPanel();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();

    h.useCompanyCollections.mockReturnValue(baseResult({ isPending: true }));
    rerender(<MemoryRouter><CompanyCollections companyId="company-1" /></MemoryRouter>);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('does not mount collections content when the read permission gate is disabled', () => {
    h.useCompanyCollections.mockReturnValue(baseResult({ isEnabled: false }));
    renderPanel();
    expect(document.getElementById('collections')).not.toBeInTheDocument();
  });
});
