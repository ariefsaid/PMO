import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import SalesPipeline from './SalesPipeline';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import { findPageAnnouncement } from '@/src/components/ui/__tests__/announcementTestQueries';
import { formatCurrencyAuto } from '@/src/lib/format';
import type { PipelineProject } from '@/src/lib/db/dashboard';

const viewport = vi.hoisted(() => ({ isDesktop: true }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => viewport.isDesktop }));

// Oracle stages from spec §3.8 — Won/Lost are NOT in the funnel band.
const seedStages = [
  { status: 'Leads', count: 0, total_value: 0, win_probability: 0.1, weighted_value: 0 },
  { status: 'PQ Submitted', count: 1, total_value: 800000, win_probability: 0.25, weighted_value: 200000 },
  { status: 'Quotation Submitted', count: 0, total_value: 0, win_probability: 0.4, weighted_value: 0 },
  { status: 'Tender Submitted', count: 1, total_value: 1200000, win_probability: 0.5, weighted_value: 600000 },
  { status: 'Negotiation', count: 0, total_value: 0, win_probability: 0.75, weighted_value: 0 },
];
const seedProjects: PipelineProject[] = [
  { id: 'p2', name: 'Northwind ERP Rollout', short_name: null as string | null, client_name: 'Northwind', pmo_project_number: 'PMO-26-7712', code: 'CLIENT-82', status: 'Tender Submitted', contract_value: 1200000, currency: 'USD', tax_treatment: null, win_probability: 0.5 },
  { id: 'p10', name: 'Regional Services', short_name: null as string | null, client_name: null, status: 'PQ Submitted', contract_value: 800000, currency: 'USD', tax_treatment: null, win_probability: 0.25 },
  // #530 / FR-L10N-020: mixed-currency pair for the table regression — each row shows its OWN
  // currency, not the USD org default (a single-currency fixture set could hide a hardcoded literal).
  { id: 'idr1', name: 'IDR Deal', short_name: null as string | null, client_name: 'Garuda', status: 'Tender Submitted', contract_value: 1234, currency: 'IDR', tax_treatment: null, win_probability: 0.5 },
  { id: 'usd1', name: 'USD Deal', short_name: null as string | null, client_name: 'Acme Corp', status: 'Tender Submitted', contract_value: 9000, currency: 'USD', tax_treatment: null, win_probability: 0.5 },
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
  viewport.isDesktop = true;
  sessionStorage.clear();
  pipelineState.data = { stages: seedStages, projects: seedProjects };
  pipelineState.isPending = false;
  pipelineState.isError = false;
  lostState.data = [];
  lostState.isPending = false;
  lostState.isError = false;
});

