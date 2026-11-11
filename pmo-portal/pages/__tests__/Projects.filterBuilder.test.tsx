import '@/test/stubGetAnimations';
/**
 * #1983 — Projects filter builder: apply, remove and the URL round-trip. A chip is a working-set key in
 * the URL (shareable; Back and a reload rebuild the same chips); the list, "Showing x of y" and Clear all
 * follow it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const roleBox = { value: 'Admin' };
const projectsState = {
  data: [] as unknown as ProjectWithRefs[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));
vi.mock('../../components/ProjectCalendarView', () => ({
  default: () => <div data-testid="project-calendar-view" />,
}));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({
    // list-working-set-return (#682): `pm` is a URL-owned referenced-ID filter — the codec's
    // `referenceValue` accepts only a syntactically valid UUID (or the Unassigned sentinel), so
    // the blank-name profile actually SELECTED as a filter below must be UUID-shaped to round-trip
    // through the URL instead of being silently rejected back to "All".
    data: [
      { id: 'u-alice', full_name: 'Alice Manager' },
      { id: 'b1a2c3d4-1111-4eee-8000-000000000001', full_name: '   ' },
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
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: roleBox.value }),
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
}));

import Projects from '../Projects';
import { addBuilderFilter, removeBuilderFilter } from './projectFilterBuilder.helpers';

const mk = (id: string, name: string, status: string, start: string, value: number, pm: string | null): ProjectWithRefs => ({
  id, name, code: `PRJ-${id}`, status, client_id: null, project_manager_id: pm, contract_value: value, currency: 'USD',
  budget: 1, spent: 0, start_date: start, end_date: '2027-12-31', client: null, pm: pm ? { full_name: 'Alice Manager' } : null,
  customer_contract_ref: null, contract_date: null, decided_at: null,
} as unknown as ProjectWithRefs);

const seed = [
  mk('1', 'Alpha Works', 'Ongoing Project', '2026-01-10', 100_000, 'u-alice'),
  mk('2', 'Beta Works', 'Ongoing Project', '2026-06-10', 500_000, null),
  mk('3', 'Gamma Works', 'On Hold', '2026-09-10', 900_000, 'u-alice'),
];

function Probe() {
  const loc = useLocation();
  return <div data-testid="url" data-search={loc.search} />;
}
const search = () => screen.getByTestId('url').dataset.search ?? '';
const renderAt = (path = '/projects?filter=All') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
      <ToastProvider>
        <Projects />
      </ToastProvider>
    </MemoryRouter>,
  );
const rows = () => ['Alpha Works', 'Beta Works', 'Gamma Works'].filter((n) => screen.queryByText(n));

describe('#1983 Projects filter builder', () => {
  beforeEach(() => {
    sessionStorage.clear();
    projectsState.data = seed;
    projectsState.isPending = false;
    projectsState.isError = false;
    roleBox.value = 'Admin';
  });

  it('applying a status chip narrows the list, writes the URL and keeps "Showing x of y" right', async () => {
    const user = userEvent.setup();
    renderAt();
    expect(rows()).toHaveLength(3);
    await addBuilderFilter(user, 'Status', { operator: 'is any of', value: 'On Hold' });
    expect(rows()).toEqual(['Gamma Works']);
    expect(search()).toContain('status=On+Hold');
    expect(screen.getByText(/Showing 1 of 3/)).toBeInTheDocument();
  });

  it('an amount range (contract value is at least) narrows the list and round-trips through the URL', async () => {
    const user = userEvent.setup();
    renderAt();
    await addBuilderFilter(user, 'Contract value', { operator: 'is at least' });
    await user.click(await screen.findByRole('button', { name: 'Value' }));
    await user.type(await screen.findByLabelText('Contract value', { selector: 'input' }), '400000');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(rows()).toEqual(['Beta Works', 'Gamma Works']);
    expect(search()).toContain('valueMin=400000');
  });

  it('a date range (start date is on or after) narrows the list and writes the URL', async () => {
    const user = userEvent.setup();
    renderAt();
    await addBuilderFilter(user, 'Start date', { operator: 'is on or after' });
    await user.click(await screen.findByRole('button', { name: 'Value' }));
    const input = await screen.findByLabelText('Start date', { selector: 'input' });
    await user.type(input, '2026-06-01');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(rows()).toEqual(['Beta Works', 'Gamma Works']);
    expect(search()).toContain('startFrom=2026-06-01');
  });

  it('a shared link rebuilds the same chips and rows; removing a chip drops its key and restores the rows', async () => {
    const user = userEvent.setup();
    renderAt('/projects?filter=All&status=On%20Hold&valueMin=400000');
    expect(rows()).toEqual(['Gamma Works']);
    const chips = screen.getByRole('toolbar', { name: /active filters/i });
    expect(within(chips).getByRole('button', { name: 'Status filter options' })).toBeVisible();
    expect(within(chips).getByRole('button', { name: 'Contract value filter options' })).toBeVisible();
    await removeBuilderFilter(user, 'Status');
    expect(search()).not.toContain('status=');
    expect(search()).toContain('valueMin=400000');
    expect(rows()).toEqual(['Beta Works', 'Gamma Works']);
    await user.click(screen.getByRole('button', { name: /^clear all$/i }));
    expect(rows()).toHaveLength(3);
    expect(search()).not.toContain('valueMin');
  });

  it('contract value is not offered to a role that may not see money', async () => {
    roleBox.value = 'Engineer';
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: /^add filter$/i }));
    expect(await screen.findByRole('option', { name: 'Start date' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Contract value' })).not.toBeInTheDocument();
  });
});
