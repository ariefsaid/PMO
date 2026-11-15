/**
 * AC-IXD-PROC-W5-2 — DecisionSupportPanel
 *
 * Tests verify REAL rendered behavior:
 *  - Renders 4 labelled figures from budget + COMMITTED spend (OD-W5-4) + total_value
 *  - Renders nothing when project_id is absent
 *  - Over-budget shows a non-blocking advisory (role="status") with dollar amount
 *    (text-not-color-only a11y)
 *  - Loading state shows skeleton rows (either source pending), rest not blocked
 *  - Budget/committed error / no active budget shows quiet fallback (never blocks)
 *  - "Budget impact" is a real heading (M3)
 *  - No uninformative progress bar (I1 — removed)
 *
 * Committed spend is sourced from useProjectCommittedSpend (Σ PO total_value in
 * Ordered..Paid) — the SAME basis the dashboards use — NOT the static projects.spent.
 * All token references use DESIGN.md names — no hardcoded hex.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { BahasaProvider } from '@/test/bahasa';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui';

// ---------------------------------------------------------------------------
// Mock useProjectBudget + useProjectCommittedSpend — controlled per-test
// ---------------------------------------------------------------------------
const budgetState = {
  data: undefined as number | undefined,
  isPending: false,
  isError: false,
};
const committedState = {
  data: undefined as number | undefined,
  otherCurrencies: [] as Array<{ currency: string; amount: number }>,
  isPending: false,
  isError: false,
};
const reservedState = {
  data: 0 as number | undefined,
  projectCurrency: 'USD' as string | null,
  budgetCurrency: 'USD' as string | null,
  otherCurrencies: [] as Array<{currency: string | null; amount: number}>,
  isPending: false,
  isError: false,
};

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => budgetState,
}));

const { committedArgs, reservedArgs } = vi.hoisted(() => ({ committedArgs: [] as unknown[], reservedArgs: [] as unknown[] }));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: (projectId: unknown) => { committedArgs.push(projectId); return committedState; },
  useProjectReservedSpend: (projectId: unknown) => { reservedArgs.push(projectId); return reservedState; },
}));

// The canonical Budget used reading (S03/S04): the panel reads it through the same hook the project header uses.
const positionState = {
  reading: undefined as CanonicalBudgetReading | undefined,
  isPending: false,
  isError: false,
};
const positionArgs: string[][] = [];
vi.mock('@/src/hooks/useProjectBudgetPositions', () => ({
  useProjectBudgetPositions: (ids: string[]) => {
    positionArgs.push(ids);
    return {
      data: positionState.reading ? Object.fromEntries(ids.map((id) => [id, positionState.reading])) : undefined,
      isPending: positionState.isPending,
      isError: positionState.isError,
    };
  },
}));

import { DecisionSupportPanel } from './DecisionSupportPanel';
import type { CanonicalBudgetReading } from '@/src/lib/db/projectMoney';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/** The viewer's real role; the panel's figures are project-wide, so the role decides whether it shows. */
let viewerRole: Role = 'Project Manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// `status` defaults to 'Requested' (a panel-visible status) so the pre-existing
// AC-IXD-PROC-W5-2 tests stay visible without restating it; AC-RB tests pass an
// explicit status to exercise the per-stage math / visibility boundary.
function renderPanel(
  props: Omit<React.ComponentProps<typeof DecisionSupportPanel>, 'status' | 'currency'> &
    Partial<Pick<React.ComponentProps<typeof DecisionSupportPanel>, 'status' | 'currency'>>,
  locale?: 'id',
  withFigureScope = false,
) {
  const panel = <DecisionSupportPanel status="Requested" currency="USD" {...props} />;
  const content = (
    <ImpersonationProvider realRole={viewerRole}>
      <MemoryRouter>
        {withFigureScope ? <FigureScope><FigureHiddenLine />{panel}</FigureScope> : panel}
      </MemoryRouter>
    </ImpersonationProvider>
  );
  return render(locale === 'id' ? <BahasaProvider locale="id">{content}</BahasaProvider> : content);
}

/** The value element of the stat tile whose label matches `label` (exact, case-insensitive). */
function tileValue(label: RegExp): HTMLElement {
  const labelEl = screen.getByText(label);
  const tile = labelEl.closest('[data-testid="stat-tile"]') as HTMLElement;
  // The value is the sibling div after the label div within the tile.
  return within(tile).getByText(/\$/);
}

/** The plan's primary project: Active budget 1,000, recorded spending 500 (50% before tax), open orders 400. */
function reading(over: Partial<CanonicalBudgetReading> = {}): CanonicalBudgetReading {
  return {
    projectId: 'p1', ledgerBasis: 'pmo', currency: 'USD', budgetCurrency: 'USD', activeBudgetAmount: '1000.00',
    spent: '500.00', openCommitment: '400.00', consumption: '900.00', complete: true, usedRatio: '0.9', usedPercent: '90',
    consumptionVariance: '-100.00', riskEligible: true, atRisk: true, ...over,
  };
}

