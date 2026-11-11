import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

/**
 * R2 (ux/1110): the incidents page number joins q/status in the URL, so paging to page 2 and
 * opening a record keeps the page on Back (and a refresh of ?page=2 reopens page 2).
 */

const { listState, mutations, pageCalls } = vi.hoisted(() => ({
  pageCalls: [] as Array<{ page: number; pageSize: number; status?: string; search?: string }>,
  listState: {
    data: [] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useIncidents', () => ({
  useIncidentsPage: (args: { page: number; pageSize: number; status?: string; search?: string }) => {
    pageCalls.push(args);
    const all = listState.data;
    return {
      list: {
        data: { rows: all, total: all.length },
        isPending: listState.isPending,
        isError: listState.isError,
        refetch: listState.refetch,
      },
      allTotal: all.length,
    };
  },
  useIncidentsExportAll: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useIncidentMutations: () => mutations,
}));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import Incidents from './Incidents';

// 120 rows across three pages at INCIDENTS_PAGE_SIZE = 50: page 2 holds 51–100 and page 3 exists.
const seed = Array.from({ length: 120 }, (_, i) => ({
  id: `i${i + 1}`,
  org_id: 'org-1',
  incident_date: '2026-03-15',
  type: `Near Miss ${i + 1}`,
  severity: 'Low',
  location: 'Site B',
  description: 'Trip hazard',
  status: 'Open',
  reported_by: 'u1',
  created_at: '2026-03-15T00:00:00Z',
}));

const LocationProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="location-probe" data-search={location.search} />;
};

const renderPage = (initialPath = '/incidents') => {
  realRole = 'Admin';
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Incidents />
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  pageCalls.length = 0;
});

describe('R2 — incidents pagination lives in the URL', () => {
  it('a refresh of ?page=2 reopens page 2 and asks the server for it', () => {
    renderPage('/incidents?page=2');
    // The visible window is rows 51–100 of 120, and the server read asked for page 2.
    expect(screen.getByText('51–100 of 120')).toBeInTheDocument();
    expect(pageCalls.at(-1)).toMatchObject({ page: 2 });
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?page=2');
  });

  it('stepping to the next page writes ?page= into the URL', async () => {
    const user = userEvent.setup();
    renderPage('/incidents?page=2');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '?page=3');
    expect(pageCalls.at(-1)).toMatchObject({ page: 3 });
  });

  it('page 1 stays out of the URL (the default is empty)', async () => {
    const user = userEvent.setup();
    renderPage('/incidents?page=2');
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByTestId('location-probe')).toHaveAttribute('data-search', '');
    expect(pageCalls.at(-1)).toMatchObject({ page: 1 });
  });
});
