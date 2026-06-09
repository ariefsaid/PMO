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
import { render, screen } from '@testing-library/react';
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

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => budgetState,
}));

vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => committedState,
}));

import { DecisionSupportPanel } from './DecisionSupportPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderPanel(props: React.ComponentProps<typeof DecisionSupportPanel>) {
  return render(<DecisionSupportPanel {...props} />);
}

beforeEach(() => {
  budgetState.data = undefined;
  budgetState.isPending = false;
  budgetState.isError = false;
  committedState.data = 0;
  committedState.isPending = false;
  committedState.isError = false;
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
    expect(screen.queryByText(/exceeds remaining budget/i)).not.toBeInTheDocument();
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

  it('renders "Remaining vs. committed" label (budget − committed)', () => {
    // budget=1,200,000; committed=986,600 → remaining=213,400
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/remaining vs\.? committed/i)).toBeInTheDocument();
    expect(screen.getByText(/\$213,400/)).toBeInTheDocument();
  });

  it('renders "Project budget" label with the budget figure', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/project budget/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1,200,000/)).toBeInTheDocument();
  });

  it('renders "After this request" label with remaining−totalValue + percent', () => {
    // remaining=213,400; totalValue=48,000 → after=165,400; % = 165400/1200000 ≈ 13.8%
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

  it('shows a non-blocking advisory with exact dollar overage when request exceeds remaining', () => {
    // committed=1,100,000 → remaining=100,000; totalValue=120,000 → over by $20,000
    committedState.data = 1100000;
    renderPanel({ projectId: 'proj-1', totalValue: 120000, projectName: 'HQ Fit-Out' });
    // Non-blocking advisory: role="status", NOT role="alert"
    const advisory = screen.getByRole('status');
    expect(advisory.textContent).toMatch(/exceeds remaining budget/i);
    expect(advisory.textContent).toMatch(/\$20,000/);
    expect(advisory.textContent).toMatch(/advisory only/i);
    // It must NOT be an assertive alert (gentler for a non-blocking advisory — M4)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does NOT show advisory when within budget', () => {
    committedState.data = 986600; // remaining=213,400; totalValue=48,000 → within
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.queryByText(/exceeds remaining budget/i)).not.toBeInTheDocument();
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
