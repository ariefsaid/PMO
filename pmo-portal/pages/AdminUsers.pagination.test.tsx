import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

/**
 * Server-page behaviour of the Administration › Users directory (slice: list pagination +
 * minimal projections). The DAL/repository are covered in adminUsers.paging.test.ts; this file
 * pins the PAGE contract: one page on the wire, exact whole-org total, page reset on search,
 * out-of-range correction, manager jump + return, and the tri-state sole-Admin predicate.
 */
type DirectoryUser = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
  org_id: string;
  manager_id: string | null;
  manager?: { full_name: string } | null;
};

type ManagerChoice = { id: string; full_name: string; role: string };

const h = vi.hoisted(() => {
  const state = {
    all: [] as DirectoryUser[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    /** null = unresolved count (must never read as zero). */
    countsOverride: undefined as Record<string, number | null> | undefined,
    countsError: false,
    countsPending: false,
    /** The lookup answer used for every target unless `focusById` pins one per person. */
    focus: null as null | { page: number; email: string; full_name: string },
    /** Per-target cached answers — the real hook keys its query by the target id. */
    focusById: {} as Record<string, { page: number; email: string; full_name: string }>,
    focusPendingById: {} as Record<string, boolean>,
    focusIsPending: false,
    focusError: false,
    focusRefetch: vi.fn(),
    currentUserId: 'u-me',
    isOperator: false,
    /** People list for the manager picker: its state is the picker's load contract. */
    choicesState: 'ready' as 'ready' | 'loading' | 'error',
    choicesData: [] as ManagerChoice[],
    choicesEnables: [] as boolean[],
    choicesRefetch: vi.fn(),
    pageCalls: [] as Array<{ page: number; pageSize: number; search?: string }>,
    countCalls: [] as string[][],
    focusCalls: [] as string[],
  };
  const counts = (orgIds: string[]) => {
    if (state.countsOverride) return state.countsOverride;
    const out: Record<string, number> = {};
    for (const org of orgIds) out[org] = 0;
    for (const u of state.all) {
      if (out[u.org_id] === undefined) out[u.org_id] = 0;
      if (u.role === 'Admin' && u.status === 'active') out[u.org_id] += 1;
    }
    return out;
  };
  return { state, counts, assignManager: vi.fn() };
});

vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => ({ data: h.state.all, isPending: false, isError: false, refetch: vi.fn() }),
  useUsersPage: (input: { page: number; pageSize: number; search?: string }) => {
    h.state.pageCalls.push(input);
    const term = (input.search ?? '').trim().toLowerCase();
    const matched = term
      ? h.state.all.filter((u) => u.full_name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
      : h.state.all;
    const from = (input.page - 1) * input.pageSize;
    return {
      data: { rows: matched.slice(from, from + input.pageSize), total: matched.length },
      isPending: h.state.isPending,
      isError: h.state.isError,
      isFetching: false,
      refetch: h.state.refetch,
    };
  },
  useActiveAdminCounts: (orgIds: string[]) => {
    h.state.countCalls.push(orgIds);
    return {
      data: h.counts(orgIds),
      isPending: h.state.countsPending,
      isError: h.state.countsError,
      refetch: vi.fn(),
    };
  },
  useUserFocusPage: (userId: string | null) => {
    if (userId) h.state.focusCalls.push(userId);
    // Mirrors the real hook: the answer belongs to the REQUESTED target (the query is keyed by id),
    // so a superseded target's late answer never reaches the component as the current value.
    const pending = Boolean(userId) && (h.state.focusPendingById[userId as string] ?? h.state.focusIsPending);
    return {
      // A pending query has NO value yet — `null` is a resolved "not readable".
      data: userId && !pending ? (h.state.focusById[userId] ?? h.state.focus) : undefined,
      isPending: pending,
      isError: Boolean(userId) && h.state.focusError,
      isFetching: false,
      refetch: h.state.focusRefetch,
    };
  },
  useManagerChoices: (opts?: { enabled?: boolean }) => {
    const enabled = opts?.enabled !== false;
    h.state.choicesEnables.push(enabled);
    return {
      data: enabled && h.state.choicesState === 'ready' ? h.state.choicesData : undefined,
      isPending: !enabled || h.state.choicesState === 'loading',
      isError: enabled && h.state.choicesState === 'error',
      isFetching: false,
      refetch: h.state.choicesRefetch,
    };
  },
  useUserMutations: () => ({
    updateRole: { mutateAsync: vi.fn(), isPending: false },
    assignManager: { mutateAsync: h.assignManager, isPending: false },
    invite: { mutateAsync: vi.fn(), isPending: false },
    setStatus: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: h.state.currentUserId, org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => h.state.isOperator }));
vi.mock('@/src/hooks/useUsage', () => ({
  useUsage: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAgentRunStats: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {} }) }));