describe('SalesPipeline header + summary (AC-SP-202)', () => {
  it('renders the shared page heading, ordered controls, closed read-only summary, and desktop view control', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Sales Pipeline' })).toBeInTheDocument();
    expect(screen.getByText(/Open · Oldest activity first/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sales pipeline controls' })).toBeInTheDocument();
    expect(screen.getByTestId('sales-summary')).not.toHaveAttribute('open');
    expect(screen.getByRole('tablist', { name: /Pipeline view/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Project scope' })).toHaveValue('Open');
    expect(screen.getByRole('combobox', { name: 'Stage' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('activity-oldest');
  });

  it('AC-SP-202 / C3: renders the page title "Pipeline", the live Export action, and the live "New project" CTA for PM', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Sales Pipeline' })).toBeInTheDocument();
    // C3: the old disabled "New deal" stub is gone; the live "New project" CTA replaced it.
    expect(screen.queryByRole('button', { name: /New deal/i })).toBeNull();
    // PM can create → the live "New project" button is present.
    const controls = screen.getByRole('region', { name: 'Sales pipeline controls' });
    const create = within(controls).getByRole('button', { name: /New project/i });
    expect(controls.lastElementChild).toContainElement(create);
    // The live Export action remains reachable on desktop.
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /New project/i })).toHaveLength(1);
  });

  it('AC-002 #1325: open pipeline cards and table search by both identities while disclosing the contractual title', async () => {
    const contractualName = 'Contractual Regional Development Agreement';
    const shortName = 'North Terminal';
    pipelineState.data = {
      stages: seedStages,
      projects: [{ ...seedProjects[0], name: contractualName, short_name: shortName }],
    };
    renderPage();

    expect(screen.getByRole('link', { name: shortName })).toBeInTheDocument();
    expect(screen.getByText(contractualName)).toBeInTheDocument();
    const search = screen.getByRole('searchbox', { name: /search projects/i });
    fireEvent.change(search, { target: { value: contractualName } });
    expect(screen.getByText(shortName)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    expect(screen.getByText(shortName)).toBeInTheDocument();
    fireEvent.change(search, { target: { value: shortName } });
    expect(screen.getByText(shortName)).toBeInTheDocument();
    expect(screen.queryByText('Regional Services')).not.toBeInTheDocument();
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

  it('AC-SP-202: the collapsed summary opens to five read-only open stages, not Won/Lost', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Pipeline summary'));
    const f = within(screen.getByTestId('sales-summary'));
    expect(f.getByText('Leads')).toBeInTheDocument();
    expect(f.getByText('Negotiation')).toBeInTheDocument();
    expect(f.queryByText(/Won/)).toBeNull();
    expect(f.queryByRole('button')).toBeNull();
  });

  it('AC-SALES-S02: mixed pipeline currencies show one caveat and suppress cross-stage comparison bars', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Pipeline summary'));
    const summary = screen.getByTestId('sales-summary');
    expect(summary).toHaveTextContent(/Some stage totals are unavailable or span mixed currencies/i);
    expect(within(summary).getByTestId('pipeline-weighted-total')).toHaveTextContent('Not available');
    expect(within(summary).getByRole('link', { name: 'Review project records' })).toHaveAttribute('href', '/projects');
    expect(within(summary).getAllByTestId('funnel-stage-grid')[0]).toBeInTheDocument();
  });

  it('AC-SALES-S02: one-currency open stages show exactly one combined weighted forecast', async () => {
    pipelineState.data = {
      stages: seedStages,
      projects: seedProjects.filter((project) => project.currency === 'USD'),
    };
    renderPage();
    await userEvent.click(screen.getByText('Pipeline summary'));
    const forecast = within(screen.getByTestId('sales-summary')).getByTestId('pipeline-weighted-total');
    expect(forecast).toHaveTextContent(formatCurrencyAuto(800000, 'USD'));
    expect(screen.getAllByTestId('pipeline-weighted-total')).toHaveLength(1);
    expect(screen.queryAllByTestId('funnel-stage-weighted')).toHaveLength(0);
  });

  it('RD-046: preserves fractional precision in the visible row and stage summary', async () => {
    const exactValue = 2_345_678.25;
    pipelineState.data = {
      stages: seedStages.map((stage) => stage.status === 'Leads'
        ? { ...stage, count: 1, total_value: exactValue, weighted_value: exactValue * 0.1 }
        : stage),
      projects: [{ ...seedProjects[0], id: 'fractional', name: 'Fractional Deal', status: 'Leads', contract_value: exactValue, win_probability: 0.1 }],
    };
    renderPage('/sales?view=table');
    const row = screen.getByRole('row', { name: /Fractional Deal/ });
    expect(within(row).getByText(formatCurrencyAuto(exactValue, 'USD'))).toBeInTheDocument();

    await userEvent.click(screen.getByText('Pipeline summary'));
    const summary = screen.getByTestId('sales-summary');
    const leads = within(summary).getByText('Leads').closest('[data-funnel-stage]')!;
    expect(leads.querySelector('[data-funnel-stage-amount]')).toHaveTextContent(formatCurrencyAuto(exactValue, 'USD'));
  });

  it('AC-SALES-S02: missing stage evidence is unavailable while a confirmed empty stage remains zero', async () => {
    pipelineState.data = {
      stages: seedStages.filter((stage) => stage.status !== 'Leads'),
      projects: [{ ...seedProjects[0], status: 'Leads' }],
    };
    renderPage();
    await userEvent.click(screen.getByText('Pipeline summary'));
    const leads = within(screen.getByTestId('sales-summary')).getByText('Leads').closest('[data-funnel-stage]')!;
    expect(leads.querySelector('[aria-label="Summary unavailable"]')).not.toBeNull();
    const negotiation = within(screen.getByTestId('sales-summary')).getByText('Negotiation').closest('[data-funnel-stage]')!;
    expect(negotiation.querySelector('[data-funnel-stage-amount]')).toHaveTextContent('$0');
  });
});

describe('SalesPipeline phone stage list (AC-S24-001)', () => {
  it('keeps the URL working set, selected stage, compact rows, and Lost scope aligned', async () => {
    const user = userEvent.setup();
    lostState.data = [
      { id: 'lost-phone-1', name: 'Lost Deal Delta', client_name: 'Initech', status: 'Loss Tender', contract_value: 700000, currency: 'USD', win_probability: 0 },
      { id: 'declined-phone-1', name: 'Declined Deal Echo', client_name: 'Echo', status: 'Declined', contract_value: 300000, currency: 'USD', win_probability: 0 },
    ];
    viewport.isDesktop = false;
    renderPage('/sales?view=kanban&status=Tender%20Submitted');

    const phoneList = screen.getByTestId('sales-phone-stage-list');
    const selection = screen.getByRole('combobox', { name: 'Stage' });
    expect(selection).toHaveValue('Tender Submitted');
    expect(within(phoneList).getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(within(phoneList).queryByText('Regional Services')).toBeNull();
    expect(screen.getAllByRole('combobox', { name: 'Stage' })).toHaveLength(1);

    await user.selectOptions(selection, 'PQ Submitted');
    await waitFor(() => {
      const location = screen.getByTestId('location-probe');
      expect(new URLSearchParams(location.getAttribute('data-search') ?? '').get('status')).toBe('PQ Submitted');
      expect(within(screen.getByTestId('sales-phone-stage-list')).getByText('Regional Services')).toBeInTheDocument();
    });
    expect(within(screen.getByTestId('sales-phone-stage-list')).queryByText('Northwind ERP Rollout')).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Project scope' }), 'Lost');
    await waitFor(() => {
      const params = new URLSearchParams(screen.getByTestId('location-probe').getAttribute('data-search') ?? '');
      expect(params.get('scope')).toBe('Lost');
      expect(params.get('status')).toBeNull();
      expect(screen.getByText('Lost Deal Delta')).toBeInTheDocument();
    });
    expect(screen.getByText('Declined Deal Echo')).toBeInTheDocument();
    expect(screen.queryByText('Regional Services')).toBeNull();
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

  it('AC-SP-203: error renders an alert + Retry that calls refetch', async () => {
    pipelineState.isError = true; pipelineState.data = undefined;
    renderPage();
    expect(await findPageAnnouncement('alert', /Couldn't load the sales pipeline/i)).toHaveTextContent(/Couldn't load the sales pipeline/i);
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
  it('AC-SP-204: defaults to the Kanban view with the Tender stage column and its card count', () => {
    renderPage();
    const tender = screen.getByTestId('stage-Tender Submitted');
    expect(within(tender).getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(within(tender).getByText('3')).toBeInTheDocument();
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
    expect(screen.getByRole('columnheader', { name: 'Win %' })).toBeInTheDocument();
    expect(within(screen.getByText('Northwind ERP Rollout').closest('tr')!).getByText('50%')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('link', { name: 'Northwind ERP Rollout' }));
    const probe = screen.getByTestId('location-probe');
    await waitFor(() => expect(probe.dataset.pathname).toBe('/projects/p2'));
    const state = JSON.parse(probe.dataset.state ?? 'null') as Record<string, unknown>;
    expect(state.pmoListReturn).toMatchObject({ list: 'sales' });
  });

  it('AC-IXD-PROJ-001 / AC-LRC-004: a table row click navigates to the canonical /projects/:id detail route, carrying Sales return context', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /Table/i }));
    fireEvent.click(screen.getByRole('link', { name: 'Northwind ERP Rollout' }));
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
    // The URL-driven scope and presentation are preserved.
    expect(screen.getByRole('combobox', { name: 'Project scope' })).toHaveValue('Lost');
    // The URL-driven search is present in the search box.
    expect(screen.getByLabelText(/Search projects/i)).toHaveValue('Coastal');
    // The URL-driven view renders the table.
    expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
  });

  it('AC-LRC-001: a control change writes ONE replace of the list URL (no history entry per click)', async () => {
    renderPage('/sales?view=table');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project scope' }), 'Lost');
    expect(new URLSearchParams(screen.getByTestId('location-probe').dataset.search ?? '').get('scope')).toBe('Lost');
    await userEvent.click(screen.getByRole('tab', { name: /^Board$/i }));
    expect(new URLSearchParams(screen.getByTestId('location-probe').dataset.search ?? '').get('scope')).toBe('Lost');
    expect(screen.getByRole('combobox', { name: 'Project scope' })).toHaveValue('Lost');
  });
});

describe('SalesPipeline recomposed working set — AC-SALES-C01', () => {
  it('AC-SALES-C01: Stage narrows the visible rows and choosing a stage returns to Open', async () => {
    const user = userEvent.setup();
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, currency: 'USD', win_probability: 0 },
    ];
    renderPage('/sales?scope=Lost&sort=activity-newest');

    const scope = screen.getByRole('combobox', { name: 'Project scope' });
    expect(scope).toHaveValue('Lost');
    const stage = screen.getByRole('combobox', { name: 'Stage' });
    expect(stage).toBeDisabled();
    expect(screen.getByText(/Stage applies to open projects/i)).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^Table$/i }));
    expect(scope).toHaveValue('Lost');
    expect(screen.getByText('Coastal Depot Bid')).toBeInTheDocument();
    expect(screen.queryByText('Northwind ERP Rollout')).not.toBeInTheDocument();

    await user.selectOptions(scope, 'Needs attention');
    await user.selectOptions(stage, 'PQ Submitted');
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Project scope' })).toHaveValue('Open');
      expect(screen.getByText('Regional Services')).toBeInTheDocument();
      expect(screen.queryByText('Northwind ERP Rollout')).not.toBeInTheDocument();
      const params = new URLSearchParams(screen.getByTestId('location-probe').dataset.search ?? '');
      expect(params.get('scope')).toBeNull();
      expect(params.get('status')).toBe('PQ Submitted');
      expect(params.get('sort')).toBe('activity-newest');
    });
  });

  it('AC-SALES-C03: sorts unavailable activity first and preserves the choice in the URL', async () => {
    const user = userEvent.setup();
    pipelineState.data = {
      stages: seedStages,
      projects: [
        { ...seedProjects[0], id: 'newer', name: 'Newest record', last_update: '2026-10-24T12:00:00.000Z' },
        { ...seedProjects[1], id: 'unknown', name: 'Unknown activity', last_update: undefined },
        { ...seedProjects[2], id: 'older', name: 'Oldest record', last_update: '2026-10-01T12:00:00.000Z' },
      ],
    };
    renderPage();
    await user.click(screen.getByRole('tab', { name: /^Table$/i }));
    const table = screen.getByRole('table', { name: 'Sales projects' });
    const names = within(table).getAllByRole('link', { name: /record|activity/i }).map((link) => link.textContent?.trim());
    expect(names).toEqual(['Unknown activity', 'Oldest record', 'Newest record']);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'activity-newest');
    await waitFor(() => {
      const sortedNames = within(screen.getByRole('table', { name: 'Sales projects' })).getAllByRole('link', { name: /record|activity/i }).map((link) => link.textContent?.trim());
      expect(sortedNames).toEqual(['Unknown activity', 'Newest record', 'Oldest record']);
      expect(new URLSearchParams(screen.getByTestId('location-probe').dataset.search ?? '').get('sort')).toBe('activity-newest');
    });
  });
});

