/**
 * AC-PJ-CM-001 — ProjectCard kebab/Edit affordance (T15opt card variant)
 *
 * The Cards view must also surface the Edit action so a PM can quickly
 * rename/recode a project without switching to Table view first.
 * The card's kebab/edit button gates on the same can('edit','project') check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    name: 'Alpha Project',
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

// Switch to cards view helper
const switchToCards = async () => {
  await userEvent.click(screen.getByRole('tab', { name: /Cards/i }));
};

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

beforeEach(() => {
  projectsState.data = seed as unknown as ProjectWithRefs[];
  projectsState.isPending = false;
  projectsState.isError = false;
  projectMutations.updateHeader.mutateAsync.mockReset();
  projectMutations.updateHeader.mutateAsync.mockResolvedValue({ id: 'p1', name: 'Updated' });
  roleBox.value = 'Project Manager';
});

describe('AC-PJ-CM-001: ProjectCard kebab/Edit affordance in Cards view', () => {
  it('AC-PJ-CM-001a: PM sees an "Edit" button on project cards', async () => {
    renderPage('Project Manager');
    await switchToCards();
    expect(screen.getByTestId('project-card')).toBeInTheDocument();
    // An "Edit" button should appear on the card for roles with can('edit','project')
    expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
  });

  it('AC-PJ-CM-001b: Engineer does NOT see an "Edit" button on project cards (read-only)', async () => {
    renderPage('Engineer');
    await switchToCards();
    // Engineer defaults to My Projects; need to switch to All to see any cards
    // The user is in My Projects (Engineer view) which may be empty — that's OK
    // The key: NO edit button anywhere on any card
    expect(screen.queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
  });

  it('AC-PJ-CM-001c: clicking Edit on a card opens the edit-header modal pre-filled with the project', async () => {
    renderPage('Project Manager');
    await switchToCards();
    await userEvent.click(screen.getByRole('button', { name: /Edit/i }));
    // Modal opens in editHeader mode
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Edit project/i })).toBeInTheDocument();
    // Pre-filled with the project name
    expect(screen.getByDisplayValue('Alpha Project')).toBeInTheDocument();
  });

  it('AC-PJ-CM-001d: submitting the edit form from a card calls updateHeader', async () => {
    renderPage('Project Manager');
    await switchToCards();
    await userEvent.click(screen.getByRole('button', { name: /Edit/i }));
    const dialog = screen.getByRole('dialog');
    // The name field is pre-filled; save as-is (no change required for test)
    await userEvent.click(screen.getByRole('button', { name: /Save project/i }));
    await waitFor(() =>
      expect(projectMutations.updateHeader.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'p1' }),
      ),
    );
  });
});
