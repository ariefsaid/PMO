import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── Repository-seam-backed hooks are mocked; the page is the unit under test. ──
const { listState, mutations, navigateMock, useMeetingsSpy } = vi.hoisted(() => ({
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
  navigateMock: vi.fn(),
  useMeetingsSpy: vi.fn(),
}));

vi.mock('@/src/hooks/useMeetings', () => ({
  useMeetings: (params: unknown) => {
    useMeetingsSpy(params);
    return listState;
  },
  useMeetingMutations: () => mutations,
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [{ id: 'p1', name: 'Harbour Upgrade' }], isPending: false }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }),
}));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigateMock };
});

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
    project_id: 'p1',
    project: { id: 'p1', name: 'Harbour Upgrade', project_manager_id: null, pm: null },
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

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter>
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
  navigateMock.mockClear();
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
    expect(navigateMock).toHaveBeenCalledWith('/meetings/m1');
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

  it('an Engineer row menu offers Open (navigation, M13) but NO archive/delete affordance', async () => {
    realRole = 'Engineer';
    renderPage('Engineer');
    const row = screen.getByText('Supplier dispute call').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Row actions' }));
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
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
