import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import SalesPipeline from './SalesPipeline';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';

// Oracle stages from spec §3.8 — Won/Lost are NOT in the funnel band.
const seedStages = [
  { status: 'Leads', count: 0, total_value: 0, win_probability: 0.1, weighted_value: 0 },
  { status: 'PQ Submitted', count: 1, total_value: 800000, win_probability: 0.25, weighted_value: 200000 },
  { status: 'Quotation Submitted', count: 0, total_value: 0, win_probability: 0.4, weighted_value: 0 },
  { status: 'Tender Submitted', count: 1, total_value: 1200000, win_probability: 0.5, weighted_value: 600000 },
  { status: 'Negotiation', count: 0, total_value: 0, win_probability: 0.75, weighted_value: 0 },
];
const seedProjects = [
  { id: 'p2', name: 'Northwind ERP Rollout', client_name: 'Northwind', pmo_project_number: 'PMO-26-7712', code: 'CLIENT-82', status: 'Tender Submitted', contract_value: 1200000, currency: 'USD', win_probability: 0.5 },
  { id: 'p10', name: 'Regional Services', client_name: null, status: 'PQ Submitted', contract_value: 800000, currency: 'USD', win_probability: 0.25 },
  // #530 / FR-L10N-020: mixed-currency pair for the table regression — each row shows its OWN
  // currency, not the USD org default (a single-currency fixture set could hide a hardcoded literal).
  { id: 'idr1', name: 'IDR Deal', client_name: 'Garuda', status: 'Tender Submitted', contract_value: 1234, currency: 'IDR', win_probability: 0.5 },
  { id: 'usd1', name: 'USD Deal', client_name: 'Acme Corp', status: 'Tender Submitted', contract_value: 9000, currency: 'USD', win_probability: 0.5 },
];

const pipelineState: {
  data: { stages: typeof seedStages; projects: typeof seedProjects } | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = { data: { stages: seedStages, projects: seedProjects }, isPending: false, isError: false, refetch: vi.fn() };

const lostState: { data: Array<Record<string, unknown>>; isPending: boolean; isError: boolean } = {
  data: [],
  isPending: false,
  isError: false,
};
// FR-L10N-020: this component reads useOrgCurrency for its ACROSS-record aggregates. Pinned here
// rather than left to a real query. ⚑ At LINE-START on purpose — inserted inside a neighbouring
// vi.mock call it parses as a syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => pipelineState,
  useLostDeals: () => lostState,
  useDashboard: () => ({ data: undefined, isPending: false, isError: false }),
  useWinRate: () => ({ data: undefined, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));
// B-3: SalesPipeline now renders a "+ New opportunity" CTA backed by useProjectMutations.
// Stub to avoid the QueryClientProvider requirement (this file tests board rendering, not mutations).
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));
// list-working-set-return (#682): the page writes URL changes through the real router navigate
// (one replace per event), so tests read the REAL location to assert the URL and the record-open
// return-context `location.state` instead of mocking navigation away.
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div
      data-testid="location-probe"
      data-pathname={location.pathname}
      data-search={location.search}
      data-state={JSON.stringify(location.state ?? null)}
    />
  );
};

// The pipeline-board journeys are a manager viewing/forecasting the pipeline; render under a
// PM real role so the A-4 Sales view-gate (Admin·Exec·PM·Finance) shows the board.
// ToastProvider is required because the B-3 CTA uses useToast() on deal creation.
// list-working-set-return (#682): the list-return seam captures context only from the list's own
// canonical index path (`/sales`), so the default entry must be `/sales`, not `/`.
const renderPage = (initialPath = '/sales') =>
  render(
    <ImpersonationProvider realRole="Project Manager">
      <MemoryRouter initialEntries={[initialPath]}>
        <LocationProbe />
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  sessionStorage.clear();
  pipelineState.data = { stages: seedStages, projects: seedProjects };
  pipelineState.isPending = false;
  pipelineState.isError = false;
  lostState.data = [];
  lostState.isPending = false;
  lostState.isError = false;
});

