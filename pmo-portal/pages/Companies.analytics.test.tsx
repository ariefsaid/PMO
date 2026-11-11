import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── Companies — page-level proof that the reference-template slice reaches the
// analytics facade at its real call sites (filter_applied, empty_state_seen,
// search_used) — 2026-07-13 wiring plan. The facade contract itself (safe props,
// debounce, opt-in) is covered by the shared-boundary tests
// (index.test.ts / ListState.test.tsx / SearchMini.analytics.test.tsx); this file
// only proves Companies.tsx actually calls through.
const { h, mutations, navigateMock, analytics } = vi.hoisted(() => ({
  // #1989: the page reads ONE SERVER page, so the mock is a server stub mirroring the directory
  // read's contract (type filter + search applied before the window, exact total).
  h: {
    directory: [] as Array<Record<string, unknown>>,
    pending: false,
    error: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  },
  navigateMock: vi.fn(),
  analytics: {
    trackFilterApplied: vi.fn(),
    trackEmptyStateSeen: vi.fn(),
    trackSearchUsed: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompaniesPage: (input: { type: string; search: string; page: number; pageSize: number }) => {
    const q = input.search.trim().toLowerCase();
    const matching = h.directory.filter((c) => {
      const typeOk = input.type === 'All' || c.type === input.type;
      const searchOk = !q || String(c.name).toLowerCase().includes(q) || String(c.short_name ?? '').toLowerCase().includes(q);
      return typeOk && searchOk;
    });
    const start = (input.page - 1) * input.pageSize;
    return {
      data: { rows: matching.slice(start, start + input.pageSize), total: matching.length },
      isPending: h.pending,
      isError: h.error,
      isFetching: false,
      refetch: h.refetch,
    };
  },
  useCompaniesTotal: () => ({ data: null, isPending: false, isError: false }),
  useCompaniesExportAll: () => ({ mutateAsync: vi.fn(async () => h.directory), isPending: false }),
  useCompanyMutations: () => mutations,
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigateMock };
});

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

vi.mock('@/src/lib/analytics', () => ({
  trackFilterApplied: analytics.trackFilterApplied,
  trackEmptyStateSeen: analytics.trackEmptyStateSeen,
  trackSearchUsed: analytics.trackSearchUsed,
}));

import Companies from './Companies';

const seed = [
  { id: 'c1', name: 'Cascade Port Authority', type: 'Client', org_id: 'org-1', archived_at: null, created_at: '2026-01-01T00:00:00Z' },
  { id: 'c2', name: 'Steelforge Fabrication', type: 'Vendor', org_id: 'org-1', archived_at: null, created_at: '2026-02-01T00:00:00Z' },
];

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter>
        <Companies />
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  h.directory = seed;
  h.pending = false;
  h.error = false;
  navigateMock.mockClear();
  analytics.trackFilterApplied.mockClear();
  analytics.trackEmptyStateSeen.mockClear();
  analytics.trackSearchUsed.mockClear();
  realRole = 'Admin';
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Companies: filter_applied fires when the type filter changes', () => {
  it('AC: clicking a type filter segment fires filter_applied with filter_id + option_count + module', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Supplier' }));
    expect(analytics.trackFilterApplied).toHaveBeenCalledWith('type', 4, 'companies');
  });
});

describe('Companies: empty_state_seen fires when the directory has no companies', () => {
  it('AC: renders the empty ListState and fires empty_state_seen with state_id/role/module', async () => {
    h.directory = [];
    renderPage('Admin');
    expect(screen.getByText('No companies yet')).toBeInTheDocument();
    // The facade is loaded lazily (ListState defers the analytics chunk off the first paint).
    await waitFor(() => {
      expect(analytics.trackEmptyStateSeen).toHaveBeenCalledWith('companies-empty', 'Admin', 'companies');
    });
  });
});

describe('Companies: search_used fires (debounced) at the reference-template search box', () => {
  it('AC: typing a query and going idle fires search_used with the current result count', () => {
    renderPage();
    const input = screen.getByLabelText('Search companies');
    fireEvent.change(input, { target: { value: 'cascade' } });
    vi.advanceTimersByTime(500);
    expect(analytics.trackSearchUsed).toHaveBeenCalledWith('companies-list', 1, 'companies');
  });
});