describe('SalesPipeline preserves one scope across presentations — AC-SALES-C01', () => {
  it('switching Table (Lost) → Board keeps Lost selected and displays only terminal rows', async () => {
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, currency: 'USD', win_probability: 0 },
    ];
    renderPage('/sales?view=table&scope=Lost');
    expect(screen.getByRole('combobox', { name: 'Project scope' })).toHaveValue('Lost');

    await userEvent.click(screen.getByRole('tab', { name: /^Board$/i }));
    expect(screen.getByTestId('stage-Lost')).toBeInTheDocument();
    expect(screen.getByText('Coastal Depot Bid')).toBeInTheDocument();
    expect(screen.queryByText('Northwind ERP Rollout')).toBeNull();
    // The scope remains URL-owned on both presentations.
    const probe = screen.getByTestId('location-probe');
    expect(new URLSearchParams(probe.dataset.search).get('scope')).toBe('Lost');

    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    expect(screen.getByRole('combobox', { name: 'Project scope' })).toHaveValue('Lost');
    expect(screen.getByText('Coastal Depot Bid')).toBeInTheDocument();
  });

  it('a direct/copied `?view=kanban&scope=Lost` URL restores Lost scope in Board and Table', async () => {
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, currency: 'USD', win_probability: 0 },
    ];
    renderPage('/sales?view=kanban&scope=Lost');
    expect(screen.getByRole('tab', { name: /^Board$/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('combobox', { name: 'Project scope' })).toHaveValue('Lost');
    expect(screen.getByText('Coastal Depot Bid')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    expect(screen.getByRole('combobox', { name: 'Project scope' })).toHaveValue('Lost');
    expect(screen.queryByText('Northwind ERP Rollout')).toBeNull();
    expect(screen.getByText('Coastal Depot Bid')).toBeInTheDocument();
  });
});

