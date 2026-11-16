/**
 * AC-IXD-PROC-W5-2 — DecisionSupportPanel
 *
 * Tests verify REAL rendered behavior:
 *  - Renders labelled figures from budget + recorded spending + open orders + Reserved + total_value
 *    (OD-APPROVAL-LEFT: "Left after this purchase", each amount counted once)
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
  commitmentSource: 'pmo' as 'pmo' | 'not-tracked' | 'unavailable' | undefined,
  ownershipPending: false,
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

const { committedArgs, ownershipArgs, reservedArgs } = vi.hoisted(() => ({ committedArgs: [] as unknown[], ownershipArgs: [] as unknown[], reservedArgs: [] as unknown[] }));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: (projectId: unknown, includeOwnership?: unknown) => { committedArgs.push(projectId); ownershipArgs.push(includeOwnership); return committedState; },
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

/** Recorded spending 0 and `open` open orders: the reading carries both (PMO), and the committed position agrees. */
function orders(open: number, spent = 0, over: Partial<CanonicalBudgetReading> = {}) {
  committedState.data = open;
  positionState.reading = reading({ spent: spent.toFixed(2), openCommitment: open.toFixed(2), ...over });
}

beforeEach(() => {
  committedState.otherCurrencies = [];
  committedState.commitmentSource = 'pmo';
  committedState.ownershipPending = false;
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
  ownershipArgs.length = 0;
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
    orders(300000);
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
    orders(300000);
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
describe('AC-IXD-PROC-W5-2d — figures rendered (whole budget basis)', () => {
  beforeEach(() => {
    budgetState.data = 1200000;
    orders(986600); // open orders; recorded spending 0
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
    expect(screen.getByText('Sisa setelah pembelian ini')).toBeInTheDocument();
  });

  it('rule 15 + Bahasa: a 1,000,000 budget stays on one line and every label is Bahasa', () => {
    budgetState.data = 1_000_000;
    orders(0);
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
    orders(0);
    renderPanel({ projectId: 'proj-1', totalValue: 22_500, projectName: 'HQ Fit-Out' }, 'id');
    const budgetTile = screen.getByText('Anggaran proyek').closest('[data-testid="stat-tile"]') as HTMLElement;
    expect(budgetTile.className).toContain('col-span-2');
    expect(within(budgetTile).getByText(/1,240,000,000/).closest('.whitespace-nowrap')).not.toBeNull();
  });

  it('AC-RD-MONEY-002: approval money is the exact full amount, never a short unit (OD-MONEY-FMT: KPI cards only)', () => {
    budgetState.data = 1_240_000_000;
    orders(0);
    renderPanel({ projectId: 'proj-1', totalValue: 56_000, projectName: null });
    expect(screen.getByText('$56,000')).toBeInTheDocument();
    expect(screen.getAllByText('$1,240,000,000').length).toBeGreaterThan(0);
    expect(screen.queryByText(/\$\d+(\.\d)?[KMB]\b/)).not.toBeInTheDocument();
  });

  it('AC-RB-015: the purchasing-only "Not yet committed to purchases" figure is gone (one Left figure, not two)', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.queryByText(/not yet committed to purchases/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not counting recorded spending/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/headroom/i)).not.toBeInTheDocument();
  });

  it('renders "Project budget" label with the budget figure', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/project budget/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1,200,000/)).toBeInTheDocument();
  });

  it('renders "Left after this purchase" with budget − spending − open orders − reserved − this request, and the bar percent (Requested)', () => {
    // 1,200,000 − 0 − 986,600 − 0 − 48,000 = 165,400 left; used = 1,034,600 / 1,200,000 = 86.2%
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/^left after this purchase$/i)).toBeInTheDocument();
    expect(screen.getByText(/\$165,400/)).toBeInTheDocument();
    expect(screen.getByText('Spent or committed, with this one: 86%')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2e: over-budget advisory (non-blocking, role="status", text)
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2e — over-budget advisory', () => {
  beforeEach(() => {
    budgetState.data = 1200000;
  });

  it('shows ONE non-blocking advisory with the exact overage when the figure is negative', () => {
    // open orders 1,100,000; reserved 0; this 120,000 → 1,200,000 − 1,220,000 = −20,000
    orders(1100000);
    renderPanel({ projectId: 'proj-1', totalValue: 120000, projectName: 'HQ Fit-Out' });
    // Non-blocking advisory: role="status", NOT role="alert"
    const advisory = screen.getByRole('status');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(advisory.textContent).toMatch(/^Over budget/);
    expect(advisory.textContent).toMatch(/\$20,000 over the budget after this purchase/);
    expect(advisory.textContent).toMatch(/advisory only/i);
    // It must NOT be an assertive alert (gentler for a non-blocking advisory — M4)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does NOT show advisory when within budget', () => {
    orders(986600); // 165,400 left after this one
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.queryByText(/over budget/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2f: "Budget impact" is a real heading (M3); no uninformative bar (I1)
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2f — heading + the one budget bar', () => {
  beforeEach(() => {
    budgetState.data = 1200000;
    orders(0);
  });

  it('renders "Budget impact" as a real heading element', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByRole('heading', { name: /budget impact/i })).toBeInTheDocument();
  });

  it('renders the six budget figures in one strip so no empty cell appears', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    const tiles = within(screen.getByTestId('stat-tiles')).getAllByTestId('stat-tile');
    expect(tiles).toHaveLength(6);
    for (const tile of tiles) expect(tile).not.toBeEmptyDOMElement();
  });

  it('2057: ONE budget-impact bar states the used share after this procurement and the budget it is measured against', () => {
    budgetState.data = 1000;
    orders(300);
    reservedState.data = 200;
    renderPanel({ projectId: 'proj-1', totalValue: 100, projectName: 'HQ Fit-Out', status: 'Requested' });
    const bar = screen.getByRole('progressbar');
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    // budget 1000, open orders 300 + reserved 200 + this 100 = 600 used → 60%.
    expect(bar).toHaveAttribute('aria-valuenow', '60');
    expect(bar.getAttribute('aria-label')).toMatch(/60%/);
    expect(bar.getAttribute('aria-label')).toMatch(/\$1,000/);
    expect(screen.getByText('Spent or committed, with this one: 60%')).toBeInTheDocument();
    // The figure behind the bar: 1000 − 300 − 200 − 100 left after this purchase.
    expect(tileValue(/^left after this purchase$/i).textContent).toMatch(/\$400\b/);
  });

  it('uses one whole-percent rounding rule: the bar percent is the exact complement of the Left figure', () => {
    budgetState.data = 1000;
    orders(300);
    reservedState.data = 200;
    renderPanel({ projectId: 'proj-1', totalValue: 179, projectName: 'HQ Fit-Out', status: 'Requested' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '68');
    expect(screen.getByText('Spent or committed, with this one: 68%')).toBeInTheDocument();
    // 1000 − 300 − 200 − 179 = 321 left = 32.1% of the budget
    expect(tileValue(/^left after this purchase$/i).textContent).toMatch(/\$321\b/);
  });

  it('2057: past the budget the bar is full and carries the destructive tone', () => {
    budgetState.data = 1000;
    orders(900);
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
    orders(0);
    reservedState.projectCurrency = 'IDR';
    reservedState.budgetCurrency = 'USD';

    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' }, undefined, true);

    expect(await screen.findByTestId('figures-hidden')).toHaveTextContent('Budget comparison unavailable for these currencies.');
    expect(screen.queryByText('Budget comparison unavailable for these currencies.', { exact: true })).not.toBeInTheDocument();
  });

  it('reports unrepresentable amounts to the shared hidden-figure line', async () => {
    budgetState.data = 1200000;
    orders(0);

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
    orders(0);
    renderPanel({ projectId: 'proj-1', totalValue: 10000, projectName: 'Northwind ERP Rollout' });
    expect(screen.getByText(/Northwind ERP Rollout/)).toBeInTheDocument();
  });
});

