/**
 * #879 — Project tabs keep focus on arrow keys (AC owner).
 *
 * AC: Given focus on a project tab, when the user presses ArrowRight, then focus
 * moves to the next tab and stays in the tab bar (also ArrowLeft, Home, End per the
 * WAI-ARIA tabs pattern). The journey runs through the real ProjectDetail wiring
 * (Tabs → setTab → navigate), with tab contents stubbed — we test focus, not panels.
 *
 * AppShell's focus-on-route-change exemption is ALSO asserted at its owning layer
 * (AppShell.tabFocus.test.tsx); this journey renders the page inside the real AppShell —
 * exactly as App.tsx composes it — so the user-visible contract (focus stays in the tab
 * bar, <main> never steals it) is bound end-to-end at the page layer too (WCAG 2.4.3).
 *
 * Owning layer: Vitest/RTL — pure FE logic, no DB required.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import { AppShell } from '@/src/components/shell';
import type { Role } from '@/src/auth/AuthContext';
import React from 'react';

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

const renderAs = (realRole: Role, path: string) =>
  render(
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

const tablist = () => screen.getByRole('tablist', { name: /project sections/i });
const main = () => screen.getByRole('main');
// toHaveFocus/toContainElement matchers are typed for HTMLElement — narrow activeElement.
const activeEl = () => document.activeElement as HTMLElement | null;

describe('#879: project tabs keep focus on arrow keys (WCAG 2.4.3)', () => {
  it('AC #879: given focus on a project tab, ArrowRight moves focus to the next tab and it stays in the tab bar', () => {
    renderAs('Admin', '/projects/p1');
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    overviewTab.focus();
    expect(overviewTab).toHaveFocus();

    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });

    // Focus moved to the NEXT tab — not to the main content, not stuck on the old tab.
    const budgetTab = screen.getByRole('tab', { name: 'Budget' });
    expect(budgetTab).toHaveFocus();
    expect(budgetTab).toHaveAttribute('aria-selected', 'true');
    expect(tablist()).toContainElement(activeEl());
    expect(main()).not.toHaveFocus();
    // The URL followed the tab switch (tab lives in the route param).
    expect(screen.getByTestId('tab-budget')).toBeInTheDocument();
  });

  it('AC #879: ArrowLeft walks back up the tab bar (Overview ← after one step left from Budget)', () => {
    renderAs('Admin', '/projects/p1/budget');
    const budgetTab = screen.getByRole('tab', { name: 'Budget' });
    budgetTab.focus();

    fireEvent.keyDown(budgetTab, { key: 'ArrowLeft' });

    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    expect(overviewTab).toHaveFocus();
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    expect(tablist()).toContainElement(activeEl());
    expect(main()).not.toHaveFocus();
  });

  it('AC #879: Home jumps to the first tab and End to the last, focus staying in the tab bar', () => {
    renderAs('Admin', '/projects/p1/tasks');
    const tasksTab = screen.getByRole('tab', { name: 'Tasks' });
    tasksTab.focus();

    fireEvent.keyDown(tasksTab, { key: 'Home' });
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    expect(overviewTab).toHaveFocus();
    expect(tablist()).toContainElement(activeEl());
    expect(main()).not.toHaveFocus();

    fireEvent.keyDown(overviewTab, { key: 'End' });
    const historyTab = screen.getByRole('tab', { name: 'History' });
    expect(historyTab).toHaveFocus();
    expect(tablist()).toContainElement(activeEl());
    expect(main()).not.toHaveFocus();
  });
});
