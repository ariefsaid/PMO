import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => {
  const rows = Array.from({ length: 200 }, (_, index) => ({
    id: `c${index}`,
    name: `Company ${index}`,
    type: index % 2 ? 'Vendor' : 'Client',
    org_id: 'org-1',
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
  }));
  return {
    // Stable identity, like react-query's cached data: a hook returning a NEW object each
    // render would (correctly) invalidate the table's row memo on every render.
    page: { data: { rows, total: rows.length }, isPending: false, isError: false, isFetching: false, refetch: vi.fn() },
    mutation: { mutateAsync: vi.fn(), isPending: false },
    cells: [] as string[],
  };
});

vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompaniesPage: () => h.page,
  useCompaniesTotal: () => ({ data: null, isPending: false, isError: false }),
  useCompaniesExportAll: () => h.mutation,
  useCompanyMutations: () => ({ create: h.mutation, update: h.mutation, setProjectNumberSegment: h.mutation, archive: h.mutation, remove: h.mutation }),
}));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx: vi.fn(), busy: false }) }));
vi.mock('@/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/components/ui')>();
  const { countingDataTable } = await import('@/src/components/ui/__tests__/helpers/countingDataTable');
  return { ...actual, DataTable: countingDataTable(actual.DataTable, h.cells) };
});

import Companies from './Companies';

describe('Companies page render cost', () => {
  it('AC-PERF-2102: opening the New company dialog repaints no row of a 200-row directory (columns are memoised)', async () => {
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/companies']}>
          <Companies />
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(screen.getAllByRole('row').length).toBeGreaterThan(200);

    h.cells.length = 0;
    await userEvent.click(screen.getByRole('button', { name: /new company/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(h.cells).toEqual([]);
  });
});