// ===========================================================================
// Reserved budget layer (ADR-0034) — AC-RB-004..014
// ===========================================================================

describe('AC-RB-004 — Left = Budget − Spending − Open orders − Reserved', () => {
  it('R2-P1b #12 names what the figure counts: after spending, orders and reserved', () => {
    budgetState.data = 1000;
    orders(300);
    reservedState.data = 200;
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });

    const label = screen.getByText('Left after this purchase');
    const tile = label.closest('[data-testid="stat-tile"]') as HTMLElement;
    expect(within(tile).getByText(/\$500\b/)).toBeInTheDocument();
    expect(within(tile).getByText('After spending, orders and reserved')).toBeInTheDocument();
  });

  it('AC-RB-004: shows Left $500 for budget 1000 / open orders 300 / reserved 200 / spending 0', () => {
    budgetState.data = 1000;
    orders(300);
    reservedState.data = 200;
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/^left after this purchase$/i)).toBeInTheDocument();
    expect(tileValue(/^left after this purchase$/i).textContent).toMatch(/\$500\b/);
  });
  it('0373: open orders in another currency → no Left number (never subtracted as project currency); the reason names them', () => {
    budgetState.data = 1000;
    orders(300);
    committedState.otherCurrencies = [{ currency: 'EUR', amount: 90 }];
    reservedState.data = 200;
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });
    const tile = screen.getByText(/^left after this purchase$/i).closest('[data-testid="stat-tile"]') as HTMLElement;
    expect(tile.textContent).not.toMatch(/\$/);
    expect(within(tile).getByText('Open orders in another currency: €90')).toBeInTheDocument();
  });
  it('0373: no other-currency note when every commitment is in the project currency', () => {
    budgetState.data = 1000;
    orders(300);
    reservedState.data = 200;
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });
    expect(screen.queryByText(/other currencies/)).not.toBeInTheDocument();
  });
  it('AC-RB-004: Left tile uses neg tone when negative', () => {
    budgetState.data = 1000;
    orders(800);
    reservedState.data = 400; // left = -200
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });
    const neg = tileValue(/^left after this purchase$/i);
    expect(neg.textContent).toMatch(/-?\$200/);
    expect(neg.className).toMatch(/destructive/);
  });

  it('FR-L10N-020: every figure renders in the passed-in currency, not USD', () => {
    budgetState.data = 1000;
    orders(300);
    reservedState.data = 200;
    reservedState.projectCurrency = 'EUR';
    reservedState.budgetCurrency = 'EUR';
    positionState.reading = reading({ currency: 'EUR', budgetCurrency: 'EUR', spent: '0.00', openCommitment: '300.00' });
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested', currency: 'EUR' });
    const availableLabel = screen.getByText(/^left after this purchase$/i);
    const availableTile = availableLabel.closest('[data-testid="stat-tile"]') as HTMLElement;
    expect(within(availableTile).getByText(/€500\b/)).toBeInTheDocument();
    expect(within(availableTile).queryByText(/\$/)).not.toBeInTheDocument();
  });
});