beforeEach(() => {
  committedState.otherCurrencies = [];
  budgetState.data = undefined;
  budgetState.isPending = false;
  budgetState.isError = false;
  committedState.data = 0;
  committedState.isPending = false;
  committedState.isError = false;
  reservedState.data = 0;
  reservedState.projectCurrency = 'USD';
  reservedState.budgetCurrency = 'USD';
  reservedState.otherCurrencies = [];
  reservedState.isPending = false;
  reservedState.isError = false;
  viewerRole = 'Project Manager';
  positionState.reading = reading();
  positionState.isPending = false;
  positionState.isError = false;
  positionArgs.length = 0;
  committedArgs.length = 0;
  reservedArgs.length = 0;
});

// ---------------------------------------------------------------------------
// AC-SEC-229: the panel sums every request on the project; a role that reads only the requests it
// raised (Engineer) would see a partial sum, so the panel is not shown and the reads are not issued.
// ---------------------------------------------------------------------------
describe('AC-SEC-229 — Engineer purchasing read scope', () => {
  it('renders nothing for an Engineer and issues no project-wide spend read', () => {
    viewerRole = 'Engineer';
    budgetState.data = 1200000;
    committedState.data = 300000;
    const { container } = renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(container.firstChild).toBeNull();
    expect(committedArgs.every((id) => id === null)).toBe(true);
    expect(reservedArgs.every((id) => id === null)).toBe(true);
  });

  it('#2107: an Ordered row issues no budget read for a panel that renders nothing', () => {
    viewerRole = 'Finance';
    committedArgs.length = 0;
    reservedArgs.length = 0;
    const { container } = renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out', status: 'Ordered' });
    expect(container.firstChild).toBeNull();
    expect(committedArgs.every((id) => id === null)).toBe(true);
    expect(reservedArgs.every((id) => id === null)).toBe(true);
  });

  it.each(['Admin', 'Executive', 'Project Manager', 'Finance'] as const)('still shows the budget impact to %s', (role) => {
    viewerRole = role;
    budgetState.data = 1200000;
    committedState.data = 300000;
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/budget impact/i)).toBeInTheDocument();
    expect(committedArgs).toContain('proj-1');
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2a: renders nothing when no project_id
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2a — no project_id', () => {
  it('renders nothing when project_id is null/undefined', () => {
    const { container } = renderPanel({ projectId: null, totalValue: 50000, projectName: null });
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when project_id is empty string', () => {
    const { container } = renderPanel({ projectId: '', totalValue: 50000, projectName: null });
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2b: loading state — skeleton rows, no figures yet
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2b — loading state', () => {
  it('shows skeleton rows while budget is pending', () => {
    budgetState.isPending = true;
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/budget impact/i)).toBeInTheDocument();
    expect(document.querySelectorAll('.skel').length).toBeGreaterThan(0);
    expect(screen.queryByText(/this procurement/i)).not.toBeInTheDocument();
  });

  it('shows skeleton rows while committed spend is pending (either source blocks)', () => {
    budgetState.data = 1200000;
    committedState.isPending = true;
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(document.querySelectorAll('.skel').length).toBeGreaterThan(0);
    expect(screen.queryByText(/this procurement/i)).not.toBeInTheDocument();
  });

  it('does not show the over-budget advisory while loading', () => {
    budgetState.isPending = true;
    renderPanel({ projectId: 'proj-1', totalValue: 9999999, projectName: null });
    expect(screen.queryByText(/exceeds available budget/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2c: budget error / no active budget — quiet fallback
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2c — budget error / unavailable', () => {
  it('shows quiet "budget unavailable" message on budget error', () => {
    budgetState.isError = true;
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/budget unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/this procurement/i)).not.toBeInTheDocument();
  });

  it('shows quiet "budget unavailable" message on committed-spend error', () => {
    budgetState.data = 1200000;
    committedState.isError = true;
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/budget unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/this procurement/i)).not.toBeInTheDocument();
  });

  it('shows quiet fallback when budget is 0 (no active budget)', () => {
    budgetState.data = 0;
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'Project A' });
    expect(screen.getByText(/no active budget/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2d: four figures rendered, text-labelled, committed basis
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2d — four figures rendered (committed basis)', () => {
  beforeEach(() => {
    budgetState.data = 1200000;
    committedState.data = 986600; // committed spend (Σ PO Ordered..Paid)
  });

  it('renders "Procurement total" label with total_value formatted as currency', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    const labels = screen.getAllByText(/procurement total/i);
    expect(labels.length).toBeGreaterThan(0);
    expect(screen.getByText(/\$48,000/)).toBeInTheDocument();
  });

  it('AC-1438 shows the procurement term in Bahasa budget-impact labels', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' }, 'id');
    expect(screen.getByText('Total pengadaan')).toBeInTheDocument();
    expect(screen.getByText('Setelah pengadaan ini')).toBeInTheDocument();
  });

  it('rule 15 + Bahasa: a 1,000,000 budget stays on one line and every label is Bahasa', () => {
    budgetState.data = 1_000_000;
    committedState.data = 0;
    renderPanel({ projectId: 'proj-1', totalValue: 22_500, projectName: 'HQ Fit-Out' }, 'id');
    const budgetTile = screen.getByText('Anggaran proyek').closest('[data-testid="stat-tile"]') as HTMLElement;
    expect(within(budgetTile).getByText(/1,000,000/).closest('.whitespace-nowrap')).not.toBeNull();
    expect(screen.getByText('Dicadangkan')).toBeInTheDocument();
    expect(screen.getByText('Disetujui, belum dipesan')).toBeInTheDocument();
    expect(screen.queryByText('Reserved')).not.toBeInTheDocument();
    expect(screen.queryByText('Project budget')).not.toBeInTheDocument();
  });

  it('rule 15: a budget too wide for half a phone row takes the whole row, label above, number unbroken', () => {
    budgetState.data = 1_240_000_000;
    committedState.data = 0;
    renderPanel({ projectId: 'proj-1', totalValue: 22_500, projectName: 'HQ Fit-Out' }, 'id');
    const budgetTile = screen.getByText('Anggaran proyek').closest('[data-testid="stat-tile"]') as HTMLElement;
    expect(budgetTile.className).toContain('col-span-2');
    expect(within(budgetTile).getByText(/1,240,000,000/).closest('.whitespace-nowrap')).not.toBeNull();
  });

  it('AC-RD-MONEY-002: approval money is the exact full amount, never a short unit (OD-MONEY-FMT: KPI cards only)', () => {
    budgetState.data = 1_240_000_000;
    committedState.data = 0;
    renderPanel({ projectId: 'proj-1', totalValue: 56_000, projectName: null });
    expect(screen.getByText('$56,000')).toBeInTheDocument();
    expect(screen.getAllByText('$1,240,000,000').length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$\d+(\.\d)?[KMB]\b/)).not.toBeInTheDocument();
  });

  it('renders "Available" label (budget − committed − reserved; reserved=0 here)', () => {
    // budget=1,200,000; committed=986,600; reserved=0 → available=213,400
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/^not yet committed to purchases$/i)).toBeInTheDocument();
    expect(screen.getByText(/\$213,400/)).toBeInTheDocument();
  });

  it('renders "Project budget" label with the budget figure', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/project budget/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1,200,000/)).toBeInTheDocument();
  });

  it('renders "After this procurement" label with available−totalValue + percent (Requested)', () => {
    // available=213,400; totalValue=48,000 → after=165,400; % = 165400/1200000 ≈ 13.8%
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/after this procurement/i)).toBeInTheDocument();
    expect(screen.getByText(/\$165,400/)).toBeInTheDocument();
    expect(screen.getByText(/14% headroom left/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2e: over-budget advisory (non-blocking, role="status", text)
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2e — over-budget advisory', () => {
  beforeEach(() => {
    budgetState.data = 1200000;
  });

  it('shows a non-blocking advisory with exact dollar overage when procurement exceeds available', () => {
    // committed=1,100,000; reserved=0 → available=100,000; totalValue=120,000 → over by $20,000
    committedState.data = 1100000;
    renderPanel({ projectId: 'proj-1', totalValue: 120000, projectName: 'HQ Fit-Out' });
    // Non-blocking advisory: role="status", NOT role="alert"
    const advisory = screen.getByRole('status');
    expect(advisory.textContent).toMatch(/this procurement exceeds available budget/i);
    expect(advisory.textContent).toMatch(/exceeds available budget/i);
    expect(advisory.textContent).toMatch(/\$20,000/);
    expect(advisory.textContent).toMatch(/advisory only/i);
    // It must NOT be an assertive alert (gentler for a non-blocking advisory — M4)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does NOT show advisory when within budget', () => {
    committedState.data = 986600; // available=213,400; totalValue=48,000 → within
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.queryByText(/exceeds available budget/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2f: "Budget impact" is a real heading (M3); no uninformative bar (I1)
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2f — heading + no progress bar', () => {
  beforeEach(() => {
    budgetState.data = 1200000;
    committedState.data = 0;
  });

  it('renders "Budget impact" as a real heading element', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByRole('heading', { name: /budget impact/i })).toBeInTheDocument();
  });

  it('renders the six budget figures in a six-column strip at sm+ so no empty cell appears', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    const tiles = within(screen.getByTestId('stat-tiles')).getAllByTestId('stat-tile');
    expect(tiles).toHaveLength(6);
    for (const tile of tiles) expect(tile).not.toBeEmptyDOMElement();
  });

  it('2057: ONE budget-impact bar states the used share after this procurement and the budget it is measured against', () => {
    budgetState.data = 1000;
    committedState.data = 300;
    reservedState.data = 200;
    renderPanel({ projectId: 'proj-1', totalValue: 100, projectName: 'HQ Fit-Out', status: 'Requested' });
    const bar = screen.getByRole('progressbar');
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    // budget 1000, committed 300 + reserved 200 + this 100 = 600 used → 60%.
    expect(bar).toHaveAttribute('aria-valuenow', '60');
    expect(bar.getAttribute('aria-label')).toMatch(/60%/);
    expect(bar.getAttribute('aria-label')).toMatch(/\$1,000/);
    expect(screen.getByText(/Budget in use with this purchase: 60%/)).toBeInTheDocument();
    // The figure behind the bar: 1000 − 300 − 200 − 100 left after this procurement.
    expect(tileValue(/^after this procurement$/i).textContent).toMatch(/\$400\b/);
  });

  it('uses one whole-percent rounding rule so budget use and headroom total 100%', () => {
    budgetState.data = 1000;
    committedState.data = 300;
    reservedState.data = 200;
    renderPanel({ projectId: 'proj-1', totalValue: 179, projectName: 'HQ Fit-Out', status: 'Requested' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '68');
    expect(screen.getByText('Budget in use with this purchase: 68%')).toBeInTheDocument();
    const tile = screen.getByText(/^after this procurement$/i).closest('[data-testid="stat-tile"]');
    expect(tile).not.toBeNull();
    expect(within(tile as HTMLElement).getByText('32% headroom left')).toBeInTheDocument();
  });

  it('2057: past the budget the bar is full and carries the destructive tone', () => {
    budgetState.data = 1000;
    committedState.data = 900;
    reservedState.data = 0;
    renderPanel({ projectId: 'proj-1', totalValue: 300, projectName: 'HQ Fit-Out', status: 'Requested' });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar.querySelector('.bg-destructive')).not.toBeNull();
  });
});

