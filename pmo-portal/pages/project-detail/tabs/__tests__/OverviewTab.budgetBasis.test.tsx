/**
 * AC-W2-1-FE-01: OverviewTab util%/at-risk uses the DERIVED budget (Σ Active-version line-items)
 * not the stored project.budget column.
 *
 * Scenario: project.budget = 0 (dead stored column), but useProjectBudget returns 100,000
 * (derived from Active budget-version line-items), committedSpend = 95,000.
 *
 * Pre-fix: activeBudget = 0 → util% = 0, at-risk pill hidden ("$95,000 of $0 budget").
 * Post-fix: activeBudget = 100,000 → util% = 95%, at-risk pill shown ("$95,000 of $100,000 budget").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ---------------------------------------------------------------------------
// Hoist mock state so vi.mock factories can reference them.
// ---------------------------------------------------------------------------
const { projectBudgetState, budgetVersionsState, procurementsState } = vi.hoisted(() => ({
  projectBudgetState: { data: 100000 as number | undefined, isPending: false, isError: false },
  budgetVersionsState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  procurementsState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
}));

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => projectBudgetState,
  useBudgetVersions: () => budgetVersionsState,
}));

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procurementsState,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

import OverviewTab from '../OverviewTab';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// ---------------------------------------------------------------------------
// Helper: minimal ProjectWithRefs with stored budget = 0
// ---------------------------------------------------------------------------
function makeProject(overrides: Partial<ProjectWithRefs> = {}): ProjectWithRefs {
  return {
    id: 'proj-001',
    org_id: 'org-001',
    name: 'Test Project',
    status: 'Ongoing Project',
    contract_value: 200000,
    budget: 0,        // THE BUG: stored column is 0
    spent: 0,
    code: null,
    customer_contract_ref: null,
    start_date: null,
    end_date: null,
    client_id: null,
    client: null,
    project_manager_id: null,
    pm: null,
    created_at: new Date().toISOString(),
    updated_at: null,
    decided_at: null,
    archived_at: null,
    ...overrides,
  } as unknown as ProjectWithRefs;
}

describe('AC-W2-1-FE-01: OverviewTab budget basis', () => {
  beforeEach(() => {
    projectBudgetState.data = 100000;
    projectBudgetState.isPending = false;
    projectBudgetState.isError = false;
  });

  it('shows derived budget (100,000) not stored column (0) in Budget utilization card', () => {
    render(
      <OverviewTab
        project={makeProject()}
        committedSpend={95000}
      />,
    );

    // The utilization text should show committed of DERIVED budget, not stored 0.
    // Before fix: "$95,000 of $0 budget committed"
    // After fix:  "$95,000 of $100,000 budget committed"
    expect(screen.getByText(/\$100,000/)).toBeInTheDocument();
    expect(screen.queryByText(/of \$0 budget/i)).not.toBeInTheDocument();
  });

  it('shows At risk pill when derived util% >= 90% (95k/100k = 95%)', () => {
    render(
      <OverviewTab
        project={makeProject()}
        committedSpend={95000}
      />,
    );

    // At-risk pill must appear when committed/derived-budget >= 0.9.
    // Before fix: stored budget=0 → util% = 0 → pill hidden.
    // After fix: derived budget=100,000 → 95% → pill shown.
    expect(screen.getByText('At risk')).toBeInTheDocument();
  });

  it('does NOT show At risk pill when stored budget=0 but derived budget=0 (no line-items)', () => {
    projectBudgetState.data = 0;

    render(
      <OverviewTab
        project={makeProject()}
        committedSpend={95000}
      />,
    );

    // When derived budget is also 0 (no active version), at-risk should not fire.
    expect(screen.queryByText('At risk')).not.toBeInTheDocument();
  });
});