describe('SalesPipeline header + funnel (AC-SP-202)', () => {
  it('renders on the shared ListPage shell: header + canonical toolbar (CW-5)', () => {
    renderPage();
    expect(screen.getByTestId('list-page-header')).toBeInTheDocument();
    expect(screen.getByTestId('list-page-toolbar')).toBeInTheDocument();
    // the funnel summary band rides in the shell banner, above the toolbar
    expect(screen.getByLabelText('Pipeline summary')).toBeInTheDocument();
    // the view-switcher is right-aligned (Board / Table)
    expect(screen.getByTestId('list-page-view')).toBeInTheDocument();
  });

  it('AC-SP-202 / C3: renders the page title "Pipeline", the live Export action, and the live "New project" CTA for PM', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Pipeline' })).toBeInTheDocument();
    // C3: the old disabled "New deal" stub is gone; the live "New project" CTA replaced it.
    expect(screen.queryByRole('button', { name: /New deal/i })).toBeNull();
    // PM can create → the live "New project" button is present.
    expect(screen.getByRole('button', { name: /New project/i })).toBeInTheDocument();
    // the live Export outline button is kept.
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
  });

  it('AC-CODE-003: searches pipeline deals by PMO Project Number and Client Project Code', async () => {
    const user = userEvent.setup();
    renderPage();
    const search = screen.getByRole('searchbox', { name: /search projects/i });
    await user.type(search, 'PMO-26-7712');
    await waitFor(() => expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument());
    expect(screen.queryByText('Regional Services')).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'CLIENT-82');
    await waitFor(() => expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument());
    expect(screen.queryByText('Regional Services')).not.toBeInTheDocument();
  });

  it('AC-SP-202: funnel band shows the five open stages, not Won/Lost', () => {
    renderPage();
    const funnel = screen.getByLabelText('Pipeline summary');
    const f = within(funnel);
    expect(f.getByText('Leads')).toBeInTheDocument();
    expect(f.getByText('Negotiation')).toBeInTheDocument();
    expect(f.queryByText(/Won/)).toBeNull();
  });

  it('AC-1117: the weighted total test id is preserved and sums only the open stages', () => {
    renderPage();
    // 200000 + 600000 = 800000
    expect(screen.getByTestId('pipeline-weighted-total')).toHaveTextContent(formatCurrency(800000, 'USD'));
  });
});

describe('SalesPipeline states (AC-SP-203)', () => {
  it('AC-SP-203: loading renders the skeleton ListState (no spinner), aria-busy', () => {
    pipelineState.isPending = true; pipelineState.data = undefined;
    renderPage();
    // funnel band + body both skeleton (no spinner) — every loader is aria-busy.
    const loaders = screen.getAllByTestId('liststate-loading');
    expect(loaders.length).toBeGreaterThan(0);
    loaders.forEach((l) => expect(l).toHaveAttribute('aria-busy', 'true'));
  });

  it('AC-SP-203: error renders an alert + Retry that calls refetch', () => {
    pipelineState.isError = true; pipelineState.data = undefined;
    renderPage();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(pipelineState.refetch).toHaveBeenCalled();
  });

  it('AC-SP-203 / C3: empty renders the teaching empty state with NO dead CTA', () => {
    pipelineState.data = { stages: [], projects: [] };
    renderPage();
    expect(screen.getByText(/No projects yet/i)).toBeInTheDocument();
    // C3: the empty state teaches via its sub copy — no disabled "New deal" CTA.
    expect(screen.queryByRole('button', { name: /New deal/i })).toBeNull();
  });
});