describe('SalesPipeline — Lost deals in the Pipeline (AC-IXD-PROJ-007)', () => {
  it('AC-IXD-PROJ-007: a lost deal appears in the terminal "Lost" kanban column', () => {
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, currency: 'USD', win_probability: 0 },
    ];
    renderPage('/sales?scope=Lost');
    const lostColumn = screen.getByTestId('stage-Lost');
    expect(within(lostColumn).getByText('Coastal Depot Bid')).toBeInTheDocument();
  });

  it('AC-IXD-PROJ-007: the "Lost" table filter scopes the table to lost deals', async () => {
    lostState.data = [
      { id: 'pl', name: 'Coastal Depot Bid', client_name: 'Coastal', status: 'Loss Tender', contract_value: 950000, currency: 'USD', win_probability: 0 },
    ];
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project scope' }), 'Lost');
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
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project scope' }), 'Lost');
    expect(screen.getByText('Coastal Depot Bid')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Search projects/i), 'no-such-deal');
    // Lost projects DO exist — the search excluded them, so the scope-empty copy would be false.
    expect(await screen.findByText(/No matching projects/i)).toBeInTheDocument();
    expect(screen.queryByText(/No lost projects/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Clear filters/i }));
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Project scope' })).toHaveValue('Open');
  });
});