vi.mock('@/src/lib/repositories/admin', () => ({
  creditsRepository: { getOrgBalance: vi.fn().mockResolvedValue(0), grant: vi.fn().mockResolvedValue(undefined) },
  orgFeatureRepository: { listOwn: vi.fn().mockResolvedValue({}), toggle: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }),
}));

import AdminUsers from './AdminUsers';

function makeUsers(count: number): DirectoryUser[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    return {
      id: `u-${n}`,
      full_name: `Person ${n}`,
      email: `person-${n}@meridian.example`,
      role: 'Engineer',
      status: 'active',
      org_id: 'org-1',
      manager_id: null,
    };
  });
}

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <AdminUsers />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

const dataRowCount = () => screen.getAllByRole('row').filter((r) => within(r).queryByText(/@meridian/)).length;
const rowFor = (email: string) => screen.getByText(email).closest('tr') as HTMLElement;
const range = () => screen.getByTestId('admin-users-range');

const openRowMenu = async (email: string) => {
  await userEvent.click(within(rowFor(email)).getByRole('button', { name: /Row actions/i }));
};

const openManagerModal = async (email: string) => {
  await openRowMenu(email);
  await userEvent.click(screen.getByRole('menuitem', { name: /Change manager/i }));
  return screen.getByRole('dialog');
};

beforeEach(() => {
  h.state.all = makeUsers(120);
  h.state.isPending = false;
  h.state.isError = false;
  h.state.countsOverride = undefined;
  h.state.countsError = false;
  h.state.countsPending = false;
  h.state.focus = null;
  h.state.focusById = {};
  h.state.focusPendingById = {};
  h.state.focusIsPending = false;
  h.state.focusError = false;
  h.state.currentUserId = 'u-me';
  h.state.isOperator = false;
  h.state.choicesState = 'ready';
  h.state.choicesData = [];
  h.state.choicesEnables.length = 0;
  h.state.pageCalls.length = 0;
  h.state.countCalls.length = 0;
  h.state.focusCalls.length = 0;
  h.state.refetch.mockClear();
  h.state.focusRefetch.mockClear();
  h.state.choicesRefetch.mockClear();
  h.assignManager.mockClear();
});