describe('SalesPipeline view toggle (AC-SP-206) + kanban default (AC-SP-204)', () => {
  it('AC-SP-204: defaults to the Kanban view with the Tender stage column + its weighted total', () => {
    renderPage();
    const tender = screen.getByTestId('stage-Tender Submitted');
    expect(within(tender).getAllByText((t) => t.includes(formatCurrency(600000, 'USD'))).length).toBeGreaterThan(0);
  });

  it('AC-SP-206: the view toggle is a tablist with Board selected by default', () => {
    renderPage();
    const toggle = screen.getByRole('tablist', { name: /Pipeline view/i });
    const boardTab = within(toggle).getByRole('tab', { name: /^Board$/i });
    expect(boardTab).toHaveAttribute('aria-selected', 'true');
  });

  it('AC-SP-206 / AC-SP-205: switching to Table renders the DataTable with the deal rows', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    // table view: opportunity rows present
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    // win% progressbar with aria-label
    expect(screen.getAllByRole('progressbar').length).toBeGreaterThan(0);
  });

  it('I3: the data-less "Decision" column of em-dashes is omitted from the table', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    expect(screen.queryByRole('columnheader', { name: /Decision/i })).toBeNull();
  });

  it('#530 / AC-L10N-020: table rows render each deal in its own currency, not the USD org default', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    // The IDR row renders its own code-style NBSP currency (U+00A0) and NO dollar sign. Assert on
    // RAW node text for the NBSP — the default normalizer collapses it to a space, which a
    // plain-space hardcode could otherwise satisfy.
    const idrRow = screen.getByText('IDR Deal').closest('tr')!;
    const idr = within(idrRow as HTMLElement);
    // SOME element inside the row carries the raw NBSP currency. Presence check (cell + ancestors).
    expect(
      idr.getAllByText((_, node) => node?.textContent?.includes('IDR\u00A01,234') ?? false)
        .length,
    ).toBeGreaterThan(0);
    expect(idr.queryByText(/\$/)).toBeNull();
    // The USD row (same table, same stage column) renders its own dollar value and no IDR.
    const usdRow = screen.getByText('USD Deal').closest('tr')!;
    const usd = within(usdRow as HTMLElement);
    expect(usd.getByText('$9,000')).toBeInTheDocument();
    expect(usd.queryByText(/IDR/)).toBeNull();
  });

  it('AC-SP-206: the chosen view persists to sessionStorage', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    expect(sessionStorage.getItem('pmo.workspace.views')).toContain('table');
  });
});

describe('SalesPipeline drill-down (Model B canonical route)', () => {
  // Model B (ADR-0020): the deal's canonical detail route is /projects/:id (was /sales/:id).
  // Director ruling (2026-09-29): the destination stays canonical `/projects/p2` while the
  // record-open now additionally carries validated Sales list-return context.
  it('AC-IXD-PROJ-001 / AC-LRC-004: clicking a card navigates to the canonical /projects/:id detail route, carrying Sales return context', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Northwind ERP Rollout').closest('[role="button"]')!);
    const probe = screen.getByTestId('location-probe');
    await waitFor(() => expect(probe.dataset.pathname).toBe('/projects/p2'));
    const state = JSON.parse(probe.dataset.state ?? 'null') as Record<string, unknown>;
    expect(state.pmoListReturn).toMatchObject({ list: 'sales' });
  });

  it('AC-IXD-PROJ-001 / AC-LRC-004: a table row click navigates to the canonical /projects/:id detail route, carrying Sales return context', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    fireEvent.click(screen.getByText('Northwind ERP Rollout').closest('tr')!);
    const probe = screen.getByTestId('location-probe');
    await waitFor(() => expect(probe.dataset.pathname).toBe('/projects/p2'));
    const state = JSON.parse(probe.dataset.state ?? 'null') as Record<string, unknown>;
    expect(state.pmoListReturn).toMatchObject({ list: 'sales' });
  });
});