it('AC-SALES-E04: a lost-fetch failure keeps stale open work visible in Needs attention and offers one scoped retry', () => {
  pipelineState.data = {
    stages: seedStages,
    projects: [{ ...seedProjects[0], last_update: '2026-09-01T12:00:00.000Z' }],
  };
  lostState.isError = true;
  lostState.data = [];
  renderPage('/sales?scope=Needs%20attention');
  expect(screen.getByText(/Lost-project evidence is unavailable/i).closest('[role="status"]')).toBeInTheDocument();
  expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
  expect(screen.queryByText(/No projects need attention/i)).toBeNull();
});

// The read-only summary no longer acts as a second stage control; the toolbar Stage filter owns
// the visible set in both desktop presentations and on phone.
describe('SalesPipeline unified Stage control — AC-SALES-C01', () => {
  it('choosing Tender filters the Board and Table to the same open records; All stages restores them', async () => {
    const user = userEvent.setup();
    renderPage();
    const stage = screen.getByRole('combobox', { name: 'Stage' });
    await user.selectOptions(stage, 'Tender Submitted');
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.queryByText('Regional Services')).toBeNull();
    expect(new URLSearchParams(screen.getByTestId('location-probe').dataset.search ?? '').get('status')).toBe('Tender Submitted');

    await user.click(screen.getByRole('tab', { name: /^Table$/i }));
    expect(screen.getByRole('combobox', { name: 'Stage' })).toHaveValue('Tender Submitted');
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.queryByText('Regional Services')).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Stage' }), '');
    expect(screen.getByText('Regional Services')).toBeInTheDocument();
  });

  it('a copied stage URL restores the same subset and starts in Open scope', () => {
    renderPage('/sales?view=kanban&status=Tender%20Submitted');
    expect(screen.getByRole('combobox', { name: 'Project scope' })).toHaveValue('Open');
    expect(screen.getByRole('combobox', { name: 'Stage' })).toHaveValue('Tender Submitted');
    expect(screen.getByText('Northwind ERP Rollout')).toBeInTheDocument();
    expect(screen.queryByText('Regional Services')).toBeNull();
  });
});

