/**
 * B-0.3 — FinanceDashboard Budget review must show an error/retry branch on RPC
 * failure, NOT the "No project spend yet" empty state (false-empty).
 * AC-B-0-3: isError → ListState error with Retry; NOT "No project spend yet".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const { budgetReviewState } = vi.hoisted(() => ({
  budgetReviewState: {
    data: undefined as unknown[] | undefined,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({
    data: {
      active_projects: 0, total_contract_value: 0,
      on_hand_margin: 0, on_hand_value: 0,
      pipeline_weighted_value: 0, pipeline_projected_margin: 0, pipeline_total_value: 0,
      projects_at_risk: 0, projects_by_status: [], procurements_by_status: [],
      top_projects: [],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useFinanceBudgetReview: () => budgetReviewState,
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Finance' }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'fin-1', org_id: 'org-1' }, role: 'Finance' }),
}));

import { FinanceDashboard } from '../FinanceDashboard';

const renderPane = () => render(<MemoryRouter><FinanceDashboard /></MemoryRouter>);

describe('AC-B-0-3: FinanceDashboard Budget review error state', () => {
  it('AC-B-0-3: on RPC error, shows "Couldn\'t load budget review" (not "No project spend yet")', () => {
    budgetReviewState.isError = true;
    budgetReviewState.data = undefined;

    renderPane();

    expect(screen.getByText(/Couldn't load budget review/i)).toBeInTheDocument();
    expect(screen.queryByText(/No project spend yet/i)).toBeNull();
  });

  it('AC-B-0-3: on RPC error, shows a Retry affordance that calls refetch', () => {
    const refetch = vi.fn();
    budgetReviewState.isError = true;
    budgetReviewState.data = undefined;
    budgetReviewState.refetch = refetch;

    renderPane();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalled();
  });

  it('AC-B-0-3: no error → shows "No project spend yet" when data is empty (correct empty state)', () => {
    budgetReviewState.isError = false;
    budgetReviewState.data = [];

    renderPane();

    expect(screen.getByText(/No project spend yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load budget review/i)).toBeNull();
  });
});