describe('DecisionSupportPanel unavailable comparisons', () => {
  it('reports a currency mismatch to the shared hidden-figure line', async () => {
    budgetState.data = 1200000;
    committedState.data = 0;
    reservedState.projectCurrency = 'IDR';
    reservedState.budgetCurrency = 'USD';

    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' }, undefined, true);

    expect(await screen.findByTestId('figures-hidden')).toHaveTextContent('Budget comparison unavailable for these currencies.');
    expect(screen.queryByText('Budget comparison unavailable for these currencies.', { exact: true })).not.toBeInTheDocument();
  });

  it('reports unrepresentable amounts to the shared hidden-figure line', async () => {
    budgetState.data = 1200000;
    committedState.data = 0;

    renderPanel({ projectId: 'proj-1', totalValue: Number.NaN, projectName: 'HQ Fit-Out' }, undefined, true);

    expect(await screen.findByTestId('figures-hidden')).toHaveTextContent('Budget comparison unavailable for these amounts.');
    expect(screen.queryByText('Budget comparison unavailable for these amounts.', { exact: true })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2g: project name shown in panel heading
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2g — project name in heading', () => {
  it('renders project name in the panel heading when provided', () => {
    budgetState.data = 500000;
    committedState.data = 0;
    renderPanel({ projectId: 'proj-1', totalValue: 10000, projectName: 'Northwind ERP Rollout' });
    expect(screen.getByText(/Northwind ERP Rollout/)).toBeInTheDocument();
  });
});

// ===========================================================================
// Reserved budget layer (ADR-0034) — AC-RB-004..014
// ===========================================================================

describe('AC-RB-004 — Available = Budget − Committed − Reserved', () => {
  it('R2-P1b #12 labels headroom before actual spend as not yet committed', () => {
    budgetState.data = 1000;
    committedState.data = 300;
    reservedState.data = 200;
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });

    const label = screen.getByText('Not yet committed to purchases');
    const tile = label.closest('[data-testid="stat-tile"]') as HTMLElement;
    expect(within(tile).getByText(/\$500\b/)).toBeInTheDocument();
    expect(within(tile).getByText('Not counting recorded spending')).toBeInTheDocument();
  });

  it('AC-RB-004: shows Available $500 for budget 1000 / committed 300 / reserved 200', () => {
    budgetState.data = 1000;
    committedState.data = 300;
    reservedState.data = 200;
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/^not yet committed to purchases$/i)).toBeInTheDocument();
    // Scope to the Available tile (After this request also shows $500 here).
    expect(tileValue(/^not yet committed to purchases$/i).textContent).toMatch(/\$500\b/);
  });
  it('0373: commitments in other currencies are named under Available, never subtracted as project currency', () => {
    budgetState.data = 1000;
    committedState.data = 300;
    committedState.otherCurrencies = [{ currency: 'EUR', amount: 90 }];
    reservedState.data = 200;
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });
    expect(tileValue(/^not yet committed to purchases$/i).textContent).toMatch(/\$500\b/);
    expect(screen.getByText('Not counting commitments in other currencies: €90')).toBeInTheDocument();
  });
  it('0373: no other-currency note when every commitment is in the project currency', () => {
    budgetState.data = 1000;
    committedState.data = 300;
    reservedState.data = 200;
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });
    expect(screen.queryByText(/other currencies/)).not.toBeInTheDocument();
  });
  it('AC-RB-004: Available tile uses neg tone when negative', () => {
    budgetState.data = 1000;
    committedState.data = 800;
    reservedState.data = 400; // available = -200
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });
    const neg = tileValue(/^not yet committed to purchases$/i);
    expect(neg.textContent).toMatch(/-?\$200/);
    expect(neg.className).toMatch(/destructive/);
  });

  it('FR-L10N-020: every figure renders in the passed-in currency, not USD', () => {
    budgetState.data = 1000;
    committedState.data = 300;
    reservedState.data = 200;
    reservedState.projectCurrency = 'EUR';
    reservedState.budgetCurrency = 'EUR';
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested', currency: 'EUR' });
    const availableLabel = screen.getByText(/^not yet committed to purchases$/i);
    const availableTile = availableLabel.closest('[data-testid="stat-tile"]') as HTMLElement;
    expect(within(availableTile).getByText(/€500\b/)).toBeInTheDocument();
    expect(within(availableTile).queryByText(/\$/)).not.toBeInTheDocument();
  });
});

