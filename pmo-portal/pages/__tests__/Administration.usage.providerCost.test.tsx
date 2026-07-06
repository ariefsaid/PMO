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

const orgAdminRow: UsageSummaryRow = {
  owner_id: 'u1',
  action: 'chat',
  month: '2026-07-01',
  run_count: 3,
  prompt_tokens: 100,
  completion_tokens: 40,
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
  provider_cost_usd: 0.03,
  cost: 0.1,
  margin_usd: null,
};

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
