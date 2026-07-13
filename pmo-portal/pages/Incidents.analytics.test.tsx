import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// filter_applied / search_used — 2026-07-13 wiring plan.
const analytics = vi.hoisted(() => ({
  trackFilterApplied: vi.fn(),
  trackSearchUsed: vi.fn(),
  trackEmptyStateSeen: vi.fn(),
}));
vi.mock('@/src/lib/analytics', () => ({
  trackFilterApplied: analytics.trackFilterApplied,
  trackSearchUsed: analytics.trackSearchUsed,
  trackEmptyStateSeen: analytics.trackEmptyStateSeen,
}));

const { listState, mutations } = vi.hoisted(() => ({
  listState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useIncidents', () => ({
  useIncidents: () => listState,
  useIncidentMutations: () => mutations,
}));
vi.mock('@/src/hooks/useFkOptions', () => ({ useProjectOptions: () => ({ data: [] }) }));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import Incidents from './Incidents';

const seed = [
  {
    id: 'i1', org_id: 'org-1', incident_date: '2026-03-15', type: 'Near Miss', severity: 'Low',
    location: 'Site B', description: 'Trip hazard', status: 'Open', reported_by: 'u1',
    created_at: '2026-03-15T00:00:00Z',
  },
];

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter>
        <Incidents />
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  analytics.trackFilterApplied.mockClear();
  analytics.trackSearchUsed.mockClear();
  analytics.trackEmptyStateSeen.mockClear();
  realRole = 'Admin';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Incidents: filter_applied fires on the status SegFilter', () => {
  it('AC: switching to Closed fires filter_applied with the option-set size', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /^Closed$/ }));
    expect(analytics.trackFilterApplied).toHaveBeenCalledWith('status', 4, 'incidents');
  });
});

describe('Incidents: search_used fires (debounced) at the search box', () => {
  it('AC: typing and going idle fires search_used', () => {
    renderPage();
    const input = screen.getByLabelText('Search incidents');
    fireEvent.change(input, { target: { value: 'trip' } });
    vi.advanceTimersByTime(500);
    expect(analytics.trackSearchUsed).toHaveBeenCalledWith('incidents-list', expect.any(Number), 'incidents');
  });
});

describe('Incidents: empty_state_seen fires when there are zero incidents (FIX 1)', () => {
  it('AC: renders the empty ListState and fires empty_state_seen with state_id/role/module', () => {
    listState.data = [];
    renderPage('Project Manager');
    expect(screen.getByText('No incidents reported')).toBeInTheDocument();
    expect(analytics.trackEmptyStateSeen).toHaveBeenCalledWith(
      'incidents-empty',
      'Project Manager',
      'incidents',
    );
  });
});