describe('AC-RB-005 — Reserved tile shows other-reserved, never "encumbered"', () => {
  it('AC-RB-005: total reserved 200, this case 50 (Approved) → tile shows $150', () => {
    budgetState.data = 1000;
    committedState.data = 0;
    reservedState.data = 200;
    const { container } = renderPanel({
      projectId: 'p1',
      totalValue: 50,
      projectName: 'X',
      status: 'Approved',
    });
    expect(screen.getByText(/^reserved$/i)).toBeInTheDocument();
    expect(screen.getByText(/\$150\b/)).toBeInTheDocument();
    expect(screen.getByText(/approved, not yet ordered/i)).toBeInTheDocument();
    expect(container.textContent?.toLowerCase()).not.toMatch(/encumber/);
  });
});

describe('AC-RB-006 — After = Available − thisRequest at Requested', () => {
  it('AC-RB-006: available 500 (budget 700, committed 100, reserved 100), thisRequest 120 → After $380', () => {
    budgetState.data = 700;
    committedState.data = 100;
    reservedState.data = 100;
    renderPanel({ projectId: 'p1', totalValue: 120, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/after this procurement/i)).toBeInTheDocument();
    expect(screen.getByText(/\$380\b/)).toBeInTheDocument();
  });
});

describe('AC-RB-007 — After = Available at Approved (no double-subtract)', () => {
  it('AC-RB-007: this case 120 already in reserved → After equals Available $500, NOT $380', () => {
    budgetState.data = 700;
    committedState.data = 100;
    reservedState.data = 100; // available = 500
    renderPanel({ projectId: 'p1', totalValue: 120, projectName: 'X', status: 'Approved' });
    // After this request == Available ($500) — thisRequest (120) is NOT subtracted again.
    expect(tileValue(/after this procurement/i).textContent).toMatch(/\$500\b/);
    // The naïve "always subtract thisRequest" answer ($380) must NOT appear anywhere.
    expect(screen.queryByText(/\$380\b/)).not.toBeInTheDocument();
  });
});

