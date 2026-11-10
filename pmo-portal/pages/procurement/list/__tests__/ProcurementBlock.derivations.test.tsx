import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

/**
 * AC-1 of #2101: on an ERP-connected list the per-row money/date/age derivation runs
 * ONCE PER ROW PER DATA CHANGE — never again for a keystroke, a sort toggle, or any other
 * re-render. Fixture: 300 procurements × 2,000 ERP documents (the audit's scale), so the
 * multiply-out the issue measured (17 call sites × rows × documents) is really covered.
 */
const stats = vi.hoisted(() => ({ rowDerivations: 0 }));

vi.mock('@/src/lib/procurement/rowDerivations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/procurement/rowDerivations')>();
  return {
    ...actual,
    deriveProcurementRow: (...args: Parameters<typeof actual.deriveProcurementRow>) => {
      stats.rowDerivations += 1;
      return actual.deriveProcurementRow(...args);
    },
  };
});

const KEY = ['procurements', 'org-1', 'with-refs', 'with-shared-details'];
const rows = Array.from({ length: 300 }, (_, i) => ({
  id: `p-${i}`,
  code: `PR-${i}`,
  title: `Row ${i}`,
  status: ['Requested', 'Ordered', 'Received', 'Vendor Invoiced', 'Paid'][i % 5],
  total_value: 1_000 + i,
  approved_total_value: null,
  currency: 'USD',
  project_id: 'pr-1',
  budget_category: 'Materials',
  requested_by_id: 'u-2',
  vendor_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  status_events: [{ to_status: ['Requested', 'Ordered', 'Received', 'Vendor Invoiced', 'Paid'][i % 5], created_at: '2026-09-01T00:00:00.000Z' }],
  project: { name: 'Site', code: 'P1' },
  vendor: null,
  requested_by: { full_name: 'Requester' },
}));
const erpDocuments = Array.from({ length: 2_000 }, (_, i) => ({
  id: `d-${i}`,
  procurementId: `p-${i % 300}`,
  doctype: ['Purchase Order', 'Purchase Invoice', 'Payment Entry'][i % 3],
  grandTotal: 100 + i,
  outstanding: i % 2 === 0 ? 0 : 50,
  docDate: '2026-09-02',
}));

const store: { rows: unknown[] } = { rows };

vi.mock('@/src/hooks/useProcurements', async () => {
  const { useQuery: useQueryImpl } = await import('@tanstack/react-query');
  const useRead = () => useQueryImpl({ queryKey: ['procurements', 'org-1', 'with-refs', 'with-shared-details'], queryFn: async () => store.rows });
  return { useProcurements: useRead, useProjectProcurements: useRead };
});
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('@/src/hooks/useErpPurchases', () => ({
  useErpPurchases: () => ({ data: erpDocuments, isError: false, isPending: false, refetch: vi.fn() }),
  useErpOrphans: () => ({ data: [], isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectPosition', () => ({ useBudgetPosition: () => ({ rows: [], hasBudget: false, isPending: false, actualsPending: false }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Finance', effectiveRole: 'Finance' }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: 'Finance' }) }));

const { ProcurementBlock } = await import('@/src/components/procurement/ProcurementBlock');

describe('ProcurementBlock row derivations (#2101)', () => {
  it('derives each row once per data change, not per render or keystroke', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(KEY, rows);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><ToastProvider><ProcurementBlock showCreate={false} /></ToastProvider></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Row 0', undefined, { timeout: 60_000 })).toBeInTheDocument();
    expect(stats.rowDerivations).toBe(rows.length);

    // A keystroke re-renders the list, but no row needs its money/dates/age again.
    const input = screen.getByRole('searchbox');
    await act(async () => { fireEvent.change(input, { target: { value: 'Row 1' } }); });
    await act(async () => { fireEvent.change(input, { target: { value: 'Row 12' } }); });
    expect(stats.rowDerivations).toBe(rows.length);

    // Sorting reads the same cached values (the value/age comparators scan nothing).
    const valueHeader = screen.getByRole('button', { name: /^Value/ });
    await act(async () => { fireEvent.click(valueHeader); });
    const ageHeader = screen.getByRole('button', { name: /^Age/ });
    await act(async () => { fireEvent.click(ageHeader); });
    expect(stats.rowDerivations).toBe(rows.length);

    // A data change is the one trigger that derives again — once per row, no more.
    await act(async () => { fireEvent.change(input, { target: { value: '' } }); });
    const changed = rows.map((row, i) => (i === 0 ? { ...row, title: 'Row 0 renamed' } : row));
    store.rows = changed;
    await act(async () => { client.setQueryData(KEY, changed); });
    expect(await screen.findByText('Row 0 renamed', undefined, { timeout: 60_000 })).toBeInTheDocument();
    expect(stats.rowDerivations).toBe(rows.length * 2);
  }, 300_000);
});
