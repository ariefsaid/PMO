/**
 * AC-W2-3-02: OverviewTab start/end dates do NOT day-shift in behind-UTC timezones.
 *
 * The local fmtDate helper (deleted by the fix) used `new Date(iso).toLocaleDateString()`.
 * For pure YYYY-MM-DD strings, `new Date("2026-06-14")` parses as UTC midnight — in a
 * behind-UTC zone this becomes the previous day. The fix routes through `formatDate`
 * from `@/src/lib/format`, which parses date-only at LOCAL midnight (`${iso}T00:00:00`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ── Hoist mock state ──────────────────────────────────────────────────────────
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

function makeProject(overrides: Partial<ProjectWithRefs> = {}): ProjectWithRefs {
  return {
    id: 'proj-tz',
    org_id: 'org-001',
    name: 'TZ Test',
    status: 'Ongoing Project',
    contract_value: 500000,
    budget: 0,
    spent: 0,
    code: null,
    customer_contract_ref: null,
    client_id: null,
    client: null,
    project_manager_id: null,
    pm: null,
    contract_date: null,
    archived_at: null,
    ...overrides,
  } as unknown as ProjectWithRefs;
}

describe('AC-W2-3-02: OverviewTab start/end dates — no UTC day-shift', () => {
  beforeEach(() => {
    projectBudgetState.data = 100000;
    budgetVersionsState.data = [];
    procurementsState.data = [];
  });

  it('renders start_date 2026-06-14 as "Jun 14, 2026" (not Jun 13 behind UTC)', () => {
    render(
      <OverviewTab
        project={makeProject({ start_date: '2026-06-14', end_date: '2026-12-31' })}
        committedSpend={0}
      />,
    );

    // Start date must display the correct local calendar day.
    expect(screen.getByText('Jun 14, 2026')).toBeInTheDocument();
    // The UTC-shifted day must NOT appear.
    expect(screen.queryByText('Jun 13, 2026')).not.toBeInTheDocument();
  });

  it('renders end_date 2026-12-31 as "Dec 31, 2026" (not Dec 30 behind UTC)', () => {
    render(
      <OverviewTab
        project={makeProject({ start_date: '2026-01-01', end_date: '2026-12-31' })}
        committedSpend={0}
      />,
    );

    expect(screen.getByText('Dec 31, 2026')).toBeInTheDocument();
    expect(screen.queryByText('Dec 30, 2026')).not.toBeInTheDocument();
  });
});