describe('AC-RB-008 — panel visible Draft..Quote Selected', () => {
  it.each(['Draft', 'Requested', 'Approved', 'Vendor Quoted', 'Quote Selected'] as const)(
    'AC-RB-008: shows the Budget-impact card at status %s',
    (status) => {
      budgetState.data = 1000;
      committedState.data = 0;
      reservedState.data = 0;
      renderPanel({ projectId: 'p1', totalValue: 10, projectName: 'X', status });
      expect(screen.getByRole('heading', { name: /budget impact/i })).toBeInTheDocument();
    },
  );
});

describe('AC-RB-009 — panel hidden Ordered..terminal', () => {
  it.each(['Ordered', 'Received', 'Vendor Invoiced', 'Paid', 'Rejected', 'Cancelled'] as const)(
    'AC-RB-009: renders nothing at status %s',
    (status) => {
      budgetState.data = 1000;
      committedState.data = 0;
      reservedState.data = 0;
      const { container } = renderPanel({
        projectId: 'p1',
        totalValue: 10,
        projectName: 'X',
        status,
      });
      expect(container.firstChild).toBeNull();
    },
  );
});

describe('AC-RB-010 — loading state (reserved read pending)', () => {
  it('AC-RB-010: shows skeleton, no tiles, when reserved read is pending', () => {
    budgetState.data = 1000;
    committedState.data = 0;
    reservedState.isPending = true;
    renderPanel({ projectId: 'p1', totalValue: 10, projectName: 'X', status: 'Requested' });
    expect(document.querySelectorAll('.skel').length).toBeGreaterThan(0);
    expect(screen.queryByText(/this procurement/i)).not.toBeInTheDocument();
  });
});

