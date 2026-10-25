/** Projects collection controls remain reachable on a phone and preserve behavior contracts. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

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
  usePipelineStageConfig: () => ({ data: [], isSuccess: true }),
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

  it('AC-PRJUX-001: ordered scope, search, sort, view and actions are reachable on a phone', () => {
    renderPage();
    const toolbar = screen.getByTestId('list-page-toolbar');
    const search = within(toolbar).getByRole('searchbox', { name: /search projects/i });
    const scope = within(toolbar).getByRole('combobox', { name: 'Scope' });
    const sort = within(toolbar).getByRole('combobox', { name: 'Sort projects' });
    const viewToggle = within(toolbar).getByRole('combobox', { name: 'View' });
    expect(search).toBeInTheDocument();
    expect(scope).toHaveValue('All');
    expect(sort).toHaveValue('attention');
    for (const name of ['Table', 'Cards', 'Calendar', 'Board']) {
      expect(within(viewToggle).getByRole('option', { name: new RegExp(`^${name}$`) })).toBeInTheDocument();
    }

    expect(within(toolbar).getByRole('button', { name: /^Filters/i })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: /^More actions/i })).toBeInTheDocument();

    // desktop secondary filters + export/import are NOT present in the mobile branch
    expect(screen.queryByRole('combobox', { name: /filter by customer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Export$/i })).not.toBeInTheDocument();

    // header primary action preserved
    expect(within(toolbar).getByRole('button', { name: /new project/i })).toBeInTheDocument();
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

  it('AC-PRJUX-002: count tracks secondary filters; chips remove one filter; Clear all restores the role default', async () => {
    const user = userEvent.setup();
    renderPage();

    // no chips initially
    expect(screen.queryByTestId('active-filter-summary')).not.toBeInTheDocument();

    // open Filters, choose a customer — selecting closes the disclosure and shows a chip
    await user.click(screen.getByRole('button', { name: /^Filters/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: /filter by customer/i }), '11111111-1111-1111-1111-111111111111');
    expect(screen.queryByRole('combobox', { name: /filter by customer/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Customer: Innovate Corp/)).toBeInTheDocument();

    const filtersBtn = screen.getByRole('button', { name: /^Filters/ });
    expect(filtersBtn).toHaveFocus();
    expect(within(filtersBtn).getByTestId('mobile-toolbar-count')).toHaveTextContent('1');

    // add a PM filter too → count 2, both chips
    await user.click(filtersBtn);
    await user.selectOptions(screen.getByRole('combobox', { name: /filter by project manager/i }), '22222222-2222-2222-2222-222222222222');
    expect(screen.getByText(/Project manager: Alice Manager/)).toBeInTheDocument();
    expect(within(filtersBtn).getByTestId('mobile-toolbar-count')).toHaveTextContent('2');

    // remove the customer chip — the manager chip stays
    await user.click(screen.getByRole('button', { name: /Remove filter: Customer: Innovate Corp/ }));
    expect(screen.queryByText(/Customer: Innovate Corp/)).not.toBeInTheDocument();
    expect(screen.getByText(/Project manager: Alice Manager/)).toBeInTheDocument();
    expect(within(filtersBtn).getByTestId('mobile-toolbar-count')).toHaveTextContent('1');

    // AC-TAG-002: filter clearing uses the readable text token in both themes.
    expect(screen.getByRole('button', { name: /Clear filters/i })).toHaveClass('text-primary-text');
    // Clear filters clears the combined summary and returns to the role-default scope.
    await user.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(screen.queryByTestId('active-filter-summary')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue('All');
  });

  it('AC-PRJUX-002: Clear all for an Engineer restores My Projects', async () => {
    const user = userEvent.setup();
    renderPage('Engineer');
    // Search clearing keeps the Engineer's assigned-work default.
    await user.type(screen.getByRole('searchbox', { name: /search projects/i }), 'zzz');
    await user.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(screen.getByRole('searchbox', { name: /search projects/i })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue('My Projects');
  });

  it('AC-PRJUX-002: status-only changes expose Clear all and restore the default', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Scope' }), 'Ongoing');
    await user.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue('All');
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

  it("AC-PRJUX-003: an Engineer's Filters holds classification only, and More actions is permission-gated (Export only)", async () => {
    const user = userEvent.setup();
    renderPage('Engineer');
    await user.click(screen.getByRole('button', { name: /^Filters/i }));
    expect(screen.getByRole('combobox', { name: /filter by service line/i })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /filter by customer/i })).not.toBeInTheDocument();
    const moreBtn = screen.getByRole('button', { name: /^More actions$/i });
    await user.click(moreBtn);
    expect(screen.getByRole('button', { name: /^Export$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import budgets$/i })).not.toBeInTheDocument();
  });

  it('AC-PRJUX-003: opening Filters moves focus into the first field', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Filters/i }));
    expect(screen.getByRole('combobox', { name: /filter by customer/i })).toHaveFocus();
  });

  it('AC-TAG-002: Engineer classification disclosure filters results and clears to My Projects', async () => {
    const user = userEvent.setup();
    projectsState.data = [
      { ...seed[0], service_line: 'Engineering' },
      { ...seed[0], id: 'p2', name: 'Advisory engagement', service_line: 'Advisory' },
    ];
    renderPage('Engineer');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Scope' }), 'All');
    expect(screen.getByText('Advisory engagement')).toBeVisible();

    const classification = screen.getByRole('button', { name: /^Filters/i });
    expect(screen.queryByRole('button', { name: /^Classification$/i })).not.toBeInTheDocument();
    await user.click(classification);
    const serviceLine = screen.getByRole('combobox', { name: /filter by service line/i });
    expect(serviceLine).toHaveFocus();
    expect(screen.queryByRole('combobox', { name: /filter by customer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /filter by project manager/i })).not.toBeInTheDocument();
    await user.selectOptions(serviceLine, 'Engineering');
    expect(classification).toHaveFocus();
    expect(classification).toHaveAttribute('aria-expanded', 'false');
    expect(within(classification).getByTestId('mobile-toolbar-count')).toHaveTextContent('2');
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeVisible();
    expect(screen.queryByText('Advisory engagement')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(screen.getByRole('combobox', { name: 'Scope' })).toHaveValue('My Projects');
    expect(within(classification).queryByTestId('mobile-toolbar-count')).not.toBeInTheDocument();
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

  it('AC-PRJUX-002: customer query loading says nothing extra and keeps the All option', async () => {
    const user = userEvent.setup();
    clientsState.isPending = true;
    clientsState.isSuccess = false;
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Filters/i }));
    expect(screen.queryByText(/Loading options/)).not.toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: /filter by customer/i }) as HTMLSelectElement;
    expect(Array.from(select.options).some((o) => o.value === 'All')).toBe(true);
  });

  it('AC-PRJUX-002: customer query error keeps an actionable Retry options path', async () => {
    const user = userEvent.setup();
    clientsState.isPending = false;
    clientsState.isError = true;
    clientsState.isSuccess = false;
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Filters/i }));
    expect(clientsState.refetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry options' }));
    expect(clientsState.refetch).toHaveBeenCalled();
  });

  it('AC-PRJUX-002: empty options retain All without a helper line (never a blank option)', async () => {
    const user = userEvent.setup();
    clientsState.data = [];
    clientsState.isPending = false;
    clientsState.isError = false;
    clientsState.isSuccess = true;
    renderPage();
    await user.click(screen.getByRole('button', { name: /^Filters/i }));
    expect(screen.queryByText(/No options available/)).not.toBeInTheDocument();
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
    expect(screen.getByTestId('list-page-toolbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear filters/i })).toBeInTheDocument();
  });
});

describe('AC-PRJUX-001 — page states render no incomplete mobile toolbar', () => {
  beforeEach(() => {
    mockMobileViewport();
    roleBox.value = 'Project Manager';
  });

  it('AC-PRJUX-001: loading state retains the collection frame and toolbar', () => {
    projectsState.isPending = true;
    projectsState.isError = false;
    projectsState.data = [];
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.getByTestId('list-page-toolbar')).toBeInTheDocument();
  });

  it('AC-PRJUX-001: error state retains the collection toolbar and Retry', () => {
    projectsState.isPending = false;
    projectsState.isError = true;
    projectsState.data = [];
    renderPage();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    expect(screen.getByTestId('list-page-toolbar')).toBeInTheDocument();
  });

  it('AC-PRJUX-001: zero-project state retains the collection toolbar and one create action', () => {
    projectsState.isPending = false;
    projectsState.isError = false;
    projectsState.data = [];
    renderPage();
    expect(screen.getByText(/No projects yet/i)).toBeInTheDocument();
    expect(screen.getByTestId('list-page-toolbar')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /New project/i })).toHaveLength(1);
  });
});

describe('AC-PRJUX-006 — English and Bahasa resolve every new label', () => {
  it('AC-PRJUX-006: both catalogues define the new mobile labels and fallbacks', () => {
    const root = resolve(__dirname, '..', '..', 'public', 'locales');
    const en = JSON.parse(readFileSync(resolve(root, 'en', 'projects.json'), 'utf8'));
    const id = JSON.parse(readFileSync(resolve(root, 'id', 'projects.json'), 'utf8'));
    const keyAssertions: Array<[string, unknown, unknown]> = [
      ['projects.create.backToProjects', en.create.backToProjects, id.create.backToProjects],
      ['projects.create.workspaceScope', en.create.workspaceScope, id.create.workspaceScope],
      ['projects.create.originScope', en.create.originScope, id.create.originScope],
      ['projects.create.startsAs', en.create.startsAs, id.create.startsAs],
      ['projects.create.leadConsequence', en.create.leadConsequence, id.create.leadConsequence],
      ['projects.create.internalConsequence', en.create.internalConsequence, id.create.internalConsequence],
      ['projects.create.section.ownershipSchedule', en.create.section.ownershipSchedule, id.create.section.ownershipSchedule],
      ['projects.create.section.estimateTax', en.create.section.estimateTax, id.create.section.estimateTax],
    ];
    for (const [key, enV, idV] of keyAssertions) {
      expect(`${key}(en)`, key).toSatisfy(() => typeof enV === 'string' && (enV as string).trim().length > 0);
      expect(`${key}(id)`, key).toSatisfy(() => typeof idV === 'string' && (idV as string).trim().length > 0);
    }
  });
});
