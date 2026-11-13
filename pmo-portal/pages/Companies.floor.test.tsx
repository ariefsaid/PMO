import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast as sonnerToast } from 'sonner';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({
  directory: [] as Array<Record<string, unknown>>,
  lastInput: null as Record<string, unknown> | null,
  refetch: vi.fn(),
  exportAll: vi.fn(),
  exportXlsx: vi.fn(),
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    setProjectNumberSegment: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompaniesPage: (input: { type: string; search: string; page: number; pageSize: number }) => {
    h.lastInput = input;
    const q = input.search.trim().toLowerCase();
    const matching = h.directory.filter((company) =>
      (input.type === 'All' || company.type === input.type)
      && (!q || String(company.name).toLowerCase().includes(q)),
    );
    const start = (input.page - 1) * input.pageSize;
    return {
      data: { rows: matching.slice(start, start + input.pageSize), total: matching.length },
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: h.refetch,
    };
  },
  useCompaniesTotal: () => ({ data: null, isPending: false, isError: false }),
  useCompaniesExportAll: () => ({ mutateAsync: h.exportAll, isPending: false }),
  useCompanyMutations: () => h.mutations,
}));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx: h.exportXlsx, busy: false }) }));
vi.mock('@/src/components/import/ImportWizard', () => ({
  ImportWizard: ({ onClose }: { onClose: (didImport: boolean) => void }) => (
    <div role="dialog" aria-label="Import companies">
      <button type="button" onClick={() => onClose(true)}>Finish imported batch</button>
    </div>
  ),
}));

import Companies from './Companies';
import { ownershipMock } from '@/test/domainOwnershipMock';
import { clearOwnershipCache } from '@/src/lib/adapterSeam/ownershipCache';

let realRole: Role = 'Admin';
const seed = [
  { id: 'c1', name: 'Client Atlas', type: 'Client', org_id: 'org-1', archived_at: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'c2', name: 'Vendor Beacon', type: 'Vendor', org_id: 'org-1', archived_at: null, created_at: '2026-02-01T00:00:00Z' },
  { id: 'c3', name: 'Internal Company', type: 'Internal', org_id: 'org-1', archived_at: null, created_at: '2026-03-01T00:00:00Z' },
];

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location-probe" data-pathname={location.pathname} />;
};

const renderPage = (role: Role = 'Admin', initialPath = '/companies') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Companies />
      </MemoryRouter>
    </ToastProvider>,
  );
};

afterEach(() => act(() => { sonnerToast.dismiss(); }));

beforeEach(() => {
  h.directory = [...seed];
  h.lastInput = null;
  h.refetch.mockReset();
  h.exportAll.mockReset().mockResolvedValue(seed);
  h.exportXlsx.mockReset();
  Object.values(h.mutations).forEach((mutation) => {
    mutation.mutateAsync.mockReset().mockResolvedValue(undefined);
    mutation.isPending = false;
  });
  realRole = 'Admin';
  ownershipMock.override = null;
  ownershipMock.retry.mockClear();
  clearOwnershipCache();
});

describe('Companies floor controls', () => {
  it('floor: Export fetches and captures the matching directory workbook', async () => {
    const matches = Array.from({ length: 55 }, (_, index) => ({
      ...seed[0],
      id: `atlas-${index + 1}`,
      name: `Client Atlas ${index + 1}`,
    }));
    h.directory = [...matches, seed[1], seed[2]];
    h.exportAll.mockResolvedValue(matches);
    renderPage('Admin', '/companies?type=Client&q=Atlas');
    await userEvent.click(screen.getByRole('button', { name: /^export$/i }));

    await waitFor(() => expect(h.exportAll).toHaveBeenCalledWith({ type: 'Client', search: 'Atlas' }));
    await waitFor(() => expect(h.exportXlsx).toHaveBeenCalledOnce());
    const [rows, columns, entity] = h.exportXlsx.mock.calls[0];
    expect(rows).toEqual(matches);
    expect(rows).toHaveLength(55);
    expect(columns.map((column: { key: string }) => column.key)).toEqual(['name', 'type']);
    expect(entity).toBe('Companies');
  });

  it('floor: Import opens the company wizard and refreshes the directory after a committed batch', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));
    const wizard = screen.getByRole('dialog', { name: 'Import companies' });
    await userEvent.click(within(wizard).getByRole('button', { name: 'Finish imported batch' }));

    expect(screen.queryByRole('dialog', { name: 'Import companies' })).not.toBeInTheDocument();
    expect(h.refetch).toHaveBeenCalledOnce();
  });

  it('floor: Dismiss closes the in-use delete notice and leaves the company row usable', async () => {
    h.mutations.remove.mutateAsync.mockRejectedValue(new AppError('foreign key violation', '23503'));
    renderPage();
    await userEvent.click(within(screen.getByText('Client Atlas').closest('tr')!).getByRole('button', { name: /row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /delete/i }));
    await userEvent.click(screen.getByRole('button', { name: /delete company/i }));

    const gate = await screen.findByTestId('company-delete-gate');
    expect(gate).toHaveTextContent('Client Atlas');
    await userEvent.click(within(gate).getByRole('button', { name: /^dismiss$/i }));

    expect(screen.queryByTestId('company-delete-gate')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Client Atlas' })).toBeInTheDocument();
    expect(h.mutations.remove.mutateAsync).toHaveBeenCalledOnce();
    expect(h.mutations.archive.mutateAsync).not.toHaveBeenCalled();
  });

  it('floor: Previous page returns the directory to its first rows', async () => {
    h.directory = [
      ...seed,
      ...Array.from({ length: 57 }, (_, index) => ({
        id: `c-bulk-${index}`,
        name: `Bulk Company ${String(index + 1).padStart(2, '0')}`,
        type: 'Client',
        archived_at: null,
      })),
    ];
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => expect(screen.getByText('Bulk Company 51')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /previous page/i }));
    await waitFor(() => expect(screen.getByText('Client Atlas')).toBeInTheDocument());
    expect(screen.queryByText('Bulk Company 51')).not.toBeInTheDocument();
    expect(h.lastInput).toMatchObject({ page: 1 });
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
  });

  it('floor: Back to Dashboard opens the dashboard from the denied company route', async () => {
    renderPage('Engineer');
    await userEvent.click(screen.getByRole('button', { name: /back to dashboard/i }));

    await waitFor(() => expect(screen.getByTestId('location-probe')).toHaveAttribute('data-pathname', '/'));
    expect(screen.queryByText('Client Atlas')).not.toBeInTheDocument();
  });
});