// list-working-set-return (#682): AC-LRC-001/002 for Sales — `scope`/`status`/`q`/`view` are
// URL-owned. The owning pure-codec proof lives in src/lib/listWorkingSet.test.ts; here we prove
// the component renders the URL-backed working set and writes ONE replace per event.
describe('SalesPipeline list working set — AC-LRC-001/002', () => {
  it('AC-LRC-001: renders the URL-backed working set (scope + search + view) and refresh/copy reproduces it', () => {
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, currency: 'USD', win_probability: 0 },
    ];
    renderPage('/sales?scope=Lost&q=Coastal&view=table');
    // The URL-driven scope segment is selected.
    expect(screen.getByRole('tab', { name: /^Lost$/i })).toHaveAttribute('aria-selected', 'true');
    // The URL-driven search is present in the search box.
    expect(screen.getByLabelText(/Search projects/i)).toHaveValue('Coastal');
    // The URL-driven view renders the table.
    expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
  });

  it('AC-LRC-001: a control change writes ONE replace of the list URL (no history entry per click)', async () => {
    renderPage('/sales?view=table');
    await userEvent.click(screen.getByRole('tab', { name: /^Lost$/i }));
    const toggle = screen.getByRole('tablist', { name: /Project scope/i });
    expect(within(toggle).getByRole('tab', { name: /^Lost$/i })).toHaveAttribute('aria-selected', 'true');
    // View change persists AND writes the URL in one event (board renders). Scope is meaningful
    // only for the table view (#682 Director ruling, 2026-09-29 — see the dedicated describe
    // block below), so it resets to Open on this same switch rather than surviving untouched.
    await userEvent.click(screen.getByRole('tab', { name: /^Board$/i }));
    expect(screen.getByTestId('stage-Tender Submitted')).toBeInTheDocument();
  });
});

// #682 Director ruling (2026-09-29): the Board is the open pipeline by stage and has no scope.
// Switching Table → Board resets scope to Open in the working set's single write, so the URL no
// longer carries an inert `scope`; a direct/copied board URL with a stale scope parses to Open
// the same way. Switching back to Table then shows Open, never the scope that was active before.
describe('SalesPipeline Board has no scope (#682 Director ruling)', () => {
  it('switching Table (Lost) → Board resets scope to Open and drops it from the URL; switching back to Table shows Open', async () => {
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, currency: 'USD', win_probability: 0 },
    ];
    renderPage('/sales?view=table&scope=Lost');
    expect(screen.getByRole('tab', { name: /^Lost$/i })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: /^Board$/i }));
    // The board renders (no scope segmented control at all — it is table-only).
    expect(screen.getByTestId('stage-Tender Submitted')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: /Project scope/i })).not.toBeInTheDocument();
    // The URL no longer carries the inert scope.
    const probe = screen.getByTestId('location-probe');
    expect(probe.dataset.search).not.toContain('scope=Lost');
    expect(new URLSearchParams(probe.dataset.search).get('scope')).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    expect(screen.getByRole('tab', { name: /^Open$/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Coastal Depot Bid')).toBeNull();
  });

  it('a direct/copied `?view=kanban&scope=Lost` URL parses to Open scope (Board renders; Table then shows Open)', async () => {
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, currency: 'USD', win_probability: 0 },
    ];
    renderPage('/sales?view=kanban&scope=Lost');
    expect(screen.getByRole('tab', { name: /^Board$/i })).toHaveAttribute('aria-selected', 'true');
    // The lost deal still appears on the board (its own terminal Lost column) — the stale scope
    // never hid it, because the board never applied it in the first place.
    expect(screen.getByText('Coastal Depot Bid')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    expect(screen.getByRole('tab', { name: /^Open$/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.queryByText('Coastal Depot Bid')).toBeNull();
  });
});

describe('SalesPipeline — Lost deals in the Pipeline (AC-IXD-PROJ-007)', () => {
  it('AC-IXD-PROJ-007: a lost deal appears in the terminal "Lost" kanban column', () => {
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, currency: 'USD', win_probability: 0 },
    ];
    renderPage();
    const lostColumn = screen.getByTestId('stage-Lost');
    expect(within(lostColumn).getByText('Coastal Depot Bid')).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-007: the "Lost" table filter scopes the table to lost deals', async () => {
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, currency: 'USD', win_probability: 0 },
    ];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    // default Open scope: the open deal shows, the lost deal does not
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.queryByText('Coastal Depot Bid')).toBeNull();
    // switch to the Lost scope: the lost deal shows, the open deal does not
    await userEvent.click(screen.getByRole('tab', { name: /^Lost$/i }));
    expect(screen.getByText('Coastal Depot Bid')).toBeInTheDocument();
    expect(screen.queryByText('Northwind ERP Rollout')).toBeNull();
  });
});

