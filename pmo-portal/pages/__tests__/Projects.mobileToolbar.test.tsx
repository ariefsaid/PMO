/**
 * AC-PRJUX-001 through AC-PRJUX-006 — Projects phone-width mobile toolbar.
 *
 * At <768px the ListPage single-renders the mobile node: status (bounded scroll),
 * search, the full view toggle (Table included — DataTable already reflows it into
 * cards), the one filter builder (#1983: Add filter + removable chips), a permission-gated
 * More actions disclosure, and one list-wide Clear all. The desktop secondary
 * filters / export / import copies are absent in this branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { addBuilderFilter, removeBuilderFilter } from './projectFilterBuilder.helpers';

const chipCount = () => document.querySelectorAll('[data-slot=filters] [data-rule-id]').length;

// list-working-set-return (#682): `client`/`pm` are URL-owned referenced-ID filters — the codec's
// `referenceValue` accepts only a syntactically valid UUID (or a named sentinel), falling back to
// "All" otherwise. Fixture IDs must be real UUID-shaped strings so a selection round-trips through
// the URL instead of being silently rejected back to the default.
const { projectsState, clientsState, managersState, roleBox } = vi.hoisted(() => ({
  projectsState: {
    data: [] as unknown as ProjectWithRefs[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  clientsState: {
    data: [{ id: '11111111-1111-1111-1111-111111111111', name: 'Innovate Corp' }],
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  },
  managersState: {
    data: [{ id: '22222222-2222-2222-2222-222222222222', full_name: 'Alice Manager' }],
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  },
  roleBox: { value: 'Project Manager' as string },
}));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [], isError: false }),
}));
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
  useAuth: () => ({ currentUser: { id: '22222222-2222-2222-2222-222222222222', org_id: 'org-1' }, role: roleBox.value }),
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
vi.mock('../../components/ProjectCalendarView', () => ({
  default: () => <div data-testid="project-calendar-view" />,
}));
vi.mock('../../components/ProjectKanbanBoard', () => ({
  default: () => <div data-testid="project-kanban-board" />,
}));

import Projects from '../Projects';

const seed: ProjectWithRefs[] = [
  {
    id: 'p1', name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', status: 'Ongoing Project',
    client_id: '11111111-1111-1111-1111-111111111111', project_manager_id: '22222222-2222-2222-2222-222222222222', contract_value: 1_000_000, currency: 'USD',
    budget: 800_000, spent: 400_000, end_date: '2026-12-31',
    client: { name: 'Innovate Corp' }, pm: { full_name: 'Alice Manager' },
    customer_contract_ref: null, contract_date: null, decided_at: null,
  } as unknown as ProjectWithRefs,
];

// Force the <md> viewport so ListPage single-renders the mobile toolbar branch.
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

const resets = {
  data: seed,
  isPending: false,
  isError: false,
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

describe('AC-PRJUX-001 — loaded mobile composition', () => {
  beforeEach(() => {
    mockMobileViewport();
    projectsState.data = resets.data;
    projectsState.isPending = false;
    projectsState.isError = false;
    clientsState.isPending = false;
    clientsState.isError = false;
    clientsState.isSuccess = true;
    managersState.isPending = false;
    managersState.isError = false;
    managersState.isSuccess = true;
    roleBox.value = 'Project Manager';
  });

  it('AC-PRJUX-001: status, search, full view toggle, Add filter, More actions, New project are reachable; desktop copies absent', () => {
    renderPage();
    expect(screen.getByTestId('projects-mobile-toolbar')).toBeInTheDocument();

    // status scroller (bounded) with status tabs
    expect(screen.getByTestId('status-filter-scroll')).toBeInTheDocument();
    const statusTabs = screen.getByRole('tablist', { name: /status filter/i });
    expect(within(statusTabs).getByRole('tab', { name: /^All$/i })).toBeInTheDocument();

    // search
    expect(screen.getByRole('searchbox', { name: /search projects/i })).toBeInTheDocument();

    // full view toggle — the selected view (Table) AND all four are reachable
    const viewToggle = screen.getByRole('tablist', { name: /projects view/i });
    for (const name of ['Table', 'Cards', 'Calendar', 'Board']) {
      expect(within(viewToggle).getByRole('tab', { name: new RegExp(`^${name}$`) })).toBeInTheDocument();
    }
    expect(within(viewToggle).getByRole('tab', { name: /^Table$/i })).toHaveAttribute('aria-selected', 'true');

    // disclosures
    expect(screen.getByRole('button', { name: /^Add filter$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^More actions$/i })).toBeInTheDocument();

    // desktop secondary filters + export/import are NOT present in the mobile branch
    expect(screen.queryByRole('combobox', { name: /filter by customer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Export$/i })).not.toBeInTheDocument();

    // header primary action preserved
    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument();
  });

  it('AC-1242: selects the trailing At risk filter and Board view from the phone toolbar', async () => {
    renderPage();
    const user = userEvent.setup();
    const statusTabs = screen.getByRole('tablist', { name: /status filter/i });
    const atRiskTab = within(statusTabs).getByRole('tab', { name: /^At risk$/i });
    await user.click(atRiskTab);
    expect(atRiskTab).toHaveAttribute('aria-selected', 'true');

    const viewTabs = screen.getByRole('tablist', { name: /projects view/i });
    const boardTab = within(viewTabs).getByRole('tab', { name: /^Board$/i });
    await user.click(boardTab);
    expect(boardTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('project-kanban-board')).toBeInTheDocument();

    // Leave the persisted view at its default so later tests start from the same state.
    await user.click(within(viewTabs).getByRole('tab', { name: /^Table$/i }));
  });
});

describe('AC-PRJUX-002 — Filters count, chips, remove, Clear all', () => {
  beforeEach(() => {
    mockMobileViewport();
    projectsState.data = resets.data;
    projectsState.isPending = false;
    projectsState.isError = false;
    roleBox.value = 'Project Manager';
  });

  it('AC-PRJUX-002: chips track secondary filters; a chip removes one filter; Clear all restores the role default', async () => {
    const user = userEvent.setup();
    renderPage();

    // no chips initially
    expect(chipCount()).toBe(0);
    expect(screen.queryByRole('button', { name: /Clear all/i })).not.toBeInTheDocument();

    // choose a customer: it becomes a chip
    await addBuilderFilter(user, 'Customer', { value: 'Innovate Corp' });
    expect(chipCount()).toBe(1);
    expect(within(screen.getByRole('toolbar', { name: /active filters/i })).getByText('Innovate Corp')).toBeInTheDocument();

    // add a PM filter too: both chips
    await addBuilderFilter(user, 'Project manager', { value: 'Alice Manager' });
    expect(chipCount()).toBe(2);

    // remove the customer chip: the manager chip stays
    await removeBuilderFilter(user, 'Customer');
    expect(chipCount()).toBe(1);
    expect(within(screen.getByRole('toolbar', { name: /active filters/i })).queryByText('Innovate Corp')).not.toBeInTheDocument();
    expect(within(screen.getByRole('toolbar', { name: /active filters/i })).getByText('Alice Manager')).toBeInTheDocument();

    // AC-TAG-002: filter clearing uses the readable text token in both themes.
    expect(screen.getByRole('button', { name: /Clear all/i })).toHaveClass('text-primary-text');
    // Clear all clears chips and returns to role-default status (All for PM)
    await user.click(screen.getByRole('button', { name: /Clear all/i }));
    expect(chipCount()).toBe(0);
    expect(screen.getByRole('tab', { name: /^All$/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-PRJUX-002: Clear all for an Engineer restores My Projects', async () => {
    const user = userEvent.setup();
    renderPage('Engineer');
    // Search clearing keeps the Engineer's assigned-work default.
    await user.type(screen.getByRole('searchbox', { name: /search projects/i }), 'zzz');
    await user.click(screen.getByRole('button', { name: /Clear all/i }));
    expect(screen.getByRole('searchbox', { name: /search projects/i })).toHaveValue('');
    expect(screen.getByRole('tab', { name: /My Projects/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-PRJUX-002: status-only changes expose Clear all and restore the default', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: /ongoing/i }));
    await user.click(screen.getByRole('button', { name: /Clear all/i }));
    expect(screen.getByRole('tab', { name: /^All$/i })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('AC-PRJUX-003 — disclosure keyboard, Escape, permission gating', () => {
  beforeEach(() => {
    mockMobileViewport();
    projectsState.data = resets.data;
    projectsState.isPending = false;
    projectsState.isError = false;
    roleBox.value = 'Project Manager';
  });

  it('AC-PRJUX-003: the Add filter popover closes on Escape and focus returns to its trigger', async () => {
    const user = userEvent.setup();
    renderPage();
    const add = screen.getByRole('button', { name: /^Add filter$/i });
    await user.click(add);
    expect(add).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(add).toHaveAttribute('aria-expanded', 'false');
    expect(add).toHaveFocus();
  });

  it('AC-PRJUX-003: More actions exposes Export/Import/Import budgets and closes on Escape with focus restored', async () => {
    const user = userEvent.setup();
    renderPage();
    const moreBtn = screen.getByRole('button', { name: /^More actions$/i });
    await user.click(moreBtn);
    expect(screen.getByRole('button', { name: /^Export$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Import$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Import budgets$/i })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /^Export$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^More actions$/i })).toHaveFocus();
  });

  it('AC-PRJUX-003: Export closes More actions and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    renderPage();
    const moreBtn = screen.getByRole('button', { name: /^More actions$/i });
    await user.click(moreBtn);
    await user.click(screen.getByRole('button', { name: /^Export$/i }));
    expect(moreBtn).toHaveAttribute('aria-expanded', 'false');
    expect(moreBtn).toHaveFocus();
  });

  it("AC-PRJUX-003: an Engineer's filter builder holds classification only, and More actions is permission-gated (Export only)", async () => {
    const user = userEvent.setup();
    renderPage('Engineer');
    await user.click(screen.getByRole('button', { name: /^Add filter$/i }));
    expect(await screen.findByRole('option', { name: 'Service line' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Customer' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    const moreBtn = screen.getByRole('button', { name: /^More actions$/i });
    await user.click(moreBtn);
    expect(screen.getByRole('button', { name: /^Export$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import budgets$/i })).not.toBeInTheDocument();
  });

  it('AC-PRJUX-003: opening Add filter moves focus into the field search', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Add filter$/i }));
    expect(await screen.findByPlaceholderText('Search filters…')).toHaveFocus();
  });

  it('AC-TAG-002: Engineer classification filter narrows results and clears to My Projects', async () => {
    const user = userEvent.setup();
    projectsState.data = [
      { ...seed[0], service_line: 'Engineering' },
      { ...seed[0], id: 'p2', name: 'Advisory engagement', service_line: 'Advisory' },
    ];
    renderPage('Engineer');
    await user.click(screen.getByRole('tab', { name: /^All$/i }));
    expect(screen.getByText('Advisory engagement')).toBeVisible();

    await addBuilderFilter(user, 'Service line', { value: 'Engineering' });
    expect(chipCount()).toBe(1);
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
    expect(screen.queryByText('Advisory engagement')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Clear all/i }));
    expect(screen.getByRole('tab', { name: /My Projects/i })).toHaveAttribute('aria-selected', 'true');
    expect(chipCount()).toBe(0);
  });
});

describe('AC-PRJUX-002/005 — option loading/error/empty + no-match keep All and helpers', () => {
  beforeEach(() => {
    mockMobileViewport();
    projectsState.data = resets.data;
    projectsState.isPending = false;
    projectsState.isError = false;
    roleBox.value = 'Project Manager';
  });

  it('AC-PRJUX-002: customer query loading says nothing extra and keeps the list unfiltered', async () => {
    const user = userEvent.setup();
    clientsState.isPending = true;
    clientsState.isSuccess = false;
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Add filter$/i }));
    await user.click(await screen.findByRole('option', { name: 'Customer' }));
    expect(screen.queryByText(/Loading options/)).not.toBeInTheDocument();
    // Nothing is applied until the person picks a value: the list stays unfiltered.
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
  });

  it('AC-PRJUX-002: customer query error shows translated error + a Retry that refetches', async () => {
    const user = userEvent.setup();
    clientsState.isPending = false;
    clientsState.isError = true;
    clientsState.isSuccess = false;
    renderPage();
    expect(screen.getByText(/couldn't load options/i)).toBeInTheDocument();
    expect(clientsState.refetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Retry/i }));
    expect(clientsState.refetch).toHaveBeenCalled();
  });

  it('AC-PRJUX-002: empty options show no helper line (never a blank option)', async () => {
    const user = userEvent.setup();
    clientsState.data = [];
    clientsState.isPending = false;
    clientsState.isError = false;
    clientsState.isSuccess = true;
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Add filter$/i }));
    await user.click(await screen.findByRole('option', { name: 'Customer' }));
    await user.click(await screen.findByRole('option', { name: 'is' }));
    expect(screen.queryByText(/No options available/)).not.toBeInTheDocument();
    const options = screen.queryAllByRole('option').map((o) => o.textContent);
    expect(options.some((t) => !t || t.trim().length === 0)).toBe(false);
  });

  it('AC-PRJUX-002: a no-match result keeps the toolbar/chips and the existing clear action', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByRole('searchbox', { name: /search projects/i }), 'zzz-no-match');
    expect(screen.getByText(/No projects match/i)).toBeInTheDocument();
    expect(screen.getByTestId('projects-mobile-toolbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear filters/i })).toBeInTheDocument();
  });
});

describe('AC-PRJUX-001 — page states render no incomplete mobile toolbar', () => {
  beforeEach(() => {
    mockMobileViewport();
    roleBox.value = 'Project Manager';
  });

  it('AC-PRJUX-001: loading state shows the loading shell and no mobile toolbar', () => {
    projectsState.isPending = true;
    projectsState.isError = false;
    projectsState.data = [];
    renderPage();
    expect(screen.getByTestId('projects-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('projects-mobile-toolbar')).not.toBeInTheDocument();
  });

  it('AC-PRJUX-001: error state shows the ListState error and no mobile toolbar', () => {
    projectsState.isPending = false;
    projectsState.isError = true;
    projectsState.data = [];
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    expect(screen.queryByTestId('projects-mobile-toolbar')).not.toBeInTheDocument();
  });

  it('AC-PRJUX-001: zero-project state shows the teaching empty state and no mobile toolbar', () => {
    projectsState.isPending = false;
    projectsState.isError = false;
    projectsState.data = [];
    renderPage();
    expect(screen.getByText(/No projects yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('projects-mobile-toolbar')).not.toBeInTheDocument();
  });
});

describe('AC-PRJUX-006 — English and Bahasa resolve every new label', () => {
  it('AC-PRJUX-006: both catalogues define the new mobile labels and fallbacks', () => {
    const root = resolve(__dirname, '..', '..', 'public', 'locales');
    const en = JSON.parse(readFileSync(resolve(root, 'en', 'common.json'), 'utf8'));
    const id = JSON.parse(readFileSync(resolve(root, 'id', 'common.json'), 'utf8'));

    const enMobile = en.projects.mobile;
    const idMobile = id.projects.mobile;
    const enBuilder = JSON.parse(readFileSync(resolve(root, 'en', 'projects.json'), 'utf8')).filterBuilder;
    const idBuilder = JSON.parse(readFileSync(resolve(root, 'id', 'projects.json'), 'utf8')).filterBuilder;
    const keyAssertions: Array<[string, unknown, unknown]> = [
      ['projects:filterBuilder.addFilter', enBuilder.addFilter, idBuilder.addFilter],
      ['uxs14.moreActions', en.uxs14.moreActions, id.uxs14.moreActions],
      ['projects.mobile.clearAll', enMobile.clearAll, idMobile.clearAll],
      ['projects:filterBuilder.remove', enBuilder.remove, idBuilder.remove],
      ['projects.mobile.error', enMobile.error, idMobile.error],
      ['projects.mobile.retry', enMobile.retry, idMobile.retry],
    ];
    for (const [key, enV, idV] of keyAssertions) {
      expect(`${key}(en)`, key).toSatisfy(() => typeof enV === 'string' && (enV as string).trim().length > 0);
      expect(`${key}(id)`, key).toSatisfy(() => typeof idV === 'string' && (idV as string).trim().length > 0);
    }
    // PM fallback keys present in both
    expect(typeof en.projects.unnamedUser).toBe('string');
    expect(typeof id.projects.unnamedUser).toBe('string');
    expect(en.projects.unnamedUser.trim().length).toBeGreaterThan(0);
    expect(id.projects.unnamedUser.trim().length).toBeGreaterThan(0);
  });
});
