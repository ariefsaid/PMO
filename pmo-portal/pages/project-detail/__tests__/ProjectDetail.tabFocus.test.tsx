/**
 * #879 — Project tabs keep focus on arrow keys (AC owner).
 *
 * AC: Given focus on the vertical project section index, ArrowDown/ArrowUp moves
 * to the adjacent section and stays in the index (Home/End move to its boundaries).
 * The journey runs through real ProjectDetail wiring (index → setTab → navigate).
 *
 * AppShell's focus-on-route-change exemption is ALSO asserted at its owning layer
 * (AppShell.tabFocus.test.tsx); this journey renders the page inside the real AppShell —
 * exactly as App.tsx composes it — so the user-visible contract (focus stays in the tab
 * bar, <main> never steals it) is bound end-to-end at the page layer too (WCAG 2.4.3).
 *
 * Owning layer: Vitest/RTL — pure FE logic, no DB required.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import { AppShell } from '@/src/components/shell';
import type { Role } from '@/src/auth/AuthContext';
import React from 'react';
vi.mock('@/pages/project-detail/ProjectFinancesSection', () => ({ ProjectFinancesSection: () => null }));

// ── Shared project fixture (on-hand, delivery stage) ──────────────────────────

const projData = [
  {
    id: 'p1',
    name: 'Test Project',
    status: 'Ongoing Project',
    budget: 100_000,
    spent: 0,
    archived_at: null,
    created_at: '',
    last_update: '',
    org_id: 'o1',
    contract_value: 200_000,
    win_probability: 1,
    stage_id: null,
    code: null,
    customer_contract_ref: null,
    client: null,
    client_id: null,
    project_manager_id: null,
    pm: null,
  },
];

// ── Module mocks (same harness as ProjectDetail.defaultTab.test.tsx) ─────────

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: projData, isPending: false }),
  useProject: (id: string) => ({
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    data: projData.find((p) => p.id === id) ?? null,
  }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/lib/db/opportunity', () => ({
  useOpportunity: () => ({ data: undefined, isPending: false }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isError: false,
    error: null,
    isPending: false,
  }),
}));

// Stub tab contents — we test which tab is focused/active, not what's inside them.
vi.mock('../tabs/OverviewTab', () => ({ default: () => <div data-testid="tab-overview">Overview</div> }));
// History renders RecordHistory directly (no tabs/HistoryTab); stub it the same way —
// the Home/End journey activates it and its own data wiring is out of scope here.
vi.mock('@/src/components/history/RecordHistory', () => ({
  RecordHistory: () => <div data-testid="tab-history">History</div>,
}));
vi.mock('../tabs/BudgetTab', () => ({ default: () => <div data-testid="tab-budget">Budget</div> }));
vi.mock('../tabs/ProcurementTab', () => ({ default: () => <div data-testid="tab-procurement">Procurement</div> }));
vi.mock('../tabs/TasksTab', () => ({ default: () => <div data-testid="tab-tasks">Tasks</div> }));
vi.mock('../tabs/DocumentsTab', () => ({ default: () => <div data-testid="tab-documents">Documents</div> }));
vi.mock('../PipelineLens', () => ({ default: () => <div>Pipeline</div> }));
vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('../ProjectDetailHeader', () => ({
  default: () => <div data-testid="stubbed-header">Header</div>,
  hasFinanceView: (role: Role | null): boolean => {
    if (!role) return false;
    return (['Admin', 'Executive', 'Finance', 'Project Manager'] as Role[]).includes(role);
  },
}));
vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));

import ProjectDetail from '../ProjectDetail';

const renderAs = async (realRole: Role, path: string) => {
  const view = render(
    <ImpersonationProvider realRole={realRole}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          {/* Real shell, real route-focus effect: an arrow-key tab switch IS a pathname
              change, so a missing exemption would yank focus to <main> right here. */}
          <AppShell rail={null} header={null}>
            <Routes>
              <Route path="/projects/:projectId/:tab" element={<ProjectDetail />} />
              <Route path="/projects/:projectId" element={<ProjectDetail />} />
            </Routes>
          </AppShell>
        </MemoryRouter>
      </ToastProvider>
    </ImpersonationProvider>,
  );
  await waitFor(() => expect(screen.queryByTestId('project-detail-panel-loading')).not.toBeInTheDocument());
  return view;
};

const main = () => screen.getByRole('main');
describe('Project section links keep focus on route changes (WCAG 2.4.3)', () => {
  it('AC-PD-NAV-03: activating a named section by keyboard changes the section and keeps focus on its link', async () => {
    const user = userEvent.setup();
    await renderAs('Admin', '/projects/p1');
    const taskLink = screen.getByRole('link', { name: 'Tasks' });
    taskLink.focus();

    await user.keyboard('{Enter}');

    expect(await screen.findByTestId('tab-tasks')).toBeInTheDocument();
    expect(taskLink).toHaveAttribute('aria-current', 'page');
    expect(taskLink).toHaveFocus();
    expect(screen.getByRole('navigation', { name: 'Project sections' })).toContainElement(
      document.activeElement as HTMLElement,
    );
    expect(main()).not.toHaveFocus();
  });
});