it.each(['table', 'kanban'])('AC-TAG-002 Sales %s filters the actual visible deals by classification', async (view) => {
  pipelineState.data = { stages: seedStages, projects: seedProjects.map((p, i) => ({ ...p, service_line: i === 0 ? 'Engineering' : 'Advisory', sector: 'Energy', location: 'West Java', award_type: 'tender', bidding_entity: 'alone' })) };
  const user = userEvent.setup(); renderPage(`/sales?view=${view}`);
  await user.click(screen.getByRole('button', { name: /^Classification$/ }));
  await user.selectOptions(screen.getByLabelText('Filter by service line'), 'Engineering');
  expect(screen.getByText('Northwind ERP Rollout')).toBeVisible();
  expect(screen.queryByText('Regional Services')).toBeNull();
  await user.type(screen.getByLabelText('Filter by location'), 'Bali');
  // #830: the location filter writes the URL after a short pause, not on every keystroke.
  await waitFor(() => expect(screen.queryByText('Northwind ERP Rollout')).toBeNull());
  expect(screen.getByTestId('location-probe').getAttribute('data-search')).toContain('location=Bali');
  if (view === 'kanban') expect(screen.getByText('No matching projects')).toBeVisible();
});

describe('#830 location filter debounce', () => {
  const rowsWithClassification = () => seedProjects.map((p, i) => ({ ...p, service_line: i === 0 ? 'Engineering' : 'Advisory', sector: 'Energy', location: 'West Java', award_type: 'tender', bidding_entity: 'alone' }));
  const probeSearch = () => screen.getByTestId('location-probe').getAttribute('data-search') ?? '';

  it('AC-TAG-002 typing a location writes the URL only after the 300ms pause', async () => {
    pipelineState.data = { stages: seedStages, projects: rowsWithClassification() };
    vi.useFakeTimers();
    try {
      renderPage('/sales?view=table');
      fireEvent.click(screen.getByRole('button', { name: /^Classification$/ }));
      fireEvent.change(screen.getByLabelText('Filter by location'), { target: { value: 'Bali' } });
      expect(probeSearch()).not.toContain('location=');
      await act(async () => { await vi.advanceTimersByTimeAsync(299); });
      expect(probeSearch()).not.toContain('location=');
      await act(async () => { await vi.advanceTimersByTimeAsync(2); });
      expect(probeSearch()).toContain('location=Bali');
    } finally { vi.useRealTimers(); }
  });

  it('AC-TAG-002 changing award type during the location pause preserves both URL filters', async () => {
    pipelineState.data = { stages: seedStages, projects: rowsWithClassification() };
    vi.useFakeTimers();
    try {
      renderPage('/sales?view=table');
      fireEvent.click(screen.getByRole('button', { name: /^Classification$/ }));
      fireEvent.change(screen.getByLabelText('Filter by location'), { target: { value: 'Bali' } });
      fireEvent.change(screen.getByLabelText('Filter by award type'), { target: { value: 'tender' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(screen.getByLabelText('Filter by location')).toHaveValue('Bali');
      expect(probeSearch()).toContain('location=Bali');
      expect(probeSearch()).toContain('awardType=tender');
    } finally { vi.useRealTimers(); }
  });

  it('AC-TAG-002 changing award type before typing location preserves both URL filters', async () => {
    pipelineState.data = { stages: seedStages, projects: rowsWithClassification() };
    vi.useFakeTimers();
    try {
      renderPage('/sales?view=table');
      fireEvent.click(screen.getByRole('button', { name: /^Classification$/ }));
      fireEvent.change(screen.getByLabelText('Filter by award type'), { target: { value: 'tender' } });
      fireEvent.change(screen.getByLabelText('Filter by location'), { target: { value: 'Bali' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(screen.getByLabelText('Filter by location')).toHaveValue('Bali');
      expect(probeSearch()).toContain('location=Bali');
      expect(probeSearch()).toContain('awardType=tender');
    } finally { vi.useRealTimers(); }
  });

  it('AC-TAG-002 removing the location chip empties the location box', async () => {
    pipelineState.data = { stages: seedStages, projects: rowsWithClassification() };
    renderPage('/sales?view=table&location=Bali');
    fireEvent.click(screen.getByRole('button', { name: /^Classification\s*1/ }));
    expect(screen.getByLabelText('Filter by location')).toHaveValue('Bali');
    fireEvent.click(screen.getByRole('button', { name: /Remove classification: Location: Bali/ }));
    expect(probeSearch()).not.toContain('location=');
    expect(screen.getByLabelText('Filter by location')).toHaveValue('');
  });

  it('AC-TAG-002 Clear filters within the pause cancels the pending location', async () => {
    pipelineState.data = { stages: seedStages, projects: rowsWithClassification() };
    vi.useFakeTimers();
    try {
      renderPage('/sales?view=table&serviceLine=Engineering');
      fireEvent.click(screen.getByRole('button', { name: /^Classification\s*1/ }));
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

// SUB-H (owner 2026-10-20 simplification): fewer elements on the Sales pipeline, same facts.
describe('SalesPipeline subtraction (SUB-H)', () => {
  const taxed = (p: (typeof seedProjects)[number]) => ({
    ...p, tax_treatment: 'exclusive', tax_rate: 11, tax_base_numerator: 1, tax_base_denominator: 1,
  });

  it('SUB-H shows one count per open stage group and omits a repeated weighted forecast on cards', () => {
    renderPage();
    const tender = screen.getByTestId('stage-Tender Submitted');
    expect(within(tender).queryByText(/wtd/)).toBeNull();
    expect(within(tender).getByText('3')).toBeInTheDocument();
  });

  it('SUB-H table value shows the PPN basis without the rate or DPP', async () => {
    pipelineState.data = { stages: seedStages, projects: seedProjects.map(taxed) } as never;
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    const row = screen.getByText('Northwind ERP Rollout').closest('tr')!;
    const r = within(row as HTMLElement);
    expect(r.getByText(/excl\. PPN/i)).toBeInTheDocument();
    expect(r.queryByText(/11%/)).toBeNull();
  });

  it('SUB-H phone: no Board/Table toggle; Export is in More actions and the vertical row carries probability', async () => {
    viewport.isDesktop = false;
    renderPage('/sales?view=kanban');
    expect(screen.queryByRole('tablist', { name: /Pipeline view/i })).toBeNull();
    expect(screen.getByText('More actions')).toBeInTheDocument();
    await userEvent.click(screen.getByText('More actions'));
    expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument();
    const list = screen.getByTestId('sales-phone-stage-list');
    expect(within(list).queryByText('Financial and project details')).toBeNull();
    const card = within(list).getByText('Northwind ERP Rollout').closest('li')!;
    expect(within(card as HTMLElement).getByText('50%')).toBeVisible();
  });

  it('SUB-H phone: a table-view URL still shows the card list (no toggle to get stuck behind)', () => {
    viewport.isDesktop = false;
    renderPage('/sales?view=table');
    expect(screen.getByTestId('sales-phone-stage-list')).toBeInTheDocument();
  });

  it('SUB-H phone: the Lost scope lists lost deals as cards, still with no view toggle', async () => {
    lostState.data = [{ id: 'l1', name: 'Lost Deal Delta', client_name: 'Initech', status: 'Loss Tender', contract_value: 700000, currency: 'USD', win_probability: 0 }];
    viewport.isDesktop = false;
    renderPage('/sales?view=kanban');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project scope' }), 'Lost');
    expect(await screen.findByText('Lost Deal Delta')).toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: /Pipeline view/i })).toBeNull();
  });
});

describe('SalesPipeline funnel truth and table stage names (RD-S5)', () => {
  const stageCell = (name: string) => {
    const funnel = screen.getByTestId('sales-summary');
    return within(funnel).getByText(name, { exact: true }).closest('[data-funnel-stage]') as HTMLElement;
  };

  const openSummary = async () => {
    const details = screen.getByTestId('sales-summary');
    if (!details.hasAttribute('open')) await userEvent.click(screen.getByText('Pipeline summary'));
  };

  it('AC-RD-SALES-002 a stage holding two currencies shows an unavailable value, never a sum', async () => {
    renderPage(); // Tender holds USD + IDR deals
    await openSummary();
    const tender = stageCell('Tender');
    const amount = tender.querySelector('[data-funnel-stage-amount]') as HTMLElement;
    expect(amount).toHaveTextContent('—');
    expect(amount.textContent).not.toContain('1,200,000');
    expect(amount.querySelector('[aria-label="Summary unavailable"]')).not.toBeNull();
    expect(screen.getByTestId('sales-summary')).toHaveTextContent(/Some stage totals are unavailable or span mixed currencies/i);
  });

  it('AC-RD-SALES-002 a one-currency stage still shows its total in that currency', async () => {
    renderPage();
    await openSummary();
    const preQual = stageCell('Pre-Qual');
    expect(within(preQual).getByText(formatCurrencyAuto(800000, 'USD'))).toBeInTheDocument();
  });

  it('AC-RD-SALES-002 the summary never adds stage values into a mixed-currency total', async () => {
    renderPage();
    await openSummary();
    expect(screen.getByTestId('pipeline-weighted-total')).toHaveTextContent('Not available');
    expect(within(screen.getByTestId('sales-summary')).getByRole('link', { name: 'Review project records' })).toBeInTheDocument();
  });

  it('AC-RD-SALES-002 a one-currency pipeline denominates stages in that currency, not the org default', async () => {
    pipelineState.data = {
      stages: seedStages,
      projects: seedProjects.filter((p) => p.id === 'idr1').map((p) => ({ ...p, status: 'PQ Submitted' })),
    };
    renderPage();
    await openSummary();
    const amount = stageCell('Pre-Qual').querySelector('[data-funnel-stage-amount]') as HTMLElement;
    expect(amount.textContent).toContain('IDR');
    expect(amount.textContent).not.toContain('$');
  });

  it('AC-RD-SALES-001 the table Stage column uses the board titles (Pre-Qual, not "PQ Submitted")', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    const row = screen.getByText('Regional Services').closest('tr') as HTMLElement;
    expect(within(row).getByText('Pre-Qual')).toBeInTheDocument();
    expect(within(row).queryByText('PQ Submitted')).toBeNull();
    const tenderRow = screen.getByText('Northwind ERP Rollout').closest('tr') as HTMLElement;
    expect(within(tenderRow).getByText('Tender')).toBeInTheDocument();
  });

  it('AC-RD-SALES-002 summary stages are read-only and no longer provide a competing filter', async () => {
    pipelineState.data = { stages: seedStages, projects: seedProjects.filter((p) => p.currency === 'USD') };
    renderPage('/sales?status=Tender%20Submitted');
    await openSummary();
    expect(within(screen.getByTestId('sales-summary')).queryByRole('button')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Stage' })).toHaveValue('Tender Submitted');
  });
});

describe('SalesPipeline table on the shared contract (T4)', () => {
  it('T4 project identity is a direct canonical link and remains the primary column', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    expect(screen.getByRole('link', { name: 'Northwind ERP Rollout' })).toHaveAttribute('href', '/projects/p2');
    expect(screen.getByRole('columnheader', { name: 'Project' })).toBeInTheDocument();
  });

  it('T4 a deal with no numbers or codes has no empty second line', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    const row = screen.getByText('Regional Services').closest('tr') as HTMLElement;
    expect(row.querySelector('.font-mono')).toBeNull();
  });

  it('T4 amounts are full figures, never compacted', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Table$/i }));
    const row = screen.getByText('Northwind ERP Rollout').closest('tr') as HTMLElement;
    expect(within(row).getByText(formatCurrencyAuto(1200000, 'USD'))).toBeInTheDocument();
  });
});
