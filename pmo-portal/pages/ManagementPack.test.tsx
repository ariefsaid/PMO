import React from 'react';
import { MemoryRouter } from 'react-router';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagementPack } from '@/src/lib/reports/managementPack';

const state = vi.hoisted(() => ({ pack: null as ManagementPack | null }));

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: null }) }));
vi.mock('@/src/hooks/useManagementPack', () => ({
  useManagementPack: () => ({ data: state.pack, isPending: false, isError: false, error: null, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDelivery: () => ({ data: {} }) }));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportTable: vi.fn(), busy: false }) }));
vi.mock('@/src/components/reports/RecordProgressModal', () => ({ RecordProgressModal: () => null }));

import ManagementPackPage from './ManagementPack';

const month = '2026-10-01';
const report = (): ManagementPack => ({
  from: month,
  to: month,
  timezone: 'UTC',
  months: [month],
  rows: [{
    key: 'project|USD|contract', kind: 'contract', projectId: null, projectName: null, projectNumber: null,
    clientName: null, projectManagerId: null, projectStatus: null, currency: 'USD', contractNet: 100_000,
    latestProgress: null,
    months: [{ month, planned: 10_000, recognised: 10_000, invoiced: 10_000, recognisedToDate: 10_000,
      invoicedToDate: 10_000, unbilled: 0, backlog: null, basis: 'invoiced' }],
  }],
  totals: [{ currency: 'USD', months: [{ month, planned: 10_000, recognised: 10_000, invoiced: 10_000,
    recognisedToDate: 10_000, invoicedToDate: 10_000, unbilled: 0, backlog: null }] }],
  undatedInvoiceCount: 0,
});

beforeEach(() => { state.pack = report(); });

describe('Management pack money display (#1260, #1437)', () => {
  it('AC-MONEY-DISPLAY: leaves an unknown backlog figure empty and gives one plain-language reason with a fix link', () => {
    render(<MemoryRouter><ManagementPackPage /></MemoryRouter>);

    expect(screen.getByTestId('backlog-unavailable')).toHaveTextContent(
      'A foreign-currency invoice needs reconciliation before this balance can be known.',
    );
    expect(screen.getByRole('link', { name: 'Review invoices' })).toHaveAttribute('href', '/sales-invoices');
    expect(screen.queryByRole('button', { name: /foreign-currency invoice needs reconciliation/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();

    const backlogLabel = screen.getAllByText('Backlog', { exact: true })
      .find((element) => element.classList.contains('text-muted-foreground'));
    expect(backlogLabel).toBeDefined();
    const backlogCard = backlogLabel!.closest('div.rounded-lg');
    expect(backlogCard).not.toBeNull();
    expect(backlogCard!.children[1]).toBeEmptyDOMElement();
    expect(backlogCard).not.toHaveTextContent('USD');
  });
});