describe('AC-RB-011 — error state (reserved read error)', () => {
  it('AC-RB-011: shows "budget unavailable", no tiles, when reserved read errors', () => {
    budgetState.data = 1000;
    reservedState.isError = true;
    renderPanel({ projectId: 'p1', totalValue: 10, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/budget unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/this procurement/i)).not.toBeInTheDocument();
  });
});

describe('AC-RB-012 — no-budget state', () => {
  it('AC-RB-012: budget 0 shows "no active budget", no reserved/available figures', () => {
    budgetState.data = 0;
    reservedState.data = 500;
    renderPanel({ projectId: 'p1', totalValue: 10, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/no active budget/i)).toBeInTheDocument();
    expect(screen.queryByText(/^not yet committed to purchases$/i)).not.toBeInTheDocument();
  });
});

describe('AC-RB-013 — over-available advisory at Requested', () => {
  it('AC-RB-013: status Requested, available 100, thisRequest 250 → role=status advisory, over by $150, approval still permitted', () => {
    budgetState.data = 100;
    committedState.data = 0;
    reservedState.data = 0; // available = 100
    renderPanel({ projectId: 'p1', totalValue: 250, projectName: 'X', status: 'Requested' });
    const advisory = screen.getByRole('status');
    expect(advisory.textContent).toMatch(/exceeds available budget/i);
    expect(advisory.textContent).toMatch(/\$150\b/);
    expect(advisory.textContent).toMatch(/advisory only|still permitted/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('AC-RB-014 — already-reserved: no false advisory; over-budget info instead', () => {
  it('AC-RB-014: Approved with available >= 0 → no over-available advisory based on thisRequest', () => {
    budgetState.data = 1000;
    committedState.data = 0;
    reservedState.data = 200; // available 800 ≥ 0
    renderPanel({ projectId: 'p1', totalValue: 999, projectName: 'X', status: 'Approved' });
    expect(screen.queryByText(/exceeds available budget/i)).not.toBeInTheDocument();
  });
  it('AC-RB-014: Approved with available < 0 → over-budget advisory by |available|', () => {
    budgetState.data = 1000;
    committedState.data = 900;
    reservedState.data = 300; // available -200
    renderPanel({ projectId: 'p1', totalValue: 50, projectName: 'X', status: 'Approved' });
    const advisory = screen.getByRole('status');
    expect(advisory.textContent).toMatch(/over budget/i);
    expect(advisory.textContent).toMatch(/\$200\b/);
  });
});

describe('currency-aware budget position', () => {
  it('does not compare a foreign request with the project budget', () => {
    budgetState.data = 1000;
    committedState.data = 100;
    renderPanel({ projectId: 'proj-1', totalValue: 200, projectName: 'Project', currency: 'EUR' });
    expect(screen.getByText(/not compared with the budget/i)).toBeInTheDocument();
    expect(screen.queryByText(/headroom remaining/i)).not.toBeInTheDocument();
  });
});

  it('reports foreign reserved demand separately from project headroom', () => {
    budgetState.data = 1000;
    committedState.data = 100;
    reservedState.data = 200;
    reservedState.otherCurrencies = [{ currency: 'EUR', amount: 300 }];
    renderPanel({ projectId: 'proj-1', totalValue: 50, projectName: 'Project' });
    expect(screen.getByText(/\$700/)).toBeInTheDocument();
    expect(screen.getByText(/€300/)).toBeInTheDocument();
  });

  it('marks the comparison unavailable when a budget currency is missing', () => {
    budgetState.data = 1000;
    reservedState.budgetCurrency = null;
    renderPanel({ projectId: 'proj-1', totalValue: 50, projectName: 'Project' });
    expect(screen.getByText(/comparison unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/headroom remaining/i)).not.toBeInTheDocument();
  });

it('does not compare a budget in a different currency to project commitments', () => {
  budgetState.data = 1000;
  reservedState.budgetCurrency = 'EUR';
  renderPanel({ projectId: 'proj-1', totalValue: 50, projectName: 'Project' });
  expect(screen.getByText(/comparison unavailable/i)).toBeInTheDocument();
});

it('#1354 labels each figure in its own currency: the request in its currency, budget figures in the budget currency, no cross-currency After', () => {
  budgetState.data = 1000;
  committedState.data = 300;
  reservedState.data = 200;
  renderPanel({ projectId: 'proj-1', totalValue: 50, projectName: 'Project', currency: 'EUR' });
  const valueOf = (label: RegExp) => within(screen.getByText(label).closest('[data-testid="stat-tile"]') as HTMLElement);
  expect(valueOf(/^procurement total$/i).getByText(/€50\b/)).toBeInTheDocument();
  expect(valueOf(/^project budget$/i).getByText(/\$1,000\b/)).toBeInTheDocument();
  expect(valueOf(/^not yet committed to purchases$/i).getByText(/\$500\b/)).toBeInTheDocument();
  expect(valueOf(/^reserved$/i).getByText(/\$200\b/)).toBeInTheDocument();
  expect(screen.queryByText(/headroom remaining/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/over available budget/i)).not.toBeInTheDocument();
});

it('does not compare amounts when the project currency is missing', () => {
  budgetState.data = 1000;
  reservedState.projectCurrency = null;
  renderPanel({ projectId: 'proj-1', totalValue: 50, projectName: 'Project' });
  expect(screen.getByText(/comparison unavailable/i)).toBeInTheDocument();
});

it('marks an amount outside exact representation as unavailable', () => {
  budgetState.data = 100_000_000_000_000;
  renderPanel({ projectId: 'proj-1', totalValue: 50, projectName: 'Project' });
  expect(screen.getByText(/comparison unavailable/i)).toBeInTheDocument();
});


// ===========================================================================
// S05 — the approval panel names its figure, shows the project's Budget used beside it and the tender stage.
// Display only: the panel's own policy (budget − open orders − reserved) is unchanged.
// ===========================================================================
const tileOf = (label: RegExp) => screen.getByText(label).closest('[data-testid="stat-tile"]') as HTMLElement;

describe('S05 — purchasing figure is named for what it counts', () => {
  it('names the figure "Not yet committed to purchases" and says plainly that recorded spending is not in it', () => {
    budgetState.data = 1000;
    committedState.data = 400;
    reservedState.data = 50;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    const tile = tileOf(/^not yet committed to purchases$/i);
    expect(within(tile).getByText(/\$550\b/)).toBeInTheDocument();
    expect(within(tile).getByText('Not counting recorded spending')).toBeInTheDocument();
  });

  it('keeps the policy numbers: 525 after the request, 47.5% of the budget in use (shown as whole percent)', () => {
    budgetState.data = 1000;
    committedState.data = 400;
    reservedState.data = 50;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(within(tileOf(/^after this procurement$/i)).getByText(/\$525\b/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '48');
  });

  it('Bahasa: the figure and its sub-line are Indonesian', () => {
    budgetState.data = 1000;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' }, 'id');
    const tile = tileOf(/^belum terikat pembelian$/i);
    expect(within(tile).getByText('Belum termasuk pengeluaran tercatat')).toBeInTheDocument();
    expect(screen.queryByText('Not yet committed to purchases')).not.toBeInTheDocument();
  });
});

describe('S05 — the inbox row moves the purchasing figure\'s caption into its tooltip', () => {
  it('captionInTooltip: the label stays, the caption is a tooltip (and read by screen readers), not a line under the figure', () => {
    budgetState.data = 1000;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested', captionInTooltip: true }, 'id');
    const label = screen.getByText(/^belum terikat pembelian/i);
    const tile = label.closest('[data-testid="stat-tile"]') as HTMLElement;
    expect(label.closest('[title]')).toHaveAttribute('title', 'Belum termasuk pengeluaran tercatat');
    expect(tile.querySelectorAll('.text-muted-foreground')).toHaveLength(0);
  });
  it('the record page keeps the caption under the figure', () => {
    budgetState.data = 1000;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' }, 'id');
    expect(within(tileOf(/^belum terikat pembelian$/i)).getByText('Belum termasuk pengeluaran tercatat')).toBeInTheDocument();
  });
  it('a caption naming other currencies is money information and stays visible', () => {
    budgetState.data = 1000;
    committedState.otherCurrencies = [{ currency: 'EUR', amount: 5 }];
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested', captionInTooltip: true });
    expect(within(tileOf(/^not yet committed to purchases$/i)).getByText(/Not counting commitments in other currencies/)).toBeInTheDocument();
  });
});

describe('S05 — the project\'s Budget used sits beside it', () => {
  it('shows the canonical Budget used (recorded spending ÷ Active budget, before tax) right after the purchasing figure', () => {
    budgetState.data = 1000;
    committedState.data = 400;
    reservedState.data = 50;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    const labels = within(screen.getByTestId('stat-tiles')).getAllByTestId('stat-tile').map((tile) => tile.firstElementChild?.textContent);
    const at = labels.indexOf('Not yet committed to purchases');
    expect(labels[at + 1]).toBe('Budget used');
    const tile = tileOf(/^budget used$/i);
    expect(within(tile).getByText('50%')).toBeInTheDocument();
    expect(within(tile).getByText('Recorded spending, before tax')).toBeInTheDocument();
  });

  it('reads the project through the shared positions hook, with no sum of its own', () => {
    budgetState.data = 1000;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(positionArgs.at(-1)).toEqual(['p1']);
  });

  it('ERP basis: the ledger actual is the spending, so 300 of 1,000 reads 30%', () => {
    budgetState.data = 1000;
    positionState.reading = reading({ ledgerBasis: 'erp', spent: '300.00' });
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(within(tileOf(/^budget used$/i)).getByText('30%')).toBeInTheDocument();
  });

  it.each([
    ['spending unknown', { spent: null }],
    ['reading in another currency', { currency: 'EUR', budgetCurrency: 'EUR' }],
    ['no Active budget in the reading', { activeBudgetAmount: null }],
  ] as const)('%s → no Budget used tile, as the project header draws none', (_name, over) => {
    budgetState.data = 1000;
    positionState.reading = reading(over);
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(screen.queryByText(/^budget used$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown or unavailable/i)).not.toBeInTheDocument();
    // the purchasing figure is still drawn
    expect(within(tileOf(/^not yet committed to purchases$/i)).getByText(/\$1,000\b/)).toBeInTheDocument();
  });

  it.each(['Tender Submitted', 'PQ Submitted'])('a project still in the pipeline (%s): no Budget used tile and no hidden-figures line, not even on a failed read', async (projectStatus) => {
    budgetState.data = 1000;
    positionState.reading = undefined;
    positionState.isError = true;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', projectStatus, status: 'Requested' }, undefined, true);
    expect(await screen.findByText(/^project budget$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^budget used$/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown or unavailable/i)).not.toBeInTheDocument();
  });

  it('a running project whose read failed keeps a short unknown mark in the tile, never a sentence, and no hidden-figures line', async () => {
    budgetState.data = 1000;
    positionState.reading = undefined;
    positionState.isError = true;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', projectStatus: 'Active', status: 'Requested' }, undefined, true);
    const tile = tileOf(/^budget used$/i);
    expect(tile.textContent).toContain('—');
    expect(tile.querySelector('[role="status"]')).toBeNull();
    expect(screen.queryByTestId('figures-hidden')).not.toBeInTheDocument();
    expect(screen.getByText(/^project budget$/i)).toBeInTheDocument();
  });

  it('while the reading loads, no Budget used tile is drawn and the rest of the panel is not held back', () => {
    budgetState.data = 1000;
    positionState.reading = undefined;
    positionState.isPending = true;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(screen.queryByText(/^budget used$/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^project budget$/i)).toBeInTheDocument();
  });

  it('a request in another currency still shows the project figures including Budget used, with no after-request tile', () => {
    budgetState.data = 1000;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested', currency: 'EUR' });
    expect(within(tileOf(/^budget used$/i)).getByText('50%')).toBeInTheDocument();
    expect(screen.queryByText(/^after this procurement$/i)).not.toBeInTheDocument();
  });

  it('the no-budget and currency-mismatch refusals are unchanged and draw no Budget used', () => {
    budgetState.data = 0;
    const first = renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/no active budget/i)).toBeInTheDocument();
    expect(screen.queryByText(/^budget used$/i)).not.toBeInTheDocument();
    first.unmount();
    budgetState.data = 1000;
    reservedState.budgetCurrency = 'EUR';
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/comparison unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/^budget used$/i)).not.toBeInTheDocument();
  });

  it('Bahasa: Budget used reads in Indonesian', () => {
    budgetState.data = 1000;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' }, 'id');
    const tile = tileOf(/^anggaran terpakai$/i);
    expect(within(tile).getByText('50%')).toBeInTheDocument();
    expect(within(tile).getByText('Pengeluaran tercatat, sebelum pajak')).toBeInTheDocument();
  });

  it('issues no position read for a status the panel hides', () => {
    budgetState.data = 1000;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Ordered' });
    expect(positionArgs.every((ids) => ids.length === 0)).toBe(true);
  });
});

describe('S05 — the tender stage is visible where the decision is made', () => {
  const heading = () => screen.getByRole('heading', { name: /budget impact|dampak anggaran/i }).parentElement as HTMLElement;

  it.each(['Leads', 'PQ Submitted', 'Quotation Submitted', 'Tender Submitted', 'Negotiation'])(
    'a project still in the pipeline (%s) shows its stage beside the project name',
    (projectStatus) => {
      budgetState.data = 1000;
      renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', projectStatus, status: 'Requested' });
      const stage = projectStatus === 'Leads' ? 'Leads' : projectStatus === 'PQ Submitted' ? 'PQ submitted'
        : projectStatus === 'Quotation Submitted' ? 'Quotation submitted' : projectStatus === 'Tender Submitted' ? 'Tender submitted' : 'Negotiation';
      expect(within(heading()).getByText(stage)).toBeInTheDocument();
    },
  );

  it('the stage shows in the loading, no-budget and unavailable states too, because the decision still happens there', () => {
    budgetState.data = 0;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', projectStatus: 'Tender Submitted', status: 'Requested' });
    expect(within(heading()).getByText('Tender submitted')).toBeInTheDocument();
  });

  it('a won or running project shows no stage pill', () => {
    budgetState.data = 1000;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', projectStatus: 'Ongoing Project', status: 'Requested' });
    expect(within(heading()).queryByText('Ongoing')).not.toBeInTheDocument();
  });

  it('Bahasa: the stage reads in Indonesian', () => {
    budgetState.data = 1000;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', projectStatus: 'Tender Submitted', status: 'Requested' }, 'id');
    expect(within(heading()).getByText('Tender diajukan')).toBeInTheDocument();
    expect(within(heading()).queryByText('Tender submitted')).not.toBeInTheDocument();
  });
});