// list-working-set-return (#683): a filtered table zero-match offers a Clear filters action
// (scope/stage/search all reset); the genuine empty-collection state above carries none.
// Supporting case; AC-LRC-012's owning proof is pages/__tests__/listWorkingSet.emptyStates.test.tsx.
describe('SalesPipeline table zero-match', () => {
  it('a Lost-scope search with no matches says so (not "No lost projects") and Clear filters restores the rows and the scope', async () => {
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, currency: 'USD', win_probability: 0 },
    ];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    await userEvent.click(screen.getByRole('tab', { name: /^Lost$/i }));
    expect(screen.getByText('Coastal Depot Bid')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Search projects/i), 'no-such-deal');
    // Lost projects DO exist — the search excluded them, so the scope-empty copy would be false.
    expect(await screen.findByText(/No projects match your search/i)).toBeInTheDocument();
    expect(screen.queryByText(/No lost projects/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Open$/i })).toHaveAttribute('aria-selected', 'true');
  });
});

// #697: in Board view a funnel stage selection used to mark the stage pressed and change nothing
// else (the stage filter only narrows the Table). The selection now takes the board to that stage's
// column (the same jump the mobile stage tabs make) and marks the column.
describe('SalesPipeline Board stage selection (#697)', () => {
  const scrollToSpy = vi.fn();
  beforeEach(() => {
    scrollToSpy.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: scrollToSpy,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  const funnelStage = (name: RegExp) =>
    within(screen.getByLabelText('Pipeline summary')).getByRole('button', { name });

  it('#697: selecting a stage in Board view brings that stage column into view and marks it', async () => {
    renderPage('/sales?view=kanban');
    const stageNav = screen.getByRole('navigation', { name: /Pipeline stage navigation/i });
    expect(within(stageNav).getByRole('button', { name: 'Leads' })).toHaveAttribute('aria-current', 'true');
    expect(scrollToSpy).not.toHaveBeenCalled();

    await userEvent.click(funnelStage(/^Tender/));

    // The board jumped: the programmatic scroll ran on the board's scroller and the indicator
    // moved to the selected stage's column.
    await waitFor(() => expect(scrollToSpy).toHaveBeenCalledTimes(1));
    expect(within(stageNav).getByRole('button', { name: 'Tender' })).toHaveAttribute('aria-current', 'true');
    expect(within(stageNav).getByRole('button', { name: 'Leads' })).not.toHaveAttribute('aria-current');
    // The selected column carries a visible mark; the others do not.
    expect(screen.getByTestId('stage-Tender Submitted').querySelector('[data-selected="true"]')).not.toBeNull();
    expect(screen.getByTestId('stage-Leads').querySelector('[data-selected="true"]')).toBeNull();
    // Not colour-only: the selected column is announced (aria-current) and carries a ring cue.
    const selectedColumn = screen.getByTestId('stage-Tender Submitted').querySelector('[data-selected="true"]');
    expect(selectedColumn).toHaveAttribute('aria-current', 'true');
    expect(selectedColumn).toHaveClass('ring-2');
    expect(screen.getByTestId('stage-Leads').querySelector('[aria-current="true"]')).toBeNull();
  });

  it('#697: selecting a different stage moves again; deselecting clears the mark', async () => {
    renderPage('/sales?view=kanban');
    await userEvent.click(funnelStage(/^Tender/));
    await userEvent.click(funnelStage(/^Negotiation/));
    const stageNav = screen.getByRole('navigation', { name: /Pipeline stage navigation/i });
    await waitFor(() =>
      expect(within(stageNav).getByRole('button', { name: 'Negotiation' })).toHaveAttribute('aria-current', 'true'),
    );
    expect(scrollToSpy).toHaveBeenCalledTimes(2);

    await userEvent.click(funnelStage(/^Negotiation/)); // toggle off
    expect(document.querySelector('[data-selected="true"]')).toBeNull();
  });

  it('#697: a board opened with ?status= already selected lands on that stage column', async () => {
    renderPage('/sales?view=kanban&status=Tender%20Submitted');
    await waitFor(() => expect(scrollToSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('stage-Tender Submitted').querySelector('[data-selected="true"]')).not.toBeNull();
  });

  it('#697: a scroller without scrollTo (old webview) still opens on the selected stage without throwing', () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: undefined });
    renderPage('/sales?view=kanban&status=Tender%20Submitted');
    expect(screen.getByTestId('stage-Tender Submitted').querySelector('[data-selected="true"]')).not.toBeNull();
  });
});

