/**
 * AC-PJ-RM-001..005 — Projects list rowMenu (Edit + Archive)
 *
 * T15opt: Add a rowMenu to the Projects DataTable matching Companies.tsx pattern:
 *   Edit  → ProjectFormModal mode=editHeader
 *   Archive → ConfirmDialog then archive mutation
 * Gated by the SAME can() checks the detail-header uses (edit | archive project).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import Projects from '../Projects';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// ── hoisted mocks ────────────────────────────────────────────────────────────
const { roleBox, projectMutations, deliverySummaryState } = vi.hoisted(() => ({
  roleBox: { value: 'Project Manager' },
  projectMutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  },
  deliverySummaryState: {
    p1: { deliveryPct: 50, committedSpend: 2_100_000, budget: 4_700_000 },
  },
}));

const projectsState = {
  data: [] as ProjectWithRefs[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

const seed = [
  {
    id: 'p1',
    name: 'Innovate Corp HQ Fit-Out',
    code: 'PRJ-001',
    status: 'Ongoing Project',
    client_id: 'c2',
    project_manager_id: 'u-alice',
    contract_value: 5000000,
    budget: 4700000,
    spent: 0,
    client: { name: 'Innovate Corp' },
    pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null,
    contract_date: null,
    decided_at: null,
    start_date: null,
    end_date: '2026-12-18',
    org_id: 'org-1',
    archived_at: null,
    created_at: '',
  },
] as unknown as ProjectWithRefs[];

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }] }),
  useProjectManagers: () => ({ data: [{ id: 'u-alice', full_name: 'Alice Manager' }] }),
  useProjectMutations: () => projectMutations,
  useProjectsMilestoneDates: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: roleBox.value }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: deliverySummaryState }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: roleBox.value,
    realRole: roleBox.value,
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
  usePipelineStageConfig: () => ({ data: [], isSuccess: true }),
}));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

// ── helpers ──────────────────────────────────────────────────────────────────

const renderPage = (role = 'Project Manager') => {
  roleBox.value = role;
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Projects />
      </ToastProvider>
    </MemoryRouter>,
  );
};

const openRowMenu = async () => {
  const rowActionsBtn = screen.getByRole('button', { name: /Row actions/i });
  await userEvent.click(rowActionsBtn);
};

beforeEach(() => {
  projectsState.data = seed as unknown as ProjectWithRefs[];
  projectsState.isPending = false;
  projectsState.isError = false;
  projectsState.refetch.mockClear();
  projectMutations.updateHeader.mutateAsync.mockReset();
  projectMutations.updateHeader.mutateAsync.mockResolvedValue({ id: 'p1', name: 'Updated' });
  projectMutations.archive.mutateAsync.mockReset();
  projectMutations.archive.mutateAsync.mockResolvedValue(undefined);
  roleBox.value = 'Project Manager';
});

// ── AC-PJ-RM-001: row-menu visibility gating ─────────────────────────────────

describe('AC-PJ-RM-001: Projects rowMenu RBAC gating', () => {
  it('AC-PJ-RM-001a: Project Manager sees "Row actions" button on each row', () => {
    renderPage('Project Manager');
    expect(screen.getByRole('button', { name: /Row actions/i })).toBeInTheDocument();
  });

  it('AC-PJ-RM-001b: Admin sees "Row actions" button (can edit + archive + delete)', () => {
    renderPage('Admin');
    expect(screen.getByRole('button', { name: /Row actions/i })).toBeInTheDocument();
  });

  it('AC-PJ-RM-001c: Engineer does NOT see a row menu (read-only index)', () => {
    renderPage('Engineer');
    // Engineers default to "My Projects"; but in the table view no row actions exist
    // Switch to All to ensure rows show
    // Engineers actually see the table but no row actions
    expect(screen.queryByRole('button', { name: /Row actions/i })).not.toBeInTheDocument();
  });

  it('AC-PJ-RM-001d: Finance does NOT see a row menu (cannot edit/archive projects)', () => {
    renderPage('Finance');
    expect(screen.queryByRole('button', { name: /Row actions/i })).not.toBeInTheDocument();
  });
});

// ── AC-PJ-RM-002: Edit opens ProjectFormModal in editHeader mode ──────────────

describe('AC-PJ-RM-002: Edit via rowMenu opens the edit-header modal', () => {
  it('AC-PJ-RM-002a: clicking Edit in the row menu opens the ProjectFormModal with mode=editHeader', async () => {
    renderPage('Project Manager');
    await openRowMenu();
    expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    // The edit modal title should appear
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Edit project/i })).toBeInTheDocument();
  });

  it('AC-PJ-RM-002b: the edit modal is pre-populated with the project name', async () => {
    renderPage('Project Manager');
    await openRowMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    const dialog = screen.getByRole('dialog');
    const nameInput = within(dialog).getByLabelText(/project name/i);
    expect(nameInput).toHaveValue('Innovate Corp HQ Fit-Out');
  });

  it('AC-PJ-RM-002c: a valid edit submit calls updateHeader mutation', async () => {
    renderPage('Project Manager');
    await openRowMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/i }));
    const dialog = screen.getByRole('dialog');
    // Clear and re-type name
    const nameInput = within(dialog).getByLabelText(/project name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Renamed Project');
    await userEvent.click(within(dialog).getByRole('button', { name: /Save project/i }));
    await waitFor(() =>
      expect(projectMutations.updateHeader.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'p1',
          input: expect.objectContaining({ name: 'Renamed Project' }),
        }),
      ),
    );
  });
});

// ── AC-PJ-RM-003: Archive via rowMenu ────────────────────────────────────────

describe('AC-PJ-RM-003: Archive via rowMenu shows confirm then calls archive mutation', () => {
  it('AC-PJ-RM-003a: PM sees Edit but NOT Archive (only Admin/Exec can archive)', async () => {
    renderPage('Project Manager');
    await openRowMenu();
    // PM can edit but cannot archive (ARCHIVE_ROLES = Admin·Exec)
    expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Archive/i })).not.toBeInTheDocument();
  });

  it('AC-PJ-RM-003b: Admin sees both Edit and Archive in the row menu', async () => {
    renderPage('Admin');
    await openRowMenu();
    expect(screen.getByRole('menuitem', { name: /Edit/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Archive/i })).toBeInTheDocument();
  });

  it('AC-PJ-RM-003c: clicking Archive opens a confirmation dialog', async () => {
    renderPage('Admin');
    await openRowMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: /Archive/i }));
    // Confirm dialog should be open
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The dialog title contains "Archive"
    expect(dialog).toHaveTextContent(/Archive/i);
  });

  it('AC-PJ-RM-003d: confirming archive calls the archive mutation with the project id', async () => {
    renderPage('Admin');
    await openRowMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: /Archive/i }));
    await userEvent.click(screen.getByRole('button', { name: /Archive project/i }));
    await waitFor(() =>
      expect(projectMutations.archive.mutateAsync).toHaveBeenCalledWith('p1'),
    );
  });

  it('AC-PJ-RM-003e: cancelling the archive confirm does NOT call the mutation', async () => {
    renderPage('Admin');
    await openRowMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: /Archive/i }));
    await userEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(projectMutations.archive.mutateAsync).not.toHaveBeenCalled();
  });
});
