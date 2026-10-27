/**
 * AC-USE-007 — Usage section Provider-cost column is Operator-only (owner decision, ops-admin
 * Discover round 2026-07-06). `provider_cost_usd` is PMO's raw provider spend (the markup); the
 * org-Admin-facing summary must never show it next to credits-spent. `AdministrationUsage` renders
 * the "Provider cost" column ONLY when given Operator rows (which carry `provider_cost_usd`); the
 * org-Admin rows (from `org_usage_summary`, AC-USE-007) never carry the field at all, so the column
 * is structurally absent — not merely hidden by data.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { AdministrationUsage } from '../AdministrationUsage';
import type { UsageSummaryRow, OperatorUsageSummaryRow } from '@/src/lib/db/usage';

// AC-L10N-021 (FR-L10N-023): platform AI billing is USD and must NOT follow the org currency —
// even in an IDR org these figures stay `$…`. Mock the org hook to IDR so any regression that
// swaps PLATFORM_CURRENCY for useOrgCurrency() reddens here (binding proven by mutation M3).
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));

const orgAdminRow: UsageSummaryRow = {
  owner_id: 'u1',
  action: 'chat',
  month: '2026-07-01',
  run_count: 3,
  prompt_tokens: 100,
  completion_tokens: 40,
  cached_tokens: 0,
  reasoning_tokens: 0,
  cost: 0.1,
  margin_usd: null,
};

const operatorRow: OperatorUsageSummaryRow = {
  org_id: 'org-1',
  owner_id: 'u1',
  action: 'chat',
  month: '2026-07-01',
  run_count: 3,
  prompt_tokens: 100,
  completion_tokens: 40,
  cached_tokens: 0,
  reasoning_tokens: 0,
  provider_cost_usd: 0.03,
  cost: 0.1,
  margin_usd: null,
};

describe('AdministrationUsage — a null provider cost renders as unknown, not zero', () => {
  /**
   * Regression for a defect the `database.types.ts` resync exposed. The cell guarded on
   * `'provider_cost_usd' in r` — key PRESENCE — which does not test null. The RPC returns null
   * when provider pricing is unconfigured, and formatting null yields "$0.00": a real-looking
   * zero standing in for "unknown", on a money column.
   *
   * The generated types hid this by declaring the column non-null — Postgres `RETURNS TABLE`
   * carries no nullability, so the generator over-promises for every set-returning function.
   */
  it('shows an em-dash, never $0.00, when provider_cost_usd is null', () => {
    const nullCost = { ...operatorRow, provider_cost_usd: null } as OperatorUsageSummaryRow;
    render(<AdministrationUsage rows={[nullCost]} isPending={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.getByRole('columnheader', { name: /provider cost/i })).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('AdministrationUsage — Provider-cost column is Operator-only (AC-USE-007)', () => {
  it('does not render a Provider-cost column for org-Admin rows (org_usage_summary has no provider_cost_usd)', () => {
    render(<AdministrationUsage rows={[orgAdminRow]} isPending={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.queryByRole('columnheader', { name: /provider cost/i })).not.toBeInTheDocument();
  });

  it('renders the Provider-cost column for Operator rows (operator_usage_summary keeps provider_cost_usd)', () => {
    render(<AdministrationUsage rows={[operatorRow]} isPending={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.getByRole('columnheader', { name: /provider cost/i })).toBeInTheDocument();
  });
});

describe('AdministrationUsage — AC-L10N-021 (FR-L10N-023): platform AI billing stays USD in an IDR org', () => {
  it('provider cost / credits spent / margin render `$…` even when the org currency is IDR', () => {
    const idrOrgRows = [{ ...operatorRow, provider_cost_usd: 0.03, cost: 0.1, margin_usd: 0.07 } as OperatorUsageSummaryRow];
    render(<AdministrationUsage rows={idrOrgRows} isPending={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.getByText('$0.03')).toBeInTheDocument();
    expect(screen.getByText('$0.10')).toBeInTheDocument();
    expect(screen.getByText('$0.07')).toBeInTheDocument();
    // and never the org currency — an IDR re-denomination is the silent wrong figure
    expect(screen.queryByText(/IDR/)).not.toBeInTheDocument();
  });
});