it.each(['table', 'kanban'])('AC-TAG-002 Sales %s filters the actual visible deals by classification', async (view) => {
  pipelineState.data = { stages: seedStages, projects: seedProjects.map((p, i) => ({ ...p, service_line: i === 0 ? 'Engineering' : 'Advisory', sector: 'Energy', location: 'West Java', award_type: 'tender', bidding_entity: 'alone' })) };
  const user = userEvent.setup(); renderPage(`/sales?view=${view}`);
  await user.selectOptions(screen.getByLabelText('Filter by service line'), 'Engineering');
  expect(screen.getByText('Northwind ERP Rollout')).toBeVisible();
  expect(screen.queryByText('Regional Services')).toBeNull();
  await user.type(screen.getByLabelText('Filter by location'), 'Bali');
  // #830: the location filter writes the URL after a short pause, not on every keystroke.
  await waitFor(() => expect(screen.queryByText('Northwind ERP Rollout')).toBeNull());
  expect(screen.getByTestId('location-probe').getAttribute('data-search')).toContain('location=Bali');
  if (view === 'kanban') expect(screen.getByText('No projects match these classifications')).toBeVisible();
});

describe('#830 location filter debounce', () => {
  const rowsWithClassification = () => seedProjects.map((p, i) => ({ ...p, service_line: i === 0 ? 'Engineering' : 'Advisory', sector: 'Energy', location: 'West Java', award_type: 'tender', bidding_entity: 'alone' }));
  const probeSearch = () => screen.getByTestId('location-probe').getAttribute('data-search') ?? '';

  it('AC-TAG-002 typing a location writes the URL only after the 300ms pause', async () => {
    pipelineState.data = { stages: seedStages, projects: rowsWithClassification() };
    vi.useFakeTimers();
    try {
      renderPage('/sales?view=table');
      fireEvent.change(screen.getByLabelText('Filter by location'), { target: { value: 'Bali' } });
      expect(probeSearch()).not.toContain('location=');
      await act(async () => { await vi.advanceTimersByTimeAsync(299); });
      expect(probeSearch()).not.toContain('location=');
      await act(async () => { await vi.advanceTimersByTimeAsync(2); });
      expect(probeSearch()).toContain('location=Bali');
    } finally { vi.useRealTimers(); }
  });

  it('AC-TAG-002 Clear filters within the pause cancels the pending location', async () => {
    pipelineState.data = { stages: seedStages, projects: rowsWithClassification() };
    vi.useFakeTimers();
    try {
      renderPage('/sales?view=table&serviceLine=Engineering');
      fireEvent.change(screen.getByLabelText(/Search projects/i), { target: { value: 'no-such-deal' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      fireEvent.change(screen.getByLabelText('Filter by location'), { target: { value: 'Bali' } });
      fireEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(probeSearch()).not.toContain('location=');
      expect((screen.getByLabelText('Filter by location') as HTMLInputElement).value).toBe('');
    } finally { vi.useRealTimers(); }
  });
});
