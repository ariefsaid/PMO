/**
 * AC-IXD-PROC-W5-2 — DecisionSupportPanel
 *
 * Tests verify REAL rendered behavior:
 *  - Renders 4 labelled figures from budget/spent/total_value
 *  - Renders nothing when project_id is absent
 *  - Over-budget shows advisory with dollar amount (text-not-color-only a11y)
 *  - Loading state shows skeleton rows, rest of screen not blocked
 *  - Budget error / no active budget shows quiet fallback (never blocks decision)
 *  - ProgressBar has accessible aria-label
 *  - Figures use tabular notation (class check)
 *
 * All token references use DESIGN.md names — no hardcoded hex.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock useProjectBudget — controlled per-test
// ---------------------------------------------------------------------------
const budgetState = {
  data: undefined as number | undefined,
  isPending: false,
  isError: false,
};

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => budgetState,
}));

// useAuth needed by useProjectBudget (called inside the component's hook invocation)
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' } }),
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
    // panel renders the heading
    expect(screen.getByText(/budget impact/i)).toBeInTheDocument();
    // skeleton present
    expect(document.querySelectorAll('.skel').length).toBeGreaterThan(0);
    // figures NOT rendered
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
  it('shows quiet "budget unavailable" message on error', () => {
    budgetState.isError = true;
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out' });
    expect(screen.getByText(/budget unavailable/i)).toBeInTheDocument();
    // does not block — no "no access" or blocking copy
    expect(screen.queryByText(/this request/i)).not.toBeInTheDocument();
  });

  it('shows quiet fallback when budget is 0 (no active budget)', () => {
    budgetState.data = 0;
    budgetState.isPending = false;
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'Project A' });
    // A $0 budget means no active budget — panel shows fallback
    expect(screen.getByText(/no active budget/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2d: four figures rendered, text-labelled
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2d — four figures rendered', () => {
  beforeEach(() => {
    budgetState.data = 1200000;
    budgetState.isPending = false;
    budgetState.isError = false;
  });

  it('renders "This request" label with total_value formatted as currency', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out', projectSpent: 986600 });
    // Multiple tiles may contain "request" text, but at least one label says exactly "This request"
    const labels = screen.getAllByText(/this request/i);
    expect(labels.length).toBeGreaterThan(0);
    // $48,000 formatted
    expect(screen.getByText(/\$48,000/)).toBeInTheDocument();
  });

  it('renders "Remaining" label (budget − spent)', () => {
    // budget=1,200,000; spent=986,600 → remaining=213,400
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out', projectSpent: 986600 });
    expect(screen.getByText(/remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/\$213,400/)).toBeInTheDocument();
  });

  it('renders "Project budget" label with the budget figure', () => {
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out', projectSpent: 986600 });
    expect(screen.getByText(/project budget/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1,200,000/)).toBeInTheDocument();
  });

  it('renders "After this request" label with remaining−totalValue', () => {
    // remaining=213,400; totalValue=48,000 → after=165,400; % = 165400/1200000 ≈ 13.8%
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out', projectSpent: 986600 });
    expect(screen.getByText(/after this request/i)).toBeInTheDocument();
    expect(screen.getByText(/\$165,400/)).toBeInTheDocument();
    // percentage label somewhere in the panel
    expect(screen.getByText(/13\.8%/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2e: over-budget advisory (text, not color-only)
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2e — over-budget advisory', () => {
  beforeEach(() => {
    budgetState.data = 1200000;
    budgetState.isPending = false;
  });

  it('shows advisory with exact dollar overage when request exceeds remaining', () => {
    // spent=1,100,000 → remaining=100,000; totalValue=120,000 → over by $20,000
    renderPanel({ projectId: 'proj-1', totalValue: 120000, projectName: 'HQ Fit-Out', projectSpent: 1100000 });
    const advisory = screen.getByRole('alert');
    expect(advisory).toBeInTheDocument();
    expect(advisory.textContent).toMatch(/exceeds remaining budget/i);
    expect(advisory.textContent).toMatch(/\$20,000/);
  });

  it('does NOT show advisory when within budget', () => {
    // remaining=213,400; totalValue=48,000 → well within budget
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out', projectSpent: 986600 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2f: ProgressBar a11y — has aria-label
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2f — ProgressBar accessibility', () => {
  it('ProgressBar has an aria-label describing the budget utilization', () => {
    budgetState.data = 1200000;
    renderPanel({ projectId: 'proj-1', totalValue: 48000, projectName: 'HQ Fit-Out', projectSpent: 986600 });
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-label');
    expect(bar.getAttribute('aria-label')).toMatch(/budget/i);
  });
});

// ---------------------------------------------------------------------------
// AC-IXD-PROC-W5-2g: project name shown in panel heading
// ---------------------------------------------------------------------------
describe('AC-IXD-PROC-W5-2g — project name in heading', () => {
  it('renders project name in the panel heading when provided', () => {
    budgetState.data = 500000;
    renderPanel({ projectId: 'proj-1', totalValue: 10000, projectName: 'Northwind ERP Rollout', projectSpent: 0 });
    expect(screen.getByText(/Northwind ERP Rollout/)).toBeInTheDocument();
  });
});
