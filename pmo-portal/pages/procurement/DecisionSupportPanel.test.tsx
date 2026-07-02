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
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

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
  isPending: false,
  isError: false,
};
const reservedState = {
  data: 0 as number | undefined,
  isPending: false,
  isError: false,
};

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => budgetState,
}));

vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => committedState,
  useProjectReservedSpend: () => reservedState,
}));

import { DecisionSupportPanel } from './DecisionSupportPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// `status` defaults to 'Requested' (a panel-visible status) so the pre-existing
// AC-IXD-PROC-W5-2 tests stay visible without restating it; AC-RB tests pass an
// explicit status to exercise the per-stage math / visibility boundary.
function renderPanel(
  props: Omit<React.ComponentProps<typeof DecisionSupportPanel>, 'status'> &
    Partial<Pick<React.ComponentProps<typeof DecisionSupportPanel>, 'status'>>,
) {
  return render(
    <MemoryRouter>
      <DecisionSupportPanel status="Requested" {...props} />
    </MemoryRouter>,
  );
}

/** The value element of the stat tile whose label matches `label` (exact, case-insensitive). */
function tileValue(label: RegExp): HTMLElement {
  const labelEl = screen.getByText(label);
  const tile = labelEl.closest('[data-testid="stat-tile"]') as HTMLElement;
  // The value is the sibling div after the label div within the tile.
  return within(tile).getByText(/\$/);
}

beforeEach(() => {
  budgetState.data = undefined;
  budgetState.isPending = false;
  budgetState.isError = false;
  committedState.data = 0;
  committedState.isPending = false;
  committedState.isError = false;
  reservedState.data = 0;
  reservedState.isPending = false;
  reservedState.isError = false;
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
    expect(screen.queryByText(/this request/i)).not.toBeInTheDocument();
  });

  it('shows skeleton rows while committed spend is pending (either source blocks)', () => {
    budgetState.data = 1200000;
    committedState.isPending = true;
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(document.querySelectorAll('.skel').length).toBeGreaterThan(0);
    expect(screen.queryByText(/this request/i)).not.toBeInTheDocument();
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
    expect(screen.queryByText(/this request/i)).not.toBeInTheDocument();
  });

  it('shows quiet "budget unavailable" message on committed-spend error', () => {
    budgetState.data = 1200000;
    committedState.isError = true;
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/budget unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/this request/i)).not.toBeInTheDocument();
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

  it('renders "This request" label with total_value formatted as currency', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    const labels = screen.getAllByText(/this request/i);
    expect(labels.length).toBeGreaterThan(0);
    expect(screen.getByText(/\$48,000/)).toBeInTheDocument();
  });

  it('renders "Available" label (budget − committed − reserved; reserved=0 here)', () => {
    // budget=1,200,000; committed=986,600; reserved=0 → available=213,400
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/^available$/i)).toBeInTheDocument();
    expect(screen.getByText(/\$213,400/)).toBeInTheDocument();
  });

  it('renders "Project budget" label with the budget figure', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/project budget/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1,200,000/)).toBeInTheDocument();
  });

  it('renders "After this request" label with available−totalValue + percent (Requested)', () => {
    // available=213,400; totalValue=48,000 → after=165,400; % = 165400/1200000 ≈ 13.8%
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/after this request/i)).toBeInTheDocument();
    expect(screen.getByText(/\$165,400/)).toBeInTheDocument();
    expect(screen.getByText(/13\.8%/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2e: over-budget advisory (non-blocking, role="status", text)
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2e — over-budget advisory', () => {
  beforeEach(() => {
    budgetState.data = 1200000;
  });

  it('shows a non-blocking advisory with exact dollar overage when request exceeds available', () => {
    // committed=1,100,000; reserved=0 → available=100,000; totalValue=120,000 → over by $20,000
    committedState.data = 1100000;
    renderPanel({ projectId: 'proj-1', totalValue: 120000, projectName: 'HQ Fit-Out' });
    // Non-blocking advisory: role="status", NOT role="alert"
    const advisory = screen.getByRole('status');
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

  it('renders the five budget figures in a five-column strip at sm+ so no empty sixth cell appears', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByTestId('stat-tiles').className).toContain('sm:grid-cols-5');
  });

  it('does NOT render a progress bar (uninformative 0% bar removed — I1)', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
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
  it('AC-RB-004: shows Available $500 for budget 1000 / committed 300 / reserved 200', () => {
    budgetState.data = 1000;
    committedState.data = 300;
    reservedState.data = 200;
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/^available$/i)).toBeInTheDocument();
    // Scope to the Available tile (After this request also shows $500 here).
    expect(tileValue(/^available$/i).textContent).toMatch(/\$500\b/);
  });
  it('AC-RB-004: Available tile uses neg tone when negative', () => {
    budgetState.data = 1000;
    committedState.data = 800;
    reservedState.data = 400; // available = -200
    renderPanel({ projectId: 'p1', totalValue: 0, projectName: 'X', status: 'Requested' });
    const neg = tileValue(/^available$/i);
    expect(neg.textContent).toMatch(/-?\$200/);
    expect(neg.className).toMatch(/destructive/);
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
    expect(screen.getByText(/after this request/i)).toBeInTheDocument();
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
    expect(tileValue(/after this request/i).textContent).toMatch(/\$500\b/);
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
    expect(screen.queryByText(/this request/i)).not.toBeInTheDocument();
  });
});

describe('AC-RB-011 — error state (reserved read error)', () => {
  it('AC-RB-011: shows "budget unavailable", no tiles, when reserved read errors', () => {
    budgetState.data = 1000;
    reservedState.isError = true;
    renderPanel({ projectId: 'p1', totalValue: 10, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/budget unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/this request/i)).not.toBeInTheDocument();
  });
});

describe('AC-RB-012 — no-budget state', () => {
  it('AC-RB-012: budget 0 shows "no active budget", no reserved/available figures', () => {
    budgetState.data = 0;
    reservedState.data = 500;
    renderPanel({ projectId: 'p1', totalValue: 10, projectName: 'X', status: 'Requested' });
    expect(screen.getByText(/no active budget/i)).toBeInTheDocument();
    expect(screen.queryByText(/^available$/i)).not.toBeInTheDocument();
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
