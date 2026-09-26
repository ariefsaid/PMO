/**
 * AC-PRJUX-004 / AC-PRJUX-005 — Projects manager display + filter semantics.
 *
 * AC-PRJUX-004: every manager option has a nonempty visible label — including an
 *   assigned profile whose `full_name` is blank/whitespace. The blank-name option is
 *   rendered `Unnamed user · <short ID>` (never blank, never empty) and remains
 *   selectable and filters by its stable profile ID.
 * AC-PRJUX-005: a project with no manager displays `Unassigned`; the Unassigned filter
 *   matches ONLY `project_manager_id == null`. An unnamed-but-ASSIGNED manager is NOT
 *   treated as unassigned (distinct labels).
 *
 * These run at the desktop (≥md) branch so the canonical toolbar SelectFields and the
 * DataTable tbody are in play.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const projectsState = {
  data: [] as unknown as ProjectWithRefs[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProjectView', () => ({
  useProjectView: () => ['table', vi.fn()] as ['table', () => void],
}));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));
vi.mock('../../components/ProjectCalendarView', () => ({
  default: () => <div data-testid="project-calendar-view" />,
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({
    data: [
      { id: 'u-alice', full_name: 'Alice Manager' },
      { id: 'b1a2c3d4-eeee-0000', full_name: '   ' },
    ],
  }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
  useProjectsMilestoneDates: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {} }),
  useProjectsDeliverySummary: () => ({ data: {} }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({
    effectiveRole: 'Project Manager',
    realRole: 'Project Manager',
    canImpersonate: false,
    viewAs: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
  usePipelineStageConfig: () => ({ data: [], isSuccess: true }),
}));
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

import Projects from '../Projects';

/** Three display polarities: named, blank-name-assigned, and genuinely unassigned. */
const seed: ProjectWithRefs[] = [
  {
    id: 'p1', name: 'Named Manager Project', code: 'PRJ-001', status: 'Ongoing Project',
    client_id: 'c1', project_manager_id: 'u-alice', contract_value: 1_000_000, currency: 'USD',
    budget: 800_000, spent: 400_000, end_date: '2026-12-31',
    client: { name: 'Acme Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null,
  } as unknown as ProjectWithRefs,
  {
    id: 'p2', name: 'Blank PM Project', code: 'PRJ-002', status: 'Ongoing Project',
    client_id: 'c1', project_manager_id: 'b1a2c3d4-eeee-0000', contract_value: 1_000_000, currency: 'USD',
    budget: 800_000, spent: 400_000, end_date: '2026-12-31',
    client: { name: 'Acme Corp' }, pm: { full_name: '   ' },
    customer_contract_ref: null, contract_date: null, decided_at: null,
  } as unknown as ProjectWithRefs,
  {
    id: 'p3', name: 'No Manager Project', code: 'PRJ-003', status: 'Ongoing Project',
    client_id: 'c1', project_manager_id: null, contract_value: 1_000_000, currency: 'USD',
    budget: 800_000, spent: 400_000, end_date: '2026-12-31',
    client: { name: 'Acme Corp' }, pm: null,
    customer_contract_ref: null, contract_date: null, decided_at: null,
  } as unknown as ProjectWithRefs,
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Projects />
      </ToastProvider>
    </MemoryRouter>,
  );

const pmSelect = () =>
  screen.getByRole('combobox', { name: /filter by project manager/i }) as HTMLSelectElement;

describe('AC-PRJUX-004 — blank-name manager profiles get a readable label and filter by ID', () => {
  beforeEach(() => {
    projectsState.data = seed;
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('AC-PRJUX-004: the PM option for a blank-name profile has a nonempty, readable label', () => {
    renderPage();
    const select = pmSelect();
    const blankOption = Array.from(select.options).find((o) => o.value === 'b1a2c3d4-eeee-0000');
    expect(blankOption).toBeTruthy();
    expect(blankOption!.textContent!.trim().length).toBeGreaterThan(0);
    expect(blankOption!.textContent).toContain('Unnamed user');
  });

  it('AC-PRJUX-004: selecting the blank-name profile filters by its real ID (only its project remains)', async () => {
    renderPage();
    await userEvent.selectOptions(pmSelect(), 'b1a2c3d4-eeee-0000');
    expect(screen.getByText('Blank PM Project')).toBeInTheDocument();
    expect(screen.queryByText('Named Manager Project')).not.toBeInTheDocument();
    expect(screen.queryByText('No Manager Project')).not.toBeInTheDocument();
  });
});

describe('AC-PRJUX-005 — Unassigned is distinct from an anonymous assigned profile', () => {
  beforeEach(() => {
    projectsState.data = seed;
    projectsState.isPending = false;
    projectsState.isError = false;
  });

  it('AC-PRJUX-005: the Unassigned option exists and selecting it shows only null-manager projects', async () => {
    renderPage();
    const select = pmSelect();
    const unassignedOption = Array.from(select.options).find((o) => o.textContent === 'Unassigned');
    expect(unassignedOption).toBeTruthy();
    await userEvent.selectOptions(select, unassignedOption!.value);
    expect(screen.getByText('No Manager Project')).toBeInTheDocument();
    expect(screen.queryByText('Blank PM Project')).not.toBeInTheDocument();
    expect(screen.queryByText('Named Manager Project')).not.toBeInTheDocument();
  });

  it('AC-PRJUX-005: an unnamed assigned manager is NOT shown as Unassigned in the table — labels are distinct', () => {
    renderPage();
    const tbody = document.querySelector('tbody')!;
    expect(within(tbody as HTMLElement).getByText('Unnamed user · b1a2c3d4')).toBeInTheDocument();
    expect(within(tbody as HTMLElement).getByText('Unassigned')).toBeInTheDocument();
    expect(within(tbody as HTMLElement).getByText('Alice Manager')).toBeInTheDocument();
  });
});