describe('directory server pagination', () => {
  it('reads ONE page (never the whole org) with the exact whole-org total and a range', () => {
    renderPage();
    expect(dataRowCount()).toBe(50);
    expect(screen.getByTestId('admin-users-total')).toHaveTextContent('120');
    expect(range()).toHaveTextContent('1–50 of 120');
    // The first call is page 1 with the page size — no whole-list read.
    expect(h.state.pageCalls[0]).toMatchObject({ page: 1, pageSize: 50 });
  });

  it('next/prev move one page at a time and disable at the boundaries', async () => {
    renderPage();
    const prev = screen.getByRole('button', { name: /Previous page/i });
    const next = screen.getByRole('button', { name: /Next page/i });
    expect(prev).toBeDisabled();

    await userEvent.click(next);
    expect(range()).toHaveTextContent('51–100 of 120');
    expect(rowFor('person-051@meridian.example')).toBeInTheDocument();
    expect(screen.queryByText('person-001@meridian.example')).not.toBeInTheDocument();
    expect(prev).toBeEnabled();

    await userEvent.click(next);
    expect(range()).toHaveTextContent('101–120 of 120');
    expect(next).toBeDisabled();
    expect(dataRowCount()).toBe(20);

    await userEvent.click(prev);
    expect(range()).toHaveTextContent('51–100 of 120');
  });

  it('a search change resets to page 1 and applies the term on the server', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    expect(range()).toHaveTextContent('51–100 of 120');

    await userEvent.type(screen.getByLabelText(/Search users/i), 'Person 001');
    await waitFor(() => expect(range()).toHaveTextContent('1–1 of 1'));
    const last = h.state.pageCalls.at(-1)!;
    expect(last).toMatchObject({ page: 1, search: 'Person 001' });
    expect(screen.getByText('person-001@meridian.example')).toBeInTheDocument();
  });

  it('corrects a page that has gone out of range back to the last page holding rows', async () => {
    const view = renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    expect(range()).toHaveTextContent('51–100 of 120');

    // The org shrinks under the reader (a concurrent removal) to a single page.
    act(() => { h.state.all = h.state.all.slice(0, 50); });
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <MemoryRouter>
            <AdminUsers />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(range()).toHaveTextContent('1–50 of 50'));
    expect(dataRowCount()).toBe(50);
  });

  it('shows the error state with a retry, not an empty directory', async () => {
    h.state.isError = true;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(h.state.refetch).toHaveBeenCalled();
  });

  it('an unreadable total is an error with a retry, never a "0 of 0" empty directory', async () => {
    // The DAL refuses to convert an unresolved exact count into zero; the route must therefore
    // surface the failure rather than claim the org has no people.
    h.state.isError = true;
    h.state.all = [];
    renderPage();
    expect(screen.getByText(/Couldn't load users/i)).toBeInTheDocument();
    expect(screen.queryByText(/No users yet/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('admin-users-total')).not.toBeInTheDocument();
  });
});

describe('sole-Admin predicate is per org and independent of page/search', () => {
  it('two active Admins on DIFFERENT pages are both disablable — neither page claims a sole Admin', async () => {
    h.state.all = makeUsers(120);
    h.state.all[1] = { ...h.state.all[1], role: 'Admin' };
    h.state.all[60] = { ...h.state.all[60], role: 'Admin' };
    renderPage();

    const first = rowFor('person-002@meridian.example');
    expect(within(first).queryByText(/only active Admin/i)).not.toBeInTheDocument();
    await openRowMenu('person-002@meridian.example');
    expect(screen.getByRole('menuitem', { name: /Disable/i })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    const second = rowFor('person-061@meridian.example');
    expect(within(second).queryByText(/only active Admin/i)).not.toBeInTheDocument();
    await openRowMenu('person-061@meridian.example');
    expect(screen.getByRole('menuitem', { name: /Disable/i })).toBeInTheDocument();
  });

  it('a sole Admin is known from the whole-org count even when a page or a search hides them', async () => {
    h.state.all = makeUsers(120);
    h.state.all[0] = { ...h.state.all[0], role: 'Admin' };
    renderPage();

    // Page 2 has no Admin row: nothing is asserted about them there.
    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    expect(screen.queryByText(/only active Admin/i)).not.toBeInTheDocument();

    // A search that narrows to just that person still resolves them as the only active Admin.
    await userEvent.type(screen.getByLabelText(/Search users/i), 'person-001');
    await waitFor(() => expect(range()).toHaveTextContent('1–1 of 1'));
    const row = rowFor('person-001@meridian.example');
    expect(within(row).getByText(/only active Admin/i)).toBeInTheDocument();
    await openRowMenu('person-001@meridian.example');
    expect(screen.queryByRole('menuitem', { name: /Disable/i })).not.toBeInTheDocument();

    // The count is always the ORG's, never the visible rows'.
    expect(h.state.countCalls.length).toBeGreaterThan(0);
    expect(h.state.countCalls.every((ids) => ids.includes('org-1'))).toBe(true);
  });

  it('an UNRESOLVED count never disables an Admin and never claims a sole Admin', async () => {
    h.state.all = makeUsers(3);
    h.state.all[0] = { ...h.state.all[0], role: 'Admin' };
    h.state.countsOverride = { 'org-1': null };
    renderPage();

    const row = rowFor('person-001@meridian.example');
    expect(within(row).queryByText(/only active Admin/i)).not.toBeInTheDocument();
    await openRowMenu('person-001@meridian.example');
    expect(screen.queryByRole('menuitem', { name: /Disable/i })).not.toBeInTheDocument();
  });

  it('an initially PENDING count is unknown, not "not the sole admin"', async () => {
    h.state.all = makeUsers(3);
    h.state.all[0] = { ...h.state.all[0], role: 'Admin' };
    h.state.countsPending = true;
    h.state.countsOverride = { 'org-1': 1 };
    renderPage();

    const row = rowFor('person-001@meridian.example');
    expect(within(row).queryByText(/only active Admin/i)).not.toBeInTheDocument();
    await openRowMenu('person-001@meridian.example');
    expect(screen.queryByRole('menuitem', { name: /Disable/i })).not.toBeInTheDocument();
  });

  it('a FAILED refetch does not trust the cached prior count — no disable, no claim', async () => {
    // Cached answer from an earlier success says two admins; the refresh then fails, so the real
    // state is unknown. The stale number must not re-enable a destructive action.
    h.state.all = makeUsers(3);
    h.state.all[0] = { ...h.state.all[0], role: 'Admin' };
    h.state.countsOverride = { 'org-1': 2 };
    h.state.countsError = true;
    renderPage();

    const row = rowFor('person-001@meridian.example');
    expect(within(row).queryByText(/only active Admin/i)).not.toBeInTheDocument();
    await openRowMenu('person-001@meridian.example');
    expect(screen.queryByRole('menuitem', { name: /Disable/i })).not.toBeInTheDocument();
  });

  it('a zero count for a row that IS an active Admin is an inconsistency, not "multiple admins"', async () => {
    h.state.all = makeUsers(3);
    h.state.all[0] = { ...h.state.all[0], role: 'Admin' };
    h.state.countsOverride = { 'org-1': 0 };
    renderPage();

    const row = rowFor('person-001@meridian.example');
    expect(within(row).queryByText(/only active Admin/i)).not.toBeInTheDocument();
    await openRowMenu('person-001@meridian.example');
    expect(screen.queryByRole('menuitem', { name: /Disable/i })).not.toBeInTheDocument();
  });

  it("counts each row's OWN org (Operator reading two orgs) and never borrows another org's answer", async () => {
    h.state.isOperator = true;
    h.state.all = [
      { id: 'u-1', full_name: 'Org One Admin', email: 'one@meridian.example', role: 'Admin', status: 'active', org_id: 'org-1', manager_id: null },
      { id: 'u-2', full_name: 'Org Two Admin', email: 'two@meridian.example', role: 'Admin', status: 'active', org_id: 'org-2', manager_id: null },
    ];
    h.state.countsOverride = { 'org-1': 1, 'org-2': 2 };
    renderPage();

    const sole = rowFor('one@meridian.example');
    expect(within(sole).getByText(/only active Admin/i)).toBeInTheDocument();
    await openRowMenu('one@meridian.example');
    expect(screen.queryByRole('menuitem', { name: /Disable/i })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    const multiple = rowFor('two@meridian.example');
    expect(within(multiple).queryByText(/only active Admin/i)).not.toBeInTheDocument();
    await openRowMenu('two@meridian.example');
    expect(screen.getByRole('menuitem', { name: /Disable/i })).toBeInTheDocument();

    expect(h.state.countCalls.at(-1)).toEqual(expect.arrayContaining(['org-1', 'org-2']));
  });

  it('the resolved sole Admin is marked and cannot be disabled', async () => {
    h.state.all = makeUsers(3);
    h.state.all[0] = { ...h.state.all[0], role: 'Admin' };
    renderPage();

    const row = rowFor('person-001@meridian.example');
    expect(within(row).getByText(/only active Admin/i)).toBeInTheDocument();
    await openRowMenu('person-001@meridian.example');
    expect(screen.queryByRole('menuitem', { name: /Disable/i })).not.toBeInTheDocument();
  });
});

describe('manager picker choices are complete, minimal and lazily read', () => {
  it('reads NO people list until the picker is opened, then offers everyone except the edited user', async () => {
    h.state.all = makeUsers(3);
    h.state.choicesData = [
      { id: 'u-001', full_name: 'Person 001', role: 'Engineer' },
      { id: 'u-002', full_name: 'Person 002', role: 'Engineer' },
      { id: 'u-003', full_name: 'Person 003', role: 'Engineer' },
    ];
    renderPage();
    // Browsing the directory must not pay for the complete people list.
    expect(h.state.choicesEnables.length).toBeGreaterThan(0);
    expect(h.state.choicesEnables.every((enabled) => enabled === false)).toBe(true);

    const dialog = await openManagerModal('person-001@meridian.example');
    expect(h.state.choicesEnables).toContain(true);
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Manager/i }));
    const listbox = await screen.findByRole('listbox');
    // The edited person is not their own manager; everyone else is offerable.
    expect(within(listbox).queryByText('Person 001')).not.toBeInTheDocument();
    expect(within(listbox).getByText('Person 002')).toBeInTheDocument();
    expect(within(listbox).getByText('Person 003')).toBeInTheDocument();
  });

  it('keeps the current manager and blocks saving when the people list FAILS, with a retry', async () => {
    h.state.all = makeUsers(3);
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-002', manager: { full_name: 'Person 002' } };
    h.state.choicesState = 'error';
    renderPage();

    const dialog = await openManagerModal('person-001@meridian.example');
    // The saved manager is still named — the failure is not presented as "no manager".
    expect(within(dialog).getByText('Person 002')).toBeInTheDocument();
    expect(within(dialog).queryByText(/No manager/i)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Couldn't load/i)).toBeInTheDocument();

    const save = within(dialog).getByRole('button', { name: /Save manager/i });
    expect(save).toBeDisabled();
    // The destructive "clear" is not offered while the picker cannot show what it would clear —
    // that is the accidental-unlink path.
    expect(within(dialog).queryByRole('button', { name: /Clear manager/i })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /^Retry$/i }));
    expect(h.state.choicesRefetch).toHaveBeenCalled();
  });

  it('shows a loading state (not an empty picker) while the choices are still arriving', async () => {
    h.state.all = makeUsers(3);
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-002', manager: { full_name: 'Person 002' } };
    h.state.choicesState = 'loading';
    renderPage();

    const dialog = await openManagerModal('person-001@meridian.example');
    expect(within(dialog).getByText('Person 002')).toBeInTheDocument();
    expect(within(dialog).getByText(/Loading people/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Save manager/i })).toBeDisabled();
    // The picker cannot be opened onto a half-known list.
    expect(within(dialog).getByRole('combobox', { name: /Manager/i })).toBeDisabled();
  });

  it('an intentional clear after the list resolves still unlinks the manager', async () => {
    h.state.all = makeUsers(3);
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-002', manager: { full_name: 'Person 002' } };
    h.state.choicesData = [
      { id: 'u-002', full_name: 'Person 002', role: 'Engineer' },
      { id: 'u-003', full_name: 'Person 003', role: 'Engineer' },
    ];
    renderPage();

    const dialog = await openManagerModal('person-001@meridian.example');
    await userEvent.click(within(dialog).getByRole('button', { name: /Clear manager/i }));
    await userEvent.click(within(dialog).getByRole('button', { name: /Save manager/i }));
    await waitFor(() => expect(h.assignManager).toHaveBeenCalledWith({ id: 'u-001', managerId: null }));
  });
});

