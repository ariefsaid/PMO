import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';

// ── Repository-seam-backed hooks are mocked; the page is the unit under test. ──
const { listState, mutations } = vi.hoisted(() => ({
  listState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    updateRole: { mutateAsync: vi.fn(), isPending: false },
    assignManager: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => listState,
  useUserMutations: () => mutations,
}));

// usePermission reads the REAL JWT role from the impersonation context.
let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import AdminUsers from './AdminUsers';

const seed = [
  { id: 'u1', full_name: 'Renata Halloway', email: 'renata@meridian.example', role: 'Admin', manager_id: null, org_id: 'org-1' },
  { id: 'u2', full_name: 'Desmond Achebe', email: 'desmond@meridian.example', role: 'Project Manager', manager_id: 'u1', org_id: 'org-1' },
  { id: 'u3', full_name: 'Priya Venkatesh', email: 'priya@meridian.example', role: 'Executive', manager_id: 'u1', org_id: 'org-1' },
  { id: 'u4', full_name: 'Tobias Lindqvist', email: 'tobias@meridian.example', role: 'Finance', manager_id: 'u1', org_id: 'org-1' },
];

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter>
        <AdminUsers />
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
  realRole = 'Admin';
});

describe('Admin Users — directory (AC-AU-001)', () => {
  it('AC-AU-001: renders each user with name, email and role', () => {
    renderPage();
    // Renata is both a user row and (as u1) the manager of three others, so her name
    // appears multiple times by design — assert on the email (unique to the user row).
    expect(screen.getAllByText('renata@meridian.example')[0]).toBeInTheDocument();
    expect(screen.getAllByText('desmond@meridian.example')[0]).toBeInTheDocument();
    // role pills rendered
    expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Project Manager')[0]).toBeInTheDocument();
  });

  it('AC-AU-001: resolves manager_id to the manager full name', () => {
    renderPage();
    // Desmond's manager (u1) resolves to Renata's name
    const row = screen.getAllByText('Desmond Achebe')[0].closest('tr')!;
    expect(within(row).getAllByText('Renata Halloway')[0]).toBeInTheDocument();
  });

  it('AC-AU-001: search filters by name or email', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Search users/i), 'tobias');
    // Renata's USER row is gone (her email no longer renders); only Tobias remains.
    expect(screen.queryByText('renata@meridian.example')).not.toBeInTheDocument();
    expect(screen.queryByText('desmond@meridian.example')).not.toBeInTheDocument();
    expect(screen.getAllByText('tobias@meridian.example')[0]).toBeInTheDocument();
    // exactly one data row after filtering
    expect(screen.getAllByRole('row').filter((r) => within(r).queryByText(/@meridian/))).toHaveLength(1);
  });

  it('AC-AU-001: loading skeleton while pending', () => {
    listState.isPending = true;
    renderPage();
    expect(screen.getAllByTestId('liststate-loading')[0]).toBeInTheDocument();
  });

  it('AC-AU-001: error state with retry', async () => {
    listState.isError = true;
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(listState.refetch).toHaveBeenCalled();
  });

  it('AC-AU-001: empty state when no users', () => {
    listState.data = [];
    renderPage('Admin');
    expect(screen.getAllByText(/No users/i)[0]).toBeInTheDocument();
  });
});

describe('Admin Users — RBAC affordance gating (AC-AU-002)', () => {
  it('AC-AU-002: Admin sees row Edit role + Change manager (Add user is a deferred affordance)', async () => {
    renderPage('Admin');
    await userEvent.click(
      within(screen.getAllByText('Desmond Achebe')[0].closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    expect(screen.getByRole('menuitem', { name: /Edit role/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Change manager/i })).toBeInTheDocument();
  });

  // Polish #7 — invite/create is DEFERRED (needs server-side auth-admin). The FE is
  // honest: the affordance is a DISABLED control with a reason, never a button that
  // opens a "coming soon" dead-end modal, and never a hidden broken create path.
  it('polish#7: the Add user affordance is DISABLED with a reason (no dead-end modal)', async () => {
    renderPage('Admin');
    const addBtn = screen.getByRole('button', { name: /Add user/i });
    expect(addBtn).toBeDisabled();
    // Clicking a disabled control does nothing — no modal, no mutation.
    await userEvent.click(addBtn);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mutations.updateRole.mutateAsync).not.toHaveBeenCalled();
  });

  it('polish#7: there is NO disable/Status row affordance (deferred — needs a status column)', async () => {
    renderPage('Admin');
    await userEvent.click(
      within(screen.getAllByText('Desmond Achebe')[0].closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    expect(screen.queryByRole('menuitem', { name: /disable/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /status/i })).toBeNull();
  });

  it('AC-AU-002: Executive gets a read-only directory — no Add user, no row actions, a read-only notice', () => {
    renderPage('Executive');
    expect(screen.queryByRole('button', { name: /Add user/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Row actions/i })).not.toBeInTheDocument();
    // Exec can still SEE the directory
    expect(screen.getAllByText('renata@meridian.example')[0]).toBeInTheDocument();
    // a read-only explanation, not a wall of disabled controls
    expect(screen.getAllByText(/only an Admin can/i)[0]).toBeInTheDocument();
  });

  it('AC-AU-002: a non-admin, non-exec role (Engineer) reaching the route sees an Admin-only gate, not the directory', () => {
    renderPage('Engineer');
    // the directory rows are NOT rendered (no user emails)
    expect(screen.queryByText('renata@meridian.example')).not.toBeInTheDocument();
    // an Admin-only gate is shown
    expect(screen.getAllByText(/Admin-only area/i)[0]).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add user/i })).not.toBeInTheDocument();
  });
});

