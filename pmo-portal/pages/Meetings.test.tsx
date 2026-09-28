import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── Repository-seam-backed hooks are mocked; the page is the unit under test. ──
const { listState, mutations, useMeetingsSpy } = vi.hoisted(() => ({
  listState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    addAttendee: { mutateAsync: vi.fn(), isPending: false },
    removeAttendee: { mutateAsync: vi.fn(), isPending: false },
    addGrant: { mutateAsync: vi.fn(), isPending: false },
    revokeGrant: { mutateAsync: vi.fn(), isPending: false },
    createActionItem: { mutateAsync: vi.fn(), isPending: false },
  },
  useMeetingsSpy: vi.fn(),
}));

vi.mock('@/src/hooks/useMeetings', () => ({
  useMeetings: (params: { projectId?: string; search?: string } = {}) => {
    useMeetingsSpy(params);
    // list-working-set-return (#683): Meetings' search/project narrowing is a SERVER query
    // (DD-MTG-5) — simulate that here so an AC-LRC-012 zero-match/clear-filters case is
    // observable through the page, not just as a spy call.
    return { ...listState, data: params.projectId || params.search ? [] : listState.data };
  },
  useMeetingMutations: () => mutations,
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Harbour Upgrade' }], isPending: false }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

// list-working-set-return (#683): the page writes real router navigation for its `project`/`q`
// URL state and for record-open return context, so `react-router` stays UNMOCKED — a LocationProbe
// sibling (below) reads the real `useLocation()` to assert the resulting URL/state.

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import Meetings from './Meetings';

const seed = [
  {
    id: 'm1',
    title: 'Kickoff with Acme',
    occurred_at: '2026-08-20T09:00:00Z',
    location: 'Site office',
    project_id: '33333333-3333-4333-8333-333333333333',
    project: { id: '33333333-3333-4333-8333-333333333333', name: 'Harbour Upgrade', project_manager_id: null, pm: null },
    created_by_id: 'u1',
    archived_at: null,
    is_template: false,
    notes: [],
  },
  {
    id: 'm2',
    title: 'Supplier dispute call',
    occurred_at: '2026-08-22T13:00:00Z',
    location: null,
    project_id: null,
    project: null,
    created_by_id: 'u9',
    archived_at: null,
    is_template: false,
    notes: [],
  },
];

// list-working-set-return (#683): reads the REAL router location so tests can assert the URL
// (filter/search round-trip) and the record-open return-context `location.state`.
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-search={location.search}
    >
      {JSON.stringify(location.state ?? null)}
    </div>
  );
};

const renderPage = (role: Role = 'Admin', initialPath = '/meetings') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <Meetings />
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  listState.refetch.mockClear();
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  useMeetingsSpy.mockClear();
  realRole = 'Admin';
});

describe('Meetings index — list (FR-MTG-028/029)', () => {
  it('renders the seeded meetings with title, project, and location', () => {
    renderPage();
    expect(screen.getByText('Kickoff with Acme')).toBeInTheDocument();
    expect(screen.getByText('Supplier dispute call')).toBeInTheDocument();
    // 'Harbour Upgrade' also appears as a project-filter option — scope to the row.
    const row = screen.getByText('Kickoff with Acme').closest('tr')!;
    expect(within(row).getByText('Harbour Upgrade')).toBeInTheDocument();
    expect(within(row).getByText('Site office')).toBeInTheDocument();
  });

  it('a row activates into the /meetings/:id detail route', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Kickoff with Acme'));
    expect(screen.getByTestId('location-probe').dataset.pathname).toBe('/meetings/m1');
  });

  it('the search box drives the SERVER query (DD-MTG-5 — notes are the find mechanism)', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Search meetings/i), 'pipeline');
    expect(useMeetingsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'pipeline' }),
    );
  });
});

describe('Meetings — create affordance (OD-MTG-1: EVERY role, Engineer included)', () => {
  it.each(['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'] as Role[])(
    '%s sees the New meeting button',
    (role) => {
      renderPage(role);
      expect(screen.getByRole('button', { name: /New meeting/ })).toBeInTheDocument();
    },
  );
});

describe('Meetings — row menu gating', () => {
  it('Admin gets Archive + Delete in the row menu', async () => {
    renderPage('Admin');
    const row = screen.getByText('Supplier dispute call').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('AC-MTG-029: an Engineer author may archive own row but not a non-authored row', async () => {
    renderPage('Engineer');
    const ownRow = screen.getByText('Kickoff with Acme').closest('tr')!;
    await userEvent.click(within(ownRow).getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();

    const nonAuthoredRow = screen.getByText('Supplier dispute call').closest('tr')!;
    await userEvent.click(within(nonAuthoredRow).getByRole('button', { name: 'Row actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('Meetings — states', () => {
  it('empty state renders with the create affordance', () => {
    listState.data = [];
    renderPage();
    expect(screen.getByText('No meetings yet')).toBeInTheDocument();
  });

  it('error state renders with retry', async () => {
    listState.isError = true;
    listState.data = [] as never;
    renderPage();
    expect(screen.getByText("Couldn't load meetings")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Try again|Retry/i }));
    expect(listState.refetch).toHaveBeenCalled();
  });

  it('loading state renders the skeleton', () => {
    listState.isPending = true;
    renderPage();
    expect(screen.queryByText('Kickoff with Acme')).not.toBeInTheDocument();
  });
});

// list-working-set-return (#683, AC-LRC-008): `project`/`q` round-trip through the URL, and
// opening a row stamps a validated Meetings return context onto the navigation's router state.
// The existing deferred SERVER search + newest-first query are unchanged (see Meetings.tsx).
describe('Meetings index — list working set + return context (AC-LRC-008)', () => {
  it('a direct URL with ?project= restores the selected filter and queries the server for it', () => {
    renderPage('Admin', '/meetings?project=33333333-3333-4333-8333-333333333333');
    expect(useMeetingsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: '33333333-3333-4333-8333-333333333333' }),
    );
  });

  it('choosing a project filter writes ?project= to the URL', async () => {
    renderPage('Admin');
    await userEvent.selectOptions(
      screen.getByLabelText(/Filter by project/i),
      '33333333-3333-4333-8333-333333333333',
    );
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').dataset.search).toBe(
        '?project=33333333-3333-4333-8333-333333333333',
      ),
    );
  });

  it('opening a row stamps a validated Meetings return context onto the navigation state', async () => {
    renderPage('Admin');
    await userEvent.click(screen.getByText('Supplier dispute call'));
    await waitFor(() => {
      const probe = screen.getByTestId('location-probe');
      expect(probe.dataset.pathname).toBe('/meetings/m2');
      const state = JSON.parse(probe.textContent || 'null');
      expect(state.pmoListReturn).toMatchObject({ list: 'meetings', path: '/meetings' });
    });
  });

  it('AC-LRC-012: a zero-match server filter offers Clear filters, which restores the rows', async () => {
    renderPage('Admin');
    await userEvent.selectOptions(
      screen.getByLabelText(/Filter by project/i),
      '33333333-3333-4333-8333-333333333333',
    );
    expect(await screen.findByText(/No meetings match/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(await screen.findByText('Kickoff with Acme')).toBeInTheDocument();
    expect(screen.getByText('Supplier dispute call')).toBeInTheDocument();
  });
});
