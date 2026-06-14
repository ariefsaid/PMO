/**
 * AC-MOB-VT-001 — Projects mobile view toggle
 *
 * Wave-0 hid the entire ViewToggle below md because Table and Cards were the
 * only options and DataTable auto-renders as cards on mobile (making the toggle
 * a no-op). Now that Calendar + Kanban have real mobile renders, we need those
 * views reachable on mobile.
 *
 * Fix: expose the toggle below md for Cards, Calendar, and Kanban only; hide
 * Table below md (DataTable still auto-renders cards — no regression).
 *
 * TESTS:
 * 1. (AC-MOB-VT-001) Cards / Calendar / Kanban option buttons do NOT carry
 *    `hidden` class, so they're reachable on mobile.
 * 2. (AC-MOB-VT-002) The Table option button (or its wrapper) carries `hidden`
 *    + a `md:` restore class (hides below md, visible at ≥md).
 * 3. (AC-MOB-VT-003) All four options exist in the DOM (CSS hides Table below
 *    md; the element is always present for desktop to restore).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const projectsState = {
  data: [] as ProjectWithRefs[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

// Mutable so each test can set the view.
const viewBox = { value: 'table' as 'table' | 'cards' | 'calendar' | 'kanban' };

vi.mock('@/src/hooks/useProjectView', () => ({
  useProjectView: () => [viewBox.value, vi.fn()] as [typeof viewBox.value, () => void],
}));

vi.mock('../../components/ProjectStatusControl', () => ({
  default: () => null,
}));

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
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

// Stub heavy views so tests don't need full implementations
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
    client_id: 'c1', project_manager_id: 'u-pm', contract_value: 1_000_000,
    budget: 800_000, spent: 400_000, end_date: '2026-12-31',
    client: { name: 'Acme Corp' }, pm: { full_name: 'Alice Manager' },
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

describe('AC-MOB-VT — Projects mobile view toggle (round-2 drift fix)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed;
    projectsState.isPending = false;
    projectsState.isError = false;
    viewBox.value = 'table';
  });

  it('AC-MOB-VT-001: Cards / Calendar / Board toggle options do NOT carry `hidden` class (reachable on mobile)', () => {
    renderPage();
    const toggle = screen.getByRole('tablist', { name: /projects view/i });

    const cardsBtn = within(toggle).getByRole('tab', { name: /Cards/i });
    const calBtn = within(toggle).getByRole('tab', { name: /Calendar/i });
    const boardBtn = within(toggle).getByRole('tab', { name: /^Board$/i });

    // None of the mobile-visible option buttons should individually carry `hidden`,
    // and none of their closest wrapper parents (up to the tablist) should be
    // exclusively hidden (they may sit in a wrapper that also carries a md: restore).
    expect(cardsBtn.className).not.toContain('hidden');
    expect(calBtn.className).not.toContain('hidden');
    expect(boardBtn.className).not.toContain('hidden');
  });

  it('AC-MOB-VT-002: Table toggle option is hidden via a wrapper element (not a class on the button itself)', () => {
    renderPage();
    const toggle = screen.getByRole('tablist', { name: /projects view/i });
    const tableBtn = within(toggle).getByRole('tab', { name: /Table/i });

    // The Table button must NOT carry `hidden` directly on itself.
    // Putting `hidden` on the button alongside ViewToggle's base `inline-flex` is a
    // clsx-only cn collision: both land as classes and `inline-flex` wins at runtime,
    // leaving the option visible @390. The only safe approach is a wrapper element.
    expect(tableBtn.className).not.toContain('hidden');

    // A parent wrapper between the button and the tablist must carry `hidden` + `md:` restore.
    // The wrapper has no competing display utility, so `hidden` (display:none) is not overridden.
    const wrapperEl = tableBtn.parentElement;
    expect(wrapperEl).not.toBeNull();
    expect(wrapperEl).not.toBe(toggle); // wrapper is between button and tablist, not the tablist itself
    const cls = wrapperEl!.className;
    expect(cls).toContain('hidden');
    const hasMdRestore = cls.includes('md:inline-flex') || cls.includes('md:flex') || cls.includes('md:block');
    expect(hasMdRestore).toBe(true);
  });

  it('AC-MOB-VT-003: all four view options exist in the DOM (desktop CSS restores Table above md)', () => {
    renderPage();
    const toggle = screen.getByRole('tablist', { name: /projects view/i });
    expect(within(toggle).getByRole('tab', { name: /Table/i })).toBeInTheDocument();
    expect(within(toggle).getByRole('tab', { name: /Cards/i })).toBeInTheDocument();
    expect(within(toggle).getByRole('tab', { name: /Calendar/i })).toBeInTheDocument();
    expect(within(toggle).getByRole('tab', { name: /^Board$/i })).toBeInTheDocument();
  });
});