describe('manager jump across pages (AC-JR-W3B-E1 preserved)', () => {
  it('jumps to the manager page, highlights them, and returns to the page and search you left', async () => {
    h.state.all = makeUsers(120);
    // Person 001's manager is on page 2 and is NOT in the first page's rows.
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-060', manager: { full_name: 'Person 060' } };
    h.state.focus = { page: 2, email: 'person-060@meridian.example', full_name: 'Person 060' };
    renderPage();

    const managerButton = within(rowFor('person-001@meridian.example')).getByRole('button', { name: 'Person 060' });
    await userEvent.click(managerButton);

    expect(h.state.focusCalls).toContain('u-060');
    await waitFor(() => expect(range()).toHaveTextContent('51–100 of 120'));
    const target = rowFor('person-060@meridian.example');
    expect(target).toBeInTheDocument();
    expect(target.style.outline).toContain('2px');

    // The jump is announced with a way back, not a silent teleport.
    const notice = screen.getByTestId('admin-users-focus');
    expect(notice).toHaveTextContent(/Showing Person 060/i);
    await userEvent.click(within(notice).getByRole('button', { name: /Back to your page/i }));
    expect(range()).toHaveTextContent('1–50 of 120');
  });

  it('follows your OWN row when you are the manager and it sits on another page', async () => {
    h.state.currentUserId = 'u-060';
    h.state.all = makeUsers(120);
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-060', manager: { full_name: 'Person 060' } };
    h.state.focus = { page: 2, email: 'person-060@meridian.example', full_name: 'Person 060' };
    renderPage();

    await userEvent.click(within(rowFor('person-001@meridian.example')).getByRole('button', { name: 'Person 060' }));
    expect(h.state.focusCalls).toContain('u-060');
    await waitFor(() => expect(range()).toHaveTextContent('51–100 of 120'));
    expect(rowFor('person-060@meridian.example').style.outline).toContain('2px');
  });

  it('highlights the manager row itself, not an earlier row whose manager cell shows the same name', async () => {
    h.state.all = makeUsers(60);
    // Person 020 (earlier in the table) also reports Person 030 as their manager.
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-030', manager: { full_name: 'Person 030' } };
    h.state.all[19] = { ...h.state.all[19], manager_id: 'u-030', manager: { full_name: 'Person 030' } };
    h.state.focus = { page: 1, email: 'person-030@meridian.example', full_name: 'Person 030' };
    renderPage();

    await userEvent.click(within(rowFor('person-001@meridian.example')).getByRole('button', { name: 'Person 030' }));
    await waitFor(() => expect(rowFor('person-030@meridian.example').style.outline).toContain('2px'));
    expect(rowFor('person-020@meridian.example').style.outline).toBe('');
  });

  it('distinguishes two people with the same name by their actual identity', async () => {
    h.state.all = makeUsers(60);
    h.state.all[9] = { ...h.state.all[9], full_name: 'Alex Kim', email: 'alex-010@meridian.example' };
    h.state.all[39] = { ...h.state.all[39], full_name: 'Alex Kim', email: 'alex-040@meridian.example' };
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-040', manager: { full_name: 'Alex Kim' } };
    h.state.focus = { page: 1, email: 'alex-040@meridian.example', full_name: 'Alex Kim' };
    renderPage();

    await userEvent.click(within(rowFor('person-001@meridian.example')).getByRole('button', { name: 'Alex Kim' }));
    await waitFor(() => expect(rowFor('alex-040@meridian.example').style.outline).toContain('2px'));
    expect(rowFor('alex-010@meridian.example').style.outline).toBe('');
  });

  it('returns to the exact page AND a non-empty search you left', async () => {
    h.state.all = makeUsers(120);
    h.state.all[59] = { ...h.state.all[59], manager_id: 'u-005', manager: { full_name: 'Person 005' } };
    h.state.focus = { page: 1, email: 'person-005@meridian.example', full_name: 'Person 005' };
    renderPage();

    const search = screen.getByLabelText(/Search users/i);
    await userEvent.type(search, 'Person');
    // Wait for the debounced term to be COMMITTED to the page's server query, not merely typed.
    await waitFor(() => expect(h.state.pageCalls.at(-1)?.search).toBe('Person'));
    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    await waitFor(() => expect(range()).toHaveTextContent('51–100 of 120'));

    await userEvent.click(within(rowFor('person-060@meridian.example')).getByRole('button', { name: 'Person 005' }));
    // The jump must find a person the current search would exclude, so it drops the term.
    await waitFor(() => expect(range()).toHaveTextContent('1–50 of 120'));
    await waitFor(() => expect(search).toHaveValue(''));

    await userEvent.click(within(screen.getByTestId('admin-users-focus')).getByRole('button', { name: /Back to your page/i }));
    await waitFor(() => expect(range()).toHaveTextContent('51–100 of 120'));
    await waitFor(() => expect(search).toHaveValue('Person'));
  });

  it('a failed location lookup is recoverable — retry and a way back, never a dead button', async () => {
    h.state.all = makeUsers(60);
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-060', manager: { full_name: 'Person 060' } };
    h.state.focusError = true;
    renderPage();

    await userEvent.click(within(rowFor('person-001@meridian.example')).getByRole('button', { name: 'Person 060' }));
    const notice = await screen.findByTestId('admin-users-focus');
    expect(notice).toHaveTextContent(/couldn.t find where person 060 is/i);
    expect(range()).toHaveTextContent('1–50 of 60');

    await userEvent.click(within(notice).getByRole('button', { name: /^Retry$/i }));
    expect(h.state.focusRefetch).toHaveBeenCalled();
    await userEvent.click(within(notice).getByRole('button', { name: /Back to your page/i }));
    expect(screen.queryByTestId('admin-users-focus')).not.toBeInTheDocument();
  });

  it('a person who cannot be located is reported truthfully, with a way back', async () => {
    h.state.all = makeUsers(60);
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-060', manager: { full_name: 'Person 060' } };
    h.state.focus = null;
    renderPage();

    await userEvent.click(within(rowFor('person-001@meridian.example')).getByRole('button', { name: 'Person 060' }));
    const notice = await screen.findByTestId('admin-users-focus');
    expect(notice).toHaveTextContent(/no longer .*directory/i);
    expect(range()).toHaveTextContent('1–50 of 60');
    await userEvent.click(within(notice).getByRole('button', { name: /Back to your page/i }));
    expect(screen.queryByTestId('admin-users-focus')).not.toBeInTheDocument();
  });

  it('announces the lookup while it is still in flight instead of pretending a jump happened', async () => {
    h.state.all = makeUsers(60);
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-060', manager: { full_name: 'Person 060' } };
    h.state.focusIsPending = true;
    renderPage();

    await userEvent.click(within(rowFor('person-001@meridian.example')).getByRole('button', { name: 'Person 060' }));
    const notice = await screen.findByTestId('admin-users-focus');
    expect(notice).toHaveTextContent(/finding person 060/i);
    expect(range()).toHaveTextContent('1–50 of 60');
  });

  it('renders a manager from another page as their real name (not "No manager")', () => {
    h.state.all = makeUsers(60);
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-060', manager: { full_name: 'Person 060' } };
    renderPage();
    const row = rowFor('person-001@meridian.example');
    expect(within(row).getByRole('button', { name: 'Person 060' })).toBeInTheDocument();
    expect(within(row).queryByText(/No manager/i)).not.toBeInTheDocument();
  });

  // ── The resolved jump is applied ONCE per explicit jump. Afterwards the directory is the
  // user's: the pager and the search must work, and Back must still return to where the jump
  // started. (Regression: re-running the jump effect on every page/search change forced the
  // reader back to the manager's page and wiped any search they typed.)

  it('applies the jump once — the pager keeps working after following a manager', async () => {
    h.state.all = makeUsers(120);
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-060', manager: { full_name: 'Person 060' } };
    h.state.focus = { page: 2, email: 'person-060@meridian.example', full_name: 'Person 060' };
    renderPage();

    await userEvent.click(within(rowFor('person-001@meridian.example')).getByRole('button', { name: 'Person 060' }));
    await waitFor(() => expect(range()).toHaveTextContent('51–100 of 120'));

    // Moving on to another page is the user's own action — the jump must not pull them back.
    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    expect(range()).toHaveTextContent('101–120 of 120');
    expect(rowFor('person-101@meridian.example')).toBeInTheDocument();
    expect(screen.queryByText('person-060@meridian.example')).not.toBeInTheDocument();
  });

  it('applies the jump once — a search typed afterwards is not cleared', async () => {
    h.state.all = makeUsers(120);
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-060', manager: { full_name: 'Person 060' } };
    h.state.focus = { page: 2, email: 'person-060@meridian.example', full_name: 'Person 060' };
    renderPage();

    await userEvent.click(within(rowFor('person-001@meridian.example')).getByRole('button', { name: 'Person 060' }));
    await waitFor(() => expect(range()).toHaveTextContent('51–100 of 120'));

    const search = screen.getByLabelText(/Search users/i);
    await userEvent.type(search, 'Person 001');
    await waitFor(() => expect(range()).toHaveTextContent('1–1 of 1'));
    // The typed term survives: the jump dropped the search once, it does not keep doing so.
    expect(search).toHaveValue('Person 001');
    expect(rowFor('person-001@meridian.example')).toBeInTheDocument();
  });

  it('browsing and searching after a jump leave Back pointing at where the jump started', async () => {
    h.state.all = makeUsers(120);
    // Page 2's Person 060 reports Person 005 (page 1) as manager.
    h.state.all[59] = { ...h.state.all[59], manager_id: 'u-005', manager: { full_name: 'Person 005' } };
    h.state.focus = { page: 1, email: 'person-005@meridian.example', full_name: 'Person 005' };
    renderPage();

    const search = screen.getByLabelText(/Search users/i);
    await userEvent.type(search, 'Person');
    await waitFor(() => expect(h.state.pageCalls.at(-1)?.search).toBe('Person'));
    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    await waitFor(() => expect(range()).toHaveTextContent('51–100 of 120'));

    // The jump starts from page 2 under a committed, non-empty search.
    await userEvent.click(within(rowFor('person-060@meridian.example')).getByRole('button', { name: 'Person 005' }));
    await waitFor(() => expect(range()).toHaveTextContent('1–50 of 120'));

    // Keep using the directory; both a new page and a new search stick.
    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    await waitFor(() => expect(range()).toHaveTextContent('51–100 of 120'));
    await userEvent.type(screen.getByLabelText(/Search users/i), 'Person 001');
    await waitFor(() => expect(range()).toHaveTextContent('1–1 of 1'));

    // Back is still the context the jump started from, not where browsing ended.
    await userEvent.click(within(screen.getByTestId('admin-users-focus')).getByRole('button', { name: /Back to your page/i }));
    await waitFor(() => expect(search).toHaveValue('Person'));
    await waitFor(() => expect(range()).toHaveTextContent('51–100 of 120'));
  });

  it('an explicit second jump to the SAME person applies again and saves its own return context', async () => {
    h.state.all = makeUsers(120);
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-060', manager: { full_name: 'Person 060' } };
    h.state.all[100] = { ...h.state.all[100], manager_id: 'u-060', manager: { full_name: 'Person 060' } };
    h.state.focus = { page: 2, email: 'person-060@meridian.example', full_name: 'Person 060' };
    renderPage();

    // First jump starts from page 1.
    await userEvent.click(within(rowFor('person-001@meridian.example')).getByRole('button', { name: 'Person 060' }));
    await waitFor(() => expect(range()).toHaveTextContent('51–100 of 120'));
    // Browse to page 3; the first jump is not re-enforced.
    await userEvent.click(screen.getByRole('button', { name: /Next page/i }));
    expect(range()).toHaveTextContent('101–120 of 120');

    // A second, explicit jump to the same identity must still take effect.
    await userEvent.click(within(rowFor('person-101@meridian.example')).getByRole('button', { name: 'Person 060' }));
    await waitFor(() => expect(range()).toHaveTextContent('51–100 of 120'));

    // ...and its way back is page 3, where THIS jump started — not the first jump's page 1.
    await userEvent.click(within(screen.getByTestId('admin-users-focus')).getByRole('button', { name: /Back to your page/i }));
    expect(range()).toHaveTextContent('101–120 of 120');
  });

  it('a superseded target never moves the page when its location is no longer the current one', async () => {
    h.state.all = makeUsers(120);
    h.state.all[0] = { ...h.state.all[0], manager_id: 'u-060', manager: { full_name: 'Person 060' } };
    h.state.all[1] = { ...h.state.all[1], manager_id: 'u-110', manager: { full_name: 'Person 110' } };
    h.state.focusById = {
      'u-060': { page: 2, email: 'person-060@meridian.example', full_name: 'Person 060' },
      'u-110': { page: 3, email: 'person-110@meridian.example', full_name: 'Person 110' },
    };
    h.state.focusPendingById = { 'u-060': true };
    const view = renderPage();

    await userEvent.click(within(rowFor('person-001@meridian.example')).getByRole('button', { name: 'Person 060' }));
    // The first target is still being located; follow a different manager instead.
    await userEvent.click(within(rowFor('person-002@meridian.example')).getByRole('button', { name: 'Person 110' }));
    await waitFor(() => expect(range()).toHaveTextContent('101–120 of 120'));

    // The first target's answer becomes available later; it is not the current target, so the
    // directory stays on the latest jump's page.
    act(() => { h.state.focusPendingById['u-060'] = false; });
    view.rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <MemoryRouter>
            <AdminUsers />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(range()).toHaveTextContent('101–120 of 120');
    expect(rowFor('person-110@meridian.example')).toBeInTheDocument();
  });
});
