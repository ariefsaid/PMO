/**
 * AC-PRJUX-001 through AC-PRJUX-006 — Projects phone-width mobile toolbar.
 *
 * At <768px the ListPage single-renders the mobile node: status (bounded scroll),
 * search, the full view toggle (Table included — DataTable already reflows it into
 * cards), a non-Engineer Filters disclosure, a permission-gated More actions
 * disclosure, and active secondary-filter chips + Clear all. The desktop secondary
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

const { projectsState, clientsState, managersState, viewBox, roleBox } = vi.hoisted(() => ({
  projectsState: {
    data: [] as unknown as ProjectWithRefs[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  clientsState: {
    data: [{ id: 'c2', name: 'Innovate Corp' }],
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  },
  managersState: {
    data: [{ id: 'u-pm', full_name: 'Alice Manager' }],
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  },
  viewBox: { value: 'table' as 'table' | 'cards' | 'calendar' | 'kanban' },
  roleBox: { value: 'Project Manager' as string },
}));

vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProjectView', () => ({
  useProjectView: () => [viewBox.value, vi.fn()] as [typeof viewBox.value, () => void],
}));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));
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
    id: 'p1', name: 'Innovate Corp HQ Fit-Out', code: 'PRJ-001', status: 'Ongoing Project',
    client_id: 'c2', project_manager_id: 'u-pm', contract_value: 1_000_000, currency: 'USD',
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
    viewBox.value = 'table';
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

  it('AC-PRJUX-001: status, search, full view toggle, Filters, More actions, New project are reachable; desktop copies absent', () => {
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
    expect(screen.getByRole('button', { name: /^Filters$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^More actions$/i })).toBeInTheDocument();

    // desktop secondary filters + export/import are NOT present in the mobile branch
    expect(screen.queryByRole('combobox', { name: /filter by customer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Export$/i })).not.toBeInTheDocument();

    // header primary action preserved
    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument();
  });
});

describe('AC-PRJUX-002 — Filters count, chips, remove, Clear all', () => {
  beforeEach(() => {
    mockMobileViewport();
    viewBox.value = 'table';
    projectsState.data = resets.data;
    projectsState.isPending = false;
    projectsState.isError = false;
    roleBox.value = 'Project Manager';
  });

  it('AC-PRJUX-002: count tracks secondary filters; chips remove one filter; Clear all restores the role default', async () => {
    const user = userEvent.setup();
    renderPage();

    // no chips initially
    expect(screen.queryByTestId('active-filter-chips')).not.toBeInTheDocument();

    // open Filters, choose a customer — selecting closes the disclosure and shows a chip
    await user.click(screen.getByRole('button', { name: /^Filters$/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: /filter by customer/i }), 'c2');
    expect(screen.queryByRole('combobox', { name: /filter by customer/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Customer: Innovate Corp/)).toBeInTheDocument();

    const filtersBtn = screen.getByRole('button', { name: /^Filters/ });
    expect(filtersBtn).toHaveFocus();
    expect(within(filtersBtn).getByTestId('mobile-toolbar-count')).toHaveTextContent('1');

    // add a PM filter too → count 2, both chips
    await user.click(filtersBtn);
    await user.selectOptions(screen.getByRole('combobox', { name: /filter by project manager/i }), 'u-pm');
    expect(screen.getByText(/Project manager: Alice Manager/)).toBeInTheDocument();
    expect(within(filtersBtn).getByTestId('mobile-toolbar-count')).toHaveTextContent('2');

    // remove the customer chip — the manager chip stays
    await user.click(screen.getByRole('button', { name: /Remove customer filter: Innovate Corp/ }));
    expect(screen.queryByText(/Customer: Innovate Corp/)).not.toBeInTheDocument();
    expect(screen.getByText(/Project manager: Alice Manager/)).toBeInTheDocument();
    expect(within(filtersBtn).getByTestId('mobile-toolbar-count')).toHaveTextContent('1');

    // Clear all clears chips and returns to role-default status (All for PM)
    await user.click(screen.getByRole('button', { name: /Clear all/i }));
    expect(screen.queryByTestId('active-filter-chips')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^All$/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-PRJUX-002: Clear all for an Engineer restores My Projects', async () => {
    const user = userEvent.setup();
    renderPage('Engineer');
    // Engineer has no secondary filters, but search can be cleared; assert status default is My Projects
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
    viewBox.value = 'table';
    projectsState.data = resets.data;
    projectsState.isPending = false;
    projectsState.isError = false;
    roleBox.value = 'Project Manager';
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

  it('AC-PRJUX-003: an Engineer gets no Filters and a permission-gated More actions (Export only)', async () => {
    const user = userEvent.setup();
    renderPage('Engineer');
    expect(screen.queryByRole('button', { name: /^Filters$/i })).not.toBeInTheDocument();
    const moreBtn = screen.getByRole('button', { name: /^More actions$/i });
    await user.click(moreBtn);
    expect(screen.getByRole('button', { name: /^Export$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import budgets$/i })).not.toBeInTheDocument();
  });

  it('AC-PRJUX-003: opening Filters moves focus into the first field', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Filters$/i }));
    expect(screen.getByRole('combobox', { name: /filter by customer/i })).toHaveFocus();
  });
});

describe('AC-PRJUX-002/005 — option loading/error/empty + no-match keep All and helpers', () => {
  beforeEach(() => {
    mockMobileViewport();
    viewBox.value = 'table';
    projectsState.data = resets.data;
    projectsState.isPending = false;
    projectsState.isError = false;
    roleBox.value = 'Project Manager';
  });

  it('AC-PRJUX-002: customer query loading shows a translated helper and keeps the All option', async () => {
    const user = userEvent.setup();
    clientsState.isPending = true;
    clientsState.isSuccess = false;
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Filters$/i }));
    expect(screen.getByText(/Loading options/)).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: /filter by customer/i }) as HTMLSelectElement;
    expect(Array.from(select.options).some((o) => o.value === 'All')).toBe(true);
  });

  it('AC-PRJUX-002: customer query error shows translated error + a Retry that refetches', async () => {
    const user = userEvent.setup();
    clientsState.isPending = false;
    clientsState.isError = true;
    clientsState.isSuccess = false;
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Filters$/i }));
    expect(screen.getByText(/couldn't load options/i)).toBeInTheDocument();
    expect(clientsState.refetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Retry/i }));
    expect(clientsState.refetch).toHaveBeenCalled();
  });

  it('AC-PRJUX-002: empty options retain All with a no-options helper (never a blank option)', async () => {
    const user = userEvent.setup();
    clientsState.data = [];
    clientsState.isPending = false;
    clientsState.isError = false;
    clientsState.isSuccess = true;
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Filters$/i }));
    expect(screen.getByText(/No options available/)).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: /filter by customer/i }) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options.some((t) => t && t.trim().length === 0)).toBe(false);
    expect(options.some((t) => t === 'All customers')).toBe(true);
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
    viewBox.value = 'table';
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
    const keyAssertions: Array<[string, unknown, unknown]> = [
      ['projects.mobile.filters', enMobile.filters, idMobile.filters],
      ['projects.mobile.more', enMobile.more, idMobile.more],
      ['projects.mobile.clearAll', enMobile.clearAll, idMobile.clearAll],
      ['projects.mobile.removeCustomer', enMobile.removeCustomer, idMobile.removeCustomer],
      ['projects.mobile.removeManager', enMobile.removeManager, idMobile.removeManager],
      ['projects.mobile.loading', enMobile.loading, idMobile.loading],
      ['projects.mobile.error', enMobile.error, idMobile.error],
      ['projects.mobile.retry', enMobile.retry, idMobile.retry],
      ['projects.mobile.noOptions', enMobile.noOptions, idMobile.noOptions],
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
