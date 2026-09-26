/**
 * AC-MOB-VT (round-3) — Projects phone-width view toggle.
 *
 * Wave-2 hid the Table option below md because DataTable auto-rendered cards on mobile
 * (the toggle became a no-op). The Projects mobile toolbar (AC-PRJUX-001) now exposes the
 * full view toggle below md — Table included — because the ListPage mobile branch owns the
 * toolbar at phone widths and DataTable still reflows Table into cards. Cards / Calendar /
 * Board remain reachable as before.
 *
 * TESTS (all at <768px):
 * 1. (AC-PRJUX-001) Table / Cards / Calendar / Board are ALL present and reachable below md.
 * 2. (AC-PRJUX-001) None of the four options carries `hidden` (nothing is CSS-hidden on phones).
 * 3. (AC-MOB-VT-003) All four view values exist (Table preserved as a real selectable view).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

const viewBox = { value: 'table' as 'table' | 'cards' | 'calendar' | 'kanban' };

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProjectView', () => ({
  useProjectView: () => [viewBox.value, vi.fn()] as [typeof viewBox.value, () => void],
}));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
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
vi.mock('../../components/ProjectCalendarView', () => ({
  default: () => <div data-testid="project-calendar-view" />,
}));
vi.mock('../../components/ProjectKanbanBoard', () => ({
  default: () => <div data-testid="project-kanban-board" />,
}));

import Projects from '../Projects';

const seed: ProjectWithRefs[] = [
  {
    id: 'p1', name: 'Test Project', code: 'PRJ-001', status: 'Ongoing Project',
    client_id: 'c1', project_manager_id: 'u-pm', contract_value: 1_000_000, currency: 'USD',
    budget: 800_000, spent: 400_000, end_date: '2026-12-31',
    client: { name: 'Acme Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null,
  } as unknown as ProjectWithRefs,
];

function mockMobileViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Projects />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('AC-PRJUX-001 — Projects phone-width view toggle (round-3)', () => {
  beforeEach(() => {
    mockMobileViewport();
    sessionStorage.clear();
    projectsState.data = seed;
    projectsState.isPending = false;
    projectsState.isError = false;
    viewBox.value = 'table';
  });

  it('AC-PRJUX-001: Table / Cards / Calendar / Board are ALL present and reachable below md', () => {
    renderPage();
    const toggle = screen.getByRole('tablist', { name: /projects view/i });
    for (const name of ['Table', 'Cards', 'Calendar', 'Board']) {
      expect(within(toggle).getByRole('tab', { name: new RegExp(`^${name}$`) })).toBeInTheDocument();
    }
  });

  it('AC-PRJUX-001: none of the four options carries `hidden` (nothing is CSS-hidden on phones)', () => {
    renderPage();
    const toggle = screen.getByRole('tablist', { name: /projects view/i });
    for (const name of ['Table', 'Cards', 'Calendar', 'Board']) {
      expect(within(toggle).getByRole('tab', { name: new RegExp(`^${name}$`) }).className).not.toContain('hidden');
    }
  });

  it('AC-MOB-VT-003: all four view values exist (Table preserved as a real selectable view)', () => {
    renderPage();
    const toggle = screen.getByRole('tablist', { name: /projects view/i });
    expect(within(toggle).getByRole('tab', { name: /^Table$/i })).toHaveAttribute('aria-selected', 'true');
  });
});