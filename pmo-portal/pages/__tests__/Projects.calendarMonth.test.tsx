/**
 * #716 (AC-LRC-003) — the Projects calendar month is part of the URL-owned working set, so a
 * return from a record lands on the month the user was reviewing. Uses the REAL
 * ProjectCalendarView; only the data hooks are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));

const projectsState = {
  data: [] as unknown as ProjectWithRefs[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isError: false }),
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

const LocationProbe: React.FC = () => {
  const loc = useLocation();
  return <div data-testid="loc">{loc.search}</div>;
};

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Projects />
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>,
  );

const search = () => new URLSearchParams(screen.getByTestId('loc').textContent ?? '');

describe('#716 — Projects calendar month lives in the working set (AC-LRC-003)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 8, 15));
    sessionStorage.clear();
    projectsState.data = seed;
    projectsState.isPending = false;
    projectsState.isError = false;
  });
  afterEach(() => vi.useRealTimers());

  it('opens on the month carried by the URL', () => {
    renderAt('/projects?view=calendar&month=2026-03');
    expect(screen.getByText('March 2026')).toBeInTheDocument();
  });

  it('a malformed month falls back to the current month', () => {
    renderAt('/projects?view=calendar&month=bogus');
    expect(screen.getByText('September 2026')).toBeInTheDocument();
  });

  it('moving the month writes it to the URL (replace); Today removes the key', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('/projects?view=calendar');
    await user.click(screen.getByRole('button', { name: /next month/i }));
    expect(await screen.findByText('October 2026')).toBeInTheDocument();
    await waitFor(() => expect(search().get('month')).toBe('2026-10'));
    expect(search().get('view')).toBe('calendar');
    await user.click(screen.getByRole('button', { name: /previous month/i }));
    await user.click(screen.getByRole('button', { name: /previous month/i }));
    await waitFor(() => expect(search().get('month')).toBe('2026-08'));
    await user.click(screen.getByRole('button', { name: /go to today/i }));
    expect(await screen.findByText('September 2026')).toBeInTheDocument();
    await waitFor(() => expect(search().has('month')).toBe(false));
  });

  it('leaving the calendar view drops the month key from the URL', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAt('/projects?view=calendar&month=2026-03');
    await user.click(screen.getByRole('tab', { name: /^Table$/i }));
    await waitFor(() => expect(search().has('view')).toBe(false));
    expect(search().has('month')).toBe(false);
  });
});