describe('Admin Users — edit role (AC-AU-003)', () => {
  it('AC-AU-003: Edit role opens a focused modal; a high-impact role change routes through a confirm before the mutation', async () => {
    renderPage('Admin');
    await userEvent.click(
      within(screen.getAllByText('Desmond Achebe')[0].closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit role/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // change role PM -> Executive and submit
    await userEvent.selectOptions(within(dialog).getByLabelText(/Role/i), 'Executive');
    await userEvent.click(within(dialog).getByRole('button', { name: /Save role/i }));
    // High-impact: a confirm appears FIRST; the mutation has NOT fired yet.
    expect(mutations.updateRole.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getAllByText(/Change Desmond Achebe's role to Executive\?/i)[0]).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Change role/i }));
    await waitFor(() =>
      expect(mutations.updateRole.mutateAsync).toHaveBeenCalledWith({ id: 'u2', role: 'Executive' }),
    );
  });

  it('AC-AU-003: a role change rejected by RLS (42501) surfaces a classified warning toast', async () => {
    mutations.updateRole.mutateAsync.mockRejectedValue(new AppError('row violates RLS', '42501'));
    renderPage('Admin');
    await userEvent.click(
      within(screen.getAllByText('Desmond Achebe')[0].closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit role/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Role/i), 'Admin');
    await userEvent.click(within(dialog).getByRole('button', { name: /Save role/i }));
    await userEvent.click(screen.getByRole('button', { name: /Change role/i }));
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent(/don't have permission/i);
  });
});

describe('Admin Users — assign manager (AC-AU-004)', () => {
  it('AC-AU-004: Change manager opens a modal whose manager picker excludes the user themselves', async () => {
    renderPage('Admin');
    await userEvent.click(
      within(screen.getAllByText('Desmond Achebe')[0].closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: /Change manager/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // open the manager combobox
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Manager/i }));
    const listbox = await screen.findByRole('listbox');
    // the user being edited (Desmond) must not be selectable as their own manager
    expect(within(listbox).queryByText('Desmond Achebe')).not.toBeInTheDocument();
    expect(within(listbox).getAllByText('Renata Halloway')[0]).toBeInTheDocument();
  });

  it('AC-AU-004: selecting a manager and saving submits the assignment', async () => {
    renderPage('Admin');
    await userEvent.click(
      within(screen.getAllByText('Tobias Lindqvist')[0].closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: /Change manager/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Manager/i }));
    const listbox = await screen.findByRole('listbox');
    await userEvent.click(within(listbox).getAllByText('Desmond Achebe')[0]);
    await userEvent.click(within(dialog).getByRole('button', { name: /Save manager/i }));
    await waitFor(() =>
      expect(mutations.assignManager.mutateAsync).toHaveBeenCalledWith({ id: 'u4', managerId: 'u2' }),
    );
  });
});

describe('Admin Users — invite deferred (AC-AU-005)', () => {
  it('AC-AU-005: Add user is an honest deferred affordance — disabled with a reason, no create path', async () => {
    renderPage('Admin');
    const addBtn = screen.getByRole('button', { name: /Add user/i });
    // Honest: discoverable but visibly not-yet-available (needs server-side auth-admin),
    // never a button that opens a "coming soon" modal dead-end.
    expect(addBtn).toBeDisabled();
    expect(addBtn).toHaveAccessibleName(/coming soon|deferred|server/i);
    // It does not silently call a create mutation that cannot succeed client-side.
    expect(mutations.updateRole.mutateAsync).not.toHaveBeenCalled();
    expect(mutations.assignManager.mutateAsync).not.toHaveBeenCalled();
  });
});
