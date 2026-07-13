import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── Companies — page-level proof that the reference-template slice reaches the
// analytics facade at its real call sites (filter_applied, empty_state_seen,
// search_used) — 2026-07-13 wiring plan. The facade contract itself (safe props,
// debounce, opt-in) is covered by the shared-boundary tests
// (index.test.ts / ListState.test.tsx / SearchMini.analytics.test.tsx); this file
// only proves Companies.tsx actually calls through.
const { listState, mutations, navigateMock, analytics } = vi.hoisted(() => ({
  listState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
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

vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => listState,
  useCompanyMutations: () => mutations,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
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
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  navigateMock.mockClear();
  analytics.trackFilterApplied.mockClear();
  analytics.trackEmptyStateSeen.mockClear();
  analytics.trackSearchUsed.mockClear();
  realRole = 'Admin';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Companies: filter_applied fires when the type filter changes', () => {
  it('AC: clicking a type filter segment fires filter_applied with filter_id + option_count + module', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Vendor' }));
    expect(analytics.trackFilterApplied).toHaveBeenCalledWith('type', 4, 'companies');
  });
});

describe('Companies: empty_state_seen fires when the directory has no companies', () => {
  it('AC: renders the empty ListState and fires empty_state_seen with state_id/role/module', () => {
    listState.data = [];
    renderPage('Admin');
    expect(screen.getByText('No companies yet')).toBeInTheDocument();
    expect(analytics.trackEmptyStateSeen).toHaveBeenCalledWith('companies-empty', 'Admin', 'companies');
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