describe('AC-RB-005 — Reserved tile shows other-reserved, never "encumbered"', () => {
  it('AC-RB-005: total reserved 200, this case 50 (Approved) → tile shows $150', () => {
    budgetState.data = 1000;
    orders(0);
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

describe('AC-RB-006 — Left after = Left − thisRequest at Requested', () => {
  it('AC-RB-006: left 500 (budget 700, open orders 100, reserved 100), thisRequest 120 → $380', () => {
    budgetState.data = 700;
    orders(100);
    reservedState.data = 100;
    renderPanel({ projectId: 'p1', totalValue: 120, projectName: 'X', status: 'Requested' });
    expect(tileValue(/^left after this purchase$/i).textContent).toMatch(/\$380\b/);
  });
});

describe('AC-RB-007 — Left after = Left at Approved (no double-subtract)', () => {
  it('AC-RB-007: this case 120 already in reserved → $500, NOT $380', () => {
    budgetState.data = 700;
    orders(100);
    reservedState.data = 100; // available = 500
    renderPanel({ projectId: 'p1', totalValue: 120, projectName: 'X', status: 'Approved' });
    // Left after == Left ($500) — thisRequest (120) is NOT subtracted again.
    expect(tileValue(/^left after this purchase$/i).textContent).toMatch(/\$500\b/);
    // The naïve "always subtract thisRequest" answer ($380) must NOT appear anywhere.
    expect(screen.queryByText(/\$380\b/)).not.toBeInTheDocument();
  });
});

describe('AC-RB-008 — panel visible Draft..Quote Selected', () => {
  it.each(['Draft', 'Requested', 'Approved', 'Vendor Quoted', 'Quote Selected'] as const)(
    'AC-RB-008: shows the Budget-impact card at status %s',
    (status) => {
      budgetState.data = 1000;
      orders(0);
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
      orders(0);
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
    orders(0);
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
    expect(screen.queryByText(/^left after this purchase$/i)).not.toBeInTheDocument();
  });
});

describe('AC-RB-013 — over-budget advisory at Requested', () => {
  it('AC-RB-013: status Requested, left 100, thisRequest 250 → role=status advisory, over by $150, approval still permitted', () => {
    budgetState.data = 100;
    orders(0);
    reservedState.data = 0; // available = 100
    renderPanel({ projectId: 'p1', totalValue: 250, projectName: 'X', status: 'Requested' });
    const advisory = screen.getByRole('status');
    expect(advisory.textContent).toMatch(/^Over budget/);
    expect(advisory.textContent).toMatch(/\$150 over the budget after this purchase/);
    expect(advisory.textContent).toMatch(/advisory only|still permitted/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('AC-RB-014 — already-reserved: no false advisory; the one advisory only when the figure is negative', () => {
  it('AC-RB-014: Approved with left >= 0 → no advisory based on thisRequest', () => {
    budgetState.data = 1000;
    orders(0);
    reservedState.data = 200; // left 800 ≥ 0
    renderPanel({ projectId: 'p1', totalValue: 999, projectName: 'X', status: 'Approved' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('AC-RB-014: Approved with left < 0 → the advisory by the negative amount', () => {
    budgetState.data = 1000;
    orders(900);
    reservedState.data = 300; // left -200
    renderPanel({ projectId: 'p1', totalValue: 50, projectName: 'X', status: 'Approved' });
    const advisory = screen.getByRole('status');
    expect(advisory.textContent).toMatch(/over budget/i);
    expect(advisory.textContent).toMatch(/\$200 over the budget/);
  });
});

describe('currency-aware budget position', () => {
  it('does not compare a foreign request with the project budget', () => {
    budgetState.data = 1000;
    orders(100);
    renderPanel({ projectId: 'proj-1', totalValue: 200, projectName: 'Project', currency: 'EUR' });
    expect(screen.getByText(/not compared with the budget/i)).toBeInTheDocument();
    expect(screen.queryByText(/left after this purchase/i)).not.toBeInTheDocument();
  });
});

  it('reports foreign reserved demand separately from project headroom', () => {
    budgetState.data = 1000;
    orders(100);
    reservedState.data = 200;
    reservedState.otherCurrencies = [{ currency: 'EUR', amount: 300 }];
    renderPanel({ projectId: 'proj-1', totalValue: 50, projectName: 'Project' });
    // 1000 − 0 − 100 − 200 − 50 = 650
    expect(screen.getByText(/\$650/)).toBeInTheDocument();
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

it('#1354 labels each figure in its own currency: the request in its currency, budget figures in the budget currency, no cross-currency Left', () => {
  budgetState.data = 1000;
  orders(300);
  reservedState.data = 200;
  renderPanel({ projectId: 'proj-1', totalValue: 50, projectName: 'Project', currency: 'EUR' });
  const valueOf = (label: RegExp) => within(screen.getByText(label).closest('[data-testid="stat-tile"]') as HTMLElement);
  expect(valueOf(/^procurement total$/i).getByText(/€50\b/)).toBeInTheDocument();
  expect(valueOf(/^project budget$/i).getByText(/\$1,000\b/)).toBeInTheDocument();
  expect(valueOf(/^reserved$/i).getByText(/\$200\b/)).toBeInTheDocument();
  expect(screen.queryByText(/left after this purchase/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/over budget/i)).not.toBeInTheDocument();
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
// OD-APPROVAL-LEFT — "Left after this purchase": budget − spending − open orders − reserved − this purchase.
// Display + arithmetic; approval routing never reads this figure.
// ===========================================================================
const tileOf = (label: RegExp) => screen.getByText(label).closest('[data-testid="stat-tile"]') as HTMLElement;

/** The plan's primary project: budget 1,000, spent 500, open orders 400, reserved 50, this request 25 (Requested). */
function primary() {
  budgetState.data = 1000;
  orders(400, 500);
  reservedState.data = 50;
  return { projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' as const };
}

describe('AC-RB-015 — Left after this purchase counts the whole budget', () => {
  it('primary: $25 left, "After spending, orders and reserved", bar "Spent or committed, with this one: 98%", Budget used 50% beside it', () => {
    renderPanel(primary());
    const tile = tileOf(/^left after this purchase$/i);
    expect(within(tile).getByText('$25')).toBeInTheDocument();
    expect(within(tile).getByText('After spending, orders and reserved')).toBeInTheDocument();
    expect(screen.getByText('Spent or committed, with this one: 98%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '98');
    expect(screen.queryByText(/not yet committed to purchases/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/headroom/i)).not.toBeInTheDocument();
    expect(within(tileOf(/^budget used$/i)).getByText('50%')).toBeInTheDocument();
  });

  it('Bahasa: label, sub-line and bar caption are Indonesian', () => {
    renderPanel(primary(), 'id');
    const tile = tileOf(/^sisa setelah pembelian ini$/i);
    expect(within(tile).getByText('Setelah pengeluaran, pesanan, dan cadangan')).toBeInTheDocument();
    expect(screen.getByText('Terpakai atau terikat, termasuk yang ini: 98%')).toBeInTheDocument();
    expect(screen.queryByText('Left after this purchase')).not.toBeInTheDocument();
  });

  it('the label carries the formula as its tooltip, en and id', () => {
    const view = renderPanel(primary());
    expect(screen.getByText(/^left after this purchase$/i).closest('[title]')).toHaveAttribute('title',
      'Budget minus recorded spending, open orders, reserved requests and this purchase, each counted once, before tax.');
    view.unmount();
    renderPanel(primary(), 'id');
    expect(screen.getByText(/^sisa setelah pembelian ini$/i).closest('[title]')).toHaveAttribute('title',
      'Anggaran dikurangi pengeluaran tercatat, pesanan terbuka, permintaan yang dicadangkan, dan pembelian ini, masing-masing dihitung sekali, sebelum pajak.');
  });

  it('the inbox row (captionInTooltip) shows the same sub-line under the figure as the record; the tooltip is also read by screen readers', () => {
    renderPanel({ ...primary(), captionInTooltip: true });
    const tile = tileOf(/^left after this purchase/i);
    expect(within(tile).getByText('After spending, orders and reserved')).toBeInTheDocument();
    expect(tile.querySelector('.sr-only')?.textContent).toMatch(/each counted once/);
    expect(within(tile).getByText('$25')).toBeInTheDocument();
  });

  it('asks who owns purchasing: the committed position is read with ownership, so a not-tracked project is never read as zero orders', () => {
    renderPanel(primary());
    expect(ownershipArgs).toContain(true);
  });

  it('shows the project figures in order: total, reserved, budget used, budget, left', () => {
    renderPanel(primary());
    const labels = within(screen.getByTestId('stat-tiles')).getAllByTestId('stat-tile').map((tile) => tile.firstElementChild?.textContent);
    expect(labels).toEqual(['Procurement total', 'Reserved', 'Open orders', 'Budget used', 'Project budget', 'Left after this purchase']);
  });
});

// The approver must be able to rebuild Left from what the panel shows: budget − spent − open orders − reserved − this = left.
describe('AC-RB-015 — the figures shown reconcile to Left', () => {
  const money = (text: string | null | undefined) => Number((text ?? '').replace(/[^0-9.-]/g, ''));
  const shown = (label: RegExp, pick: RegExp) => money(within(tileOf(label)).getByText(pick).textContent);
  /** Spent is shown as Budget used (a percent of the budget); the rest are amounts. */
  function reconcile() {
    const budget = shown(/^project budget$/i, /\$/);
    const spent = (shown(/^budget used$/i, /%/) / 100) * budget;
    const orders = shown(/^open orders$/i, /\$/);
    const reserved = shown(/^reserved$/i, /\$/);
    const request = shown(/^procurement total$/i, /\$/);
    return { left: shown(/^left after this purchase/i, /\$/), computed: budget - spent - orders - reserved - request };
  }
  const cascade = () => {
    budgetState.data = 1000;
    orders(300, 1040, { usedPercent: '104', usedRatio: '1.04' });
    reservedState.data = 200;
    return { projectId: 'p1', totalValue: 440, projectName: 'Cascade', status: 'Requested' as const };
  };

  it.each([
    ['primary record', () => primary(), false, 25],
    ['primary inbox row', () => ({ ...primary(), captionInTooltip: true }), true, 25],
    ['over budget record', cascade, false, -980],
    ['over budget inbox row', () => ({ ...cascade(), captionInTooltip: true }), true, -980],
  ])('%s: the six figures shown add up to the Left shown (%#)', (_name, setup, _inbox, left) => {
    renderPanel(setup());
    const { left: shownLeft, computed } = reconcile();
    expect(shownLeft).toBe(left);
    expect(computed).toBe(left);
  });

  it('open orders are labelled with the catalogue term and its sub-line, en and id', () => {
    const view = renderPanel(primary());
    const tile = tileOf(/^open orders$/i);
    expect(within(tile).getByText('$400')).toBeInTheDocument();
    expect(within(tile).getByText('Ordered, not yet in spending')).toBeInTheDocument();
    view.unmount();
    renderPanel(primary(), 'id');
    const tileId = tileOf(/^pesanan terbuka$/i);
    expect(within(tileId).getByText('$400')).toBeInTheDocument();
    expect(within(tileId).getByText('Dipesan, belum masuk pengeluaran tercatat')).toBeInTheDocument();
  });

  it('open orders still show while spending is not known', () => {
    budgetState.data = 1000;
    committedState.data = 400;
    reservedState.data = 50;
    positionState.reading = reading({ spent: null });
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(within(tileOf(/^open orders$/i)).getByText('$400')).toBeInTheDocument();
  });

  it('open orders not known: no Open orders tile (never drawn as zero)', () => {
    committedState.commitmentSource = 'not-tracked';
    renderPanel(primary());
    expect(screen.queryByText(/^open orders$/i)).not.toBeInTheDocument();
  });
});

describe('AC-RB-016 — already reserved: this request is not subtracted again', () => {
  it('Approved 25 (reserved 75 incl. it) → $25 left, Reserved tile shows the other 50', () => {
    budgetState.data = 1000;
    orders(400, 500);
    reservedState.data = 75;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Approved' });
    expect(within(tileOf(/^left after this purchase$/i)).getByText('$25')).toBeInTheDocument();
    expect(within(tileOf(/^reserved$/i)).getByText('$50')).toBeInTheDocument();
  });

  it('Approved 25, over budget by 10 before it → left −$10 (not −$35), advisory $10', () => {
    budgetState.data = 1000;
    orders(400, 500);
    reservedState.data = 110; // 1000 − 500 − 400 − 110 = −10
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Approved' });
    expect(tileValue(/^left after this purchase$/i).textContent).toMatch(/-\$10\b/);
    expect(screen.getByRole('status').textContent).toMatch(/\$10 over the budget after this purchase/);
  });
});

describe('AC-RB-015 — over budget (the Cascade case)', () => {
  // budget 1,000, spent 1,040 (Budget used 104%), open orders 300, reserved 200, this 440 → −980; (1000+980)/1000 = 198%.
  const cascade = () => {
    budgetState.data = 1000;
    orders(300, 1040, { usedPercent: '104', usedRatio: '1.04' });
    reservedState.data = 200;
    return { projectId: 'p1', totalValue: 440, projectName: 'Cascade', status: 'Requested' as const };
  };

  it('en: Left −$980 in the neg tone, one advisory with $980, caption 198% never saying "Budget used"; the tile keeps the header 104%', () => {
    renderPanel(cascade());
    const left = tileValue(/^left after this purchase$/i);
    expect(left.textContent).toMatch(/-\$980\b/);
    expect(left.className).toMatch(/destructive/);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toMatch(/Over budget.*\$980 over the budget after this purchase/);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar.getAttribute('aria-label')).toBe('Spent or committed, with this one: 198% of $1,000');
    const caption = screen.getByText(/^Spent or committed, with this one: 198%$/);
    expect(caption.textContent).not.toMatch(/budget used/i);
    expect(within(tileOf(/^budget used$/i)).getByText('104%')).toBeInTheDocument();
  });

  it('id: the same, in Bahasa, never "Anggaran terpakai" in the bar', () => {
    renderPanel(cascade(), 'id');
    const bar = screen.getByRole('progressbar');
    const caption = screen.getByText(/^Terpakai atau terikat, termasuk yang ini: 198%$/);
    expect(caption.textContent).not.toMatch(/anggaran terpakai/i);
    expect(bar.getAttribute('aria-label')).toMatch(/^Terpakai atau terikat, termasuk yang ini: 198% dari /);
    expect(screen.getByRole('status').textContent).toMatch(/Melebihi anggaran/);
    expect(within(tileOf(/^anggaran terpakai$/i)).getByText('104%')).toBeInTheDocument();
  });
});

// AC-RB-017: unknown is never drawn as a number under the Left label; with only spending unknown the purchasing-only
// amount is stated under its own explicit label (director ruling 3), never in the Left tile.
describe('AC-RB-017 — unknown figures are not drawn', () => {
  const asked = () => ({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' as const });
  const leftTile = () => tileOf(/^left after this purchase$/i);

  // Spending not known, open orders 400 and reserved 50 known: 1,000 − 400 − 50 − 25 = 525 without spending.
  const spendingOnly: ReadonlyArray<readonly [string, () => void]> = [
    ['spending null on the reading', () => { positionState.reading = reading({ spent: null }); }],
    ['ERP with no ledger reading for the project', () => { positionState.reading = undefined; }],
    ['reading in another currency', () => { positionState.reading = reading({ currency: 'EUR', budgetCurrency: 'EUR' }); }],
    ['the reading failed to load', () => { positionState.reading = undefined; positionState.isError = true; }],
  ];

  it.each(spendingOnly)('spending only unknown (%s): Left reads not known, the purchasing-only amount sits under its own label, no bar, no advisory', (_name, setup) => {
    budgetState.data = 1000;
    committedState.data = 400;
    reservedState.data = 50;
    setup();
    renderPanel(asked());
    // the Left tile: never a number
    expect(leftTile().textContent).not.toMatch(/\$/);
    const notKnown = within(leftTile()).getByText('Not known');
    expect(notKnown.className).toMatch(/whitespace-nowrap/);
    expect(notKnown.className).toMatch(/text-muted-foreground/);
    // the explicit line: visible without a click, with the amount, under its own words, and no repeat of the tile
    const line = screen.getByText(/^Without spending:/);
    expect(line.textContent).toBe('Without spending: $525 left after orders, reserved and this purchase.');
    expect(line.textContent).not.toMatch(/not known/i);
    expect(leftTile().contains(line)).toBe(false);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/over budget/i)).not.toBeInTheDocument();
    // the amount appears once, and only in that line
    expect(screen.getAllByText(/\$525/)).toHaveLength(1);
  });

  it('spending only unknown and the figure without it is negative: the line says so, still no advisory and no bar', () => {
    budgetState.data = 1000;
    reservedState.data = 50;
    orders(990, 0, { spent: null });
    renderPanel(asked());
    // 1,000 − 990 − 50 − 25 = −65
    expect(screen.getByText(/Without spending: -\$65 left/)).toBeInTheDocument();
    expect(screen.queryByText(/over budget/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('the inbox row (no figure scope, caption in tooltip): the reason and the without-spending line are both visible in the row', () => {
    budgetState.data = 1000;
    committedState.data = 400;
    reservedState.data = 50;
    positionState.reading = reading({ spent: null });
    renderPanel({ ...asked(), captionInTooltip: true });
    expect(within(tileOf(/^left after this purchase/i)).getByText('Not known')).toBeInTheDocument();
    expect(screen.getByText('Without spending: $525 left after orders, reserved and this purchase.')).toBeInTheDocument();
  });

  it('spending only unknown: Bahasa line', () => {
    budgetState.data = 1000;
    committedState.data = 400;
    reservedState.data = 50;
    positionState.reading = reading({ spent: null });
    renderPanel(asked(), 'id');
    expect(screen.getByText('Tanpa pengeluaran: sisa $525 setelah pesanan, cadangan, dan pembelian ini.')).toBeInTheDocument();
    const notKnown = within(tileOf(/^sisa setelah pembelian ini$/i)).getByText('Belum diketahui');
    expect(notKnown.className).toMatch(/whitespace-nowrap/);
  });

  it('spending only unknown, inside a figure scope: the page line carries the Left reason, the explicit line stays visible', async () => {
    budgetState.data = 1000;
    committedState.data = 400;
    reservedState.data = 50;
    positionState.reading = reading({ spent: null });
    renderPanel(asked(), undefined, true);
    expect(await screen.findByTestId('figures-hidden')).toHaveTextContent('Spending not known yet');
    expect(screen.getByText(/Without spending: \$525 left after orders, reserved and this purchase\./)).toBeInTheDocument();
  });

  it('spending only unknown and already reserved: the line does not subtract the request twice', () => {
    budgetState.data = 1000;
    committedState.data = 400;
    reservedState.data = 75; // incl. this 25
    positionState.reading = reading({ spent: null });
    renderPanel({ ...asked(), status: 'Approved' });
    expect(screen.getByText(/Without spending: \$525 left/)).toBeInTheDocument();
  });

  const ordersUnknown: ReadonlyArray<readonly [string, () => void]> = [
    ['open orders in another currency', () => { committedState.otherCurrencies = [{ currency: 'EUR', amount: 90 }]; }],
    ['purchasing kept outside PMO', () => { committedState.commitmentSource = 'not-tracked'; }],
    ['ownership not readable', () => { committedState.commitmentSource = 'unavailable'; }],
    ['ERP with no committed position yet', () => { positionState.reading = reading({ ledgerBasis: 'erp', openCommitment: null }); committedState.data = undefined; }],
    ['PMO reading with no open commitment', () => { positionState.reading = reading({ openCommitment: null }); }],
  ];

  it.each(ordersUnknown)('open orders unknown (%s): Left reads not known with its reason only, no amount, no bar, no advisory', (_name, setup) => {
    budgetState.data = 1000;
    orders(400, 500);
    reservedState.data = 50;
    setup();
    renderPanel(asked());
    expect(leftTile().textContent).not.toMatch(/\$/);
    expect(within(leftTile()).getByText(_name === 'open orders in another currency' ? /^Open orders in another currency/ : 'Open orders not known yet')).toBeInTheDocument();
    expect(screen.queryByText(/Without spending/)).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/over budget/i)).not.toBeInTheDocument();
    // no purchasing-only number anywhere beyond the tiles that never held one
    expect(screen.queryByText(/\$525|\$550/)).not.toBeInTheDocument();
  });

  it('a request in another currency has no Left figure and no without-spending line, even when spending is unknown', () => {
    budgetState.data = 1000;
    committedState.data = 400;
    positionState.reading = reading({ spent: null });
    renderPanel({ ...asked(), currency: 'EUR' });
    expect(screen.queryByText(/left after this purchase/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Without spending/)).not.toBeInTheDocument();
  });

  it('loading: the panel waits for the reading and for who owns purchasing, so Left never flashes "not known"', () => {
    budgetState.data = 1000;
    positionState.reading = undefined;
    positionState.isPending = true;
    renderPanel(asked());
    expect(screen.getByLabelText('Loading budget impact')).toBeInTheDocument();
    expect(screen.queryByText(/left after this purchase/i)).not.toBeInTheDocument();
  });

  it('loading: ownership still pending holds the panel too', () => {
    budgetState.data = 1000;
    committedState.ownershipPending = true;
    renderPanel(asked());
    expect(screen.getByLabelText('Loading budget impact')).toBeInTheDocument();
  });
});

describe('S05 — the project\'s Budget used sits beside it', () => {
  it('reads the project through the shared positions hook, with no sum of its own', () => {
    budgetState.data = 1000;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(positionArgs.at(-1)).toEqual(['p1']);
  });

  it('ERP basis: the ledger actual is the spending, so 300 of 1,000 reads 30%; open orders come from the committed position', () => {
    budgetState.data = 1000;
    committedState.data = 250;
    positionState.reading = reading({ ledgerBasis: 'erp', spent: '300.00', openCommitment: null });
    reservedState.data = 50;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(within(tileOf(/^budget used$/i)).getByText('30%')).toBeInTheDocument();
    // 1000 − 300 − 250 − 50 − 25 = 375
    expect(within(tileOf(/^left after this purchase$/i)).getByText('$375')).toBeInTheDocument();
  });

  it('PMO basis reads open orders from the reading, not the committed position (reading 400, committed 900 → 400)', () => {
    budgetState.data = 1000;
    committedState.data = 900;
    positionState.reading = reading({ spent: '500.00', openCommitment: '400.00' });
    reservedState.data = 50;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(within(tileOf(/^left after this purchase$/i)).getByText('$25')).toBeInTheDocument();
  });

  it.each([
    ['spending unknown', { spent: null }],
    ['reading in another currency', { currency: 'EUR', budgetCurrency: 'EUR' }],
    ['no Active budget in the reading', { activeBudgetAmount: null }],
  ] as const)('%s → no Budget used tile, as the project header draws none', (_name, over) => {
    budgetState.data = 1000;
    committedState.data = 400;
    positionState.reading = reading(over);
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(screen.queryByText(/^budget used$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unknown or unavailable/i)).not.toBeInTheDocument();
    // the project budget is still drawn
    expect(within(tileOf(/^project budget$/i)).getByText(/\$1,000\b/)).toBeInTheDocument();
  });

  it.each(['Tender Submitted', 'PQ Submitted'])('a project still in the pipeline (%s): no Budget used tile and the failed read is reported only for Left, not for Budget used', async (projectStatus) => {
    budgetState.data = 1000;
    positionState.reading = undefined;
    positionState.isError = true;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', projectStatus, status: 'Requested' }, undefined, true);
    expect(await screen.findByText(/^project budget$/i)).toBeInTheDocument();
    expect(screen.queryByText(/^budget used$/i)).not.toBeInTheDocument();
    expect(await screen.findByTestId('figures-hidden')).toHaveTextContent('Spending not known yet');
    expect(screen.getByTestId('figures-hidden')).not.toHaveTextContent('Budget used');
    expect(screen.queryByText(/unknown or unavailable/i)).not.toBeInTheDocument();
  });

  it('a running project whose read failed keeps a short unknown mark in Budget used, never a sentence; only Left is in the hidden-figures line', async () => {
    budgetState.data = 1000;
    positionState.reading = undefined;
    positionState.isError = true;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', projectStatus: 'Active', status: 'Requested' }, undefined, true);
    const tile = tileOf(/^budget used$/i);
    expect(tile.textContent).toContain('—');
    expect(tile.querySelector('[role="status"]')).toBeNull();
    expect(await screen.findByTestId('figures-hidden')).toHaveTextContent('Spending not known yet');
    expect(screen.getByTestId('figures-hidden')).not.toHaveTextContent('Budget used');
    expect(screen.getByText(/^project budget$/i)).toBeInTheDocument();
  });

  it('a request in another currency still shows the project figures including Budget used, with no Left tile', () => {
    budgetState.data = 1000;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested', currency: 'EUR' });
    expect(within(tileOf(/^budget used$/i)).getByText('50%')).toBeInTheDocument();
    expect(screen.queryByText(/^left after this purchase$/i)).not.toBeInTheDocument();
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

describe('quality 1+2 — one reading, one strip', () => {
  it('a refetch error after an earlier success: Budget used shows no number beside "Not known" (one reading feeds both)', () => {
    budgetState.data = 1000;
    committedState.data = 400;
    reservedState.data = 50;
    positionState.reading = reading(); // earlier success: react-query keeps the stale data
    positionState.isError = true;
    renderPanel({ projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' });
    expect(within(tileOf(/^left after this purchase/i)).getByText('Not known')).toBeInTheDocument();
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
  });

  const stripClass = () => screen.getByTestId('stat-tiles').className;
  it('six tiles go 3 across (2 across on a phone, three rows); fewer tiles take as many columns as they have', () => {
    renderPanel(primary());
    expect(within(screen.getByTestId('stat-tiles')).getAllByTestId('stat-tile')).toHaveLength(6);
    expect(stripClass()).toContain('@xl:grid-cols-3');
    expect(stripClass()).not.toContain('grid-cols-5');
  });

  it('five tiles: five columns; four tiles: four columns (no empty column)', () => {
    positionState.reading = reading({ spent: null }); // Budget used has no figure; Left is unknown but still a tile
    const ask = { projectId: 'p1', totalValue: 25, projectName: 'X', status: 'Requested' as const };
    budgetState.data = 1000;
    committedState.data = 400;
    reservedState.data = 50;
    const view = renderPanel(ask);
    expect(within(screen.getByTestId('stat-tiles')).getAllByTestId('stat-tile')).toHaveLength(5);
    expect(stripClass()).toContain('@5xl:grid-cols-5');
    view.unmount();
    committedState.commitmentSource = 'not-tracked'; // no Open orders tile either
    renderPanel(ask);
    expect(within(screen.getByTestId('stat-tiles')).getAllByTestId('stat-tile')).toHaveLength(4);
    expect(stripClass()).toContain('@3xl:grid-cols-4');
    expect(stripClass()).not.toContain('grid-cols-5');
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
