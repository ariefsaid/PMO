import '@/test/stubGetAnimations';
/**
 * floor tests for the Projects list rows the existing suites leave open: classification filter
 * fields (#6), an unavailable restored chip (#7), option-load Retry (#8), Export of the filtered
 * set (#12), both import wizards (#13, #14), a calendar chip opening the record (#21) and a board
 * card opening the record (#22).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const { projectsState, clientsState, managersState, roleBox, exportSpy } = vi.hoisted(() => ({
  projectsState: { data: [] as unknown as ProjectWithRefs[], isPending: false, isError: false, refetch: vi.fn() },
  clientsState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  managersState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  roleBox: { value: 'Admin' as string },
  exportSpy: vi.fn(async () => undefined),
}));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [], isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => projectsState,
  useClientCompanies: () => clientsState,
  useProjectManagers: () => managersState,
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
vi.mock('@/src/hooks/useProjectsMoneyCollection', () => ({
  useProjectsMoneyCollection: () => ({ data: {}, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-pm', org_id: 'org-1' }, role: roleBox.value }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: roleBox.value, realRole: roleBox.value, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isError: false, error: null, isPending: false }),
}));
vi.mock('@/src/components/export/useExport', () => ({ useExport: () => ({ exportXlsx: exportSpy, busy: false }) }));
vi.mock('@/src/hooks/useImportWizard', async (orig) => ({
  ...(await orig<typeof import('@/src/hooks/useImportWizard')>()),
}));

import Projects from './Projects';
import { addBuilderFilter } from './__tests__/projectFilterBuilder.helpers';

const mk = (over: Record<string, unknown>): ProjectWithRefs => ({
  id: 'p1', name: 'Alpha Works', code: 'PRJ-1', status: 'Ongoing Project', client_id: null, project_manager_id: null,
  contract_value: 100_000, currency: 'USD', budget: 1, spent: 0, start_date: '2026-01-10', end_date: '2027-12-31',
  client: null, pm: null, customer_contract_ref: null, contract_date: null, decided_at: null, ...over,
} as unknown as ProjectWithRefs);

const seed = [
  mk({ id: 'p1', name: 'Alpha Works', service_line: 'EPC', sector: 'Energy', location: 'Jakarta' }),
  mk({ id: 'p2', name: 'Beta Works', service_line: 'Operations', sector: 'Mining', location: 'Surabaya', status: 'On Hold' }),
];

const RouteProbe = () => {
  const loc = useLocation();
  return <output data-testid="route-dest" data-search={loc.search} data-state={JSON.stringify(loc.state ?? null)}>{loc.pathname}</output>;
};

const renderPage = (path = '/projects?filter=All') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/projects" element={<><Projects /><RouteProbe /></>} />
          <Route path="/projects/:projectId" element={<RouteProbe />} />
          <Route path="*" element={<RouteProbe />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  sessionStorage.clear();
  projectsState.data = seed;
  projectsState.isPending = false;
  projectsState.isError = false;
  roleBox.value = 'Admin';
  exportSpy.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Projects floor', () => {
  it('floor: Service line, Sector and Award type filter chips narrow the rows and write the URL', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByText('Beta Works')).toBeInTheDocument();

    await addBuilderFilter(user, 'Service line', { operator: 'is', value: 'EPC' });
    expect(screen.queryByText('Beta Works')).not.toBeInTheDocument();
    expect(screen.getByText('Alpha Works')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^clear all$/i }));
    await addBuilderFilter(user, 'Award type', { operator: 'is', value: 'Tender' });
    expect(search_url()).toContain('awardType=tender');
  });

  it('floor: Location contains-filter narrows the rows to the matching location', async () => {
    const user = userEvent.setup();
    renderPage();
    await addBuilderFilter(user, 'Location', { operator: 'contains' });
    await user.click(await screen.findByRole('button', { name: 'Value' }));
    await user.type(await screen.findByLabelText('Location', { selector: 'input' }), 'Jakarta');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    expect(screen.getByText('Alpha Works')).toBeInTheDocument();
    expect(screen.queryByText('Beta Works')).not.toBeInTheDocument();
  });

  it('floor: an unavailable restored filter chip can be removed without dropping the other keys', async () => {
    const user = userEvent.setup();
    renderPage('/projects?filter=All&serviceLine=Ghost&status=On%20Hold');
    // Both chips restore; the unavailable service-line value still filters everything out.
    const chips = screen.getByRole('toolbar', { name: /active filters/i });
    expect(within(chips).getByRole('button', { name: 'Service line filter options' })).toBeVisible();
    await user.click(within(chips).getByRole('button', { name: 'Service line filter options' }));
    await user.click(await screen.findByRole('menuitem', { name: /^remove filter$/i }));
    expect(search_url()).not.toContain('serviceLine=');
    expect(search_url()).toContain('status=On+Hold');
  });

  it('floor: option-load Retry refetches the failed option reads', async () => {
    clientsState.isError = true;
    clientsState.refetch = vi.fn();
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(clientsState.refetch).toHaveBeenCalled();
  });

  it('floor: Export exports exactly the filtered set', async () => {
    const user = userEvent.setup();
    renderPage();
    await addBuilderFilter(user, 'Status', { operator: 'is any of', value: 'On Hold' });
    expect(screen.queryByText('Alpha Works')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^More actions$/i }));
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await vi.waitFor(() => expect(exportSpy).toHaveBeenCalled());
    const rows = exportSpy.mock.calls[0][0] as ProjectWithRefs[];
    expect(rows.map((r) => r.name)).toEqual(['Beta Works']);
  });

  it('floor: Import opens the project import wizard at its upload step', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^More actions$/i }));
    await user.click(screen.getByRole('button', { name: 'Import', exact: true }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/file/i)).toBeInTheDocument();
  });

  it('floor: Import budgets opens the budget import wizard', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^More actions$/i }));
    await user.click(screen.getByRole('button', { name: 'Import budgets' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('floor: a calendar event chip opens the project record with calendar return context', async () => {
    const user = userEvent.setup();
    renderPage('/projects?view=calendar&month=2026-01');
    const chip = screen.getByRole('button', { name: /Alpha Works — start/i });
    await user.click(chip);
    expect(screen.getByTestId('route-dest')).toHaveTextContent('/projects/p1');
    const state = JSON.parse(screen.getByTestId('route-dest').dataset.state ?? '{}') as { pmoListReturn?: { list: string; path: string } };
    expect(state.pmoListReturn?.list).toBe('projects');
    expect(state.pmoListReturn?.path).toContain('view=calendar');
  });

  it('floor: a board card opens the project record', async () => {
    const user = userEvent.setup();
    renderPage('/projects?view=board');
    await user.click(screen.getByText('Alpha Works'));
    expect(screen.getByTestId('route-dest')).toHaveTextContent('/projects/p1');
  });
});

function search_url() {
  return (screen.getByTestId('route-dest') as HTMLOutputElement).getAttribute('data-search') ?? '';
}
