import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { listFiles } = vi.hoisted(() => ({ listFiles: vi.fn(async () => []) }));

vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    procurementFiles: {
      list: listFiles,
      prepareUpload: vi.fn(),
      confirmUpload: vi.fn(),
      cleanupObject: vi.fn(),
      archive: vi.fn(),
      getSignedUrl: vi.fn(),
    },
  },
}));
vi.mock('@/src/hooks/useFkOptions', () => ({ useVendorOptions: () => ({ data: [] }) }));
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await orig<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

import { VendorQuotesTab } from '../VendorQuotesTab';

const quote = (n: number) => ({
  id: `q${n}`,
  procurement_id: 'proc-1',
  vendor_id: `v${n}`,
  total_amount: 100 * n,
  currency: 'USD',
  is_selected: false,
  received_date: '2026-01-01',
  valid_until: null,
  system_number: `VQ-${n}`,
  // The detail query embeds each quote's files (id + title + file_path + archived_at).
  files: [
    { id: `f${n}`, title: null, file_path: `org/proc-1/doc-${n}.pdf`, archived_at: null },
    { id: `x${n}`, title: null, file_path: `org/proc-1/old-${n}.pdf`, archived_at: '2026-01-02T00:00:00Z' },
  ],
});

beforeEach(() => listFiles.mockClear());

describe('AC-OVERFETCH-003 VendorQuotesTab reuses the files the detail query embeds', () => {
  it('fires no per-quote file-list query and shows each quote\'s non-archived embedded files', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <VendorQuotesTab
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          quotations={[quote(1), quote(2), quote(3)] as any}
          canAdd={false}
          canSelect={false}
          onAdd={vi.fn()}
          onSelect={vi.fn()}
          onError={vi.fn()}
          procurementId="proc-1"
          currency="USD"
          canManageFiles
          currentUserId="u1"
        />
      </QueryClientProvider>,
    );
    expect(listFiles).not.toHaveBeenCalled();
    expect(screen.getAllByText('doc-1.pdf').length).toBeGreaterThan(0);
    expect(screen.getAllByText('doc-3.pdf').length).toBeGreaterThan(0);
    expect(screen.queryByText('old-1.pdf')).toBeNull();
  });

  it('AC-806 groups quote values by currency and compares best value only within each group', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <VendorQuotesTab
          quotations={[
            { ...quote(1), currency: 'IDR', total_amount: 2226648000, vendor_id: 'idr-best' },
            { ...quote(2), currency: 'IDR', total_amount: 2500000000, vendor_id: 'idr-next' },
            { ...quote(3), currency: 'USD', total_amount: 3412800, vendor_id: 'usd-best' },
            { ...quote(4), currency: 'USD', total_amount: 3500000, vendor_id: 'usd-next' },
          ] as never}
          canAdd={false}
          canSelect
          onAdd={vi.fn()}
          onSelect={vi.fn()}
          onError={vi.fn()}
          procurementId="proc-1"
          currency="IDR"
          canManageFiles={false}
          currentUserId="u1"
          vendorMap={{ 'idr-best': 'Indonesian Vendor', 'idr-next': 'Second Indonesian Vendor', 'usd-best': 'Global Vendor', 'usd-next': 'Second Global Vendor' }}
        />
      </QueryClientProvider>,
    );

    const table = screen.getByRole('table', { name: 'Vendor bid comparison' });
    const headers = within(table).getAllByRole('columnheader').map((header) => header.textContent?.trim());
    expect(headers).toEqual(['Vendor / reference', 'Selection status', 'Valid until', 'Amount', 'Evidence', 'Select']);
    expect(within(table).getByRole('button', { name: /IDR.*2/ })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: /USD.*2/ })).toBeInTheDocument();
    const idrBest = within(table).getByRole('row', { name: /^Indonesian Vendor/ });
    const usdBest = within(table).getByRole('row', { name: /^Global Vendor/ });
    const idrNext = within(table).getByRole('row', { name: /^Second Indonesian Vendor/ });
    expect(idrBest).toHaveTextContent('2,226,648,000');
    expect(usdBest).toHaveTextContent('3,412,800');
    expect(idrBest).toHaveTextContent('Best in currency');
    expect(usdBest).toHaveTextContent('Best in currency');
    expect(idrNext).not.toHaveTextContent('Best in currency');
    expect(idrBest).not.toHaveTextContent('IDR');
  });
});
