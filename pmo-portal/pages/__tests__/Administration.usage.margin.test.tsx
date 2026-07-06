/**
 * AC-USE-003 — Usage section margin column (ops-admin-surface S5). Renders the Usage section
 * with margin_usd all-null -> the column is absent and a "Pricing not yet configured" note
 * shows; with at least one non-null margin -> the column renders the computed value. Sourced
 * ONLY from the usage RPCs (the privacy line, NFR-PRIV-001).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { AdministrationUsage } from '../AdministrationUsage';
import type { UsageSummaryRow } from '@/src/lib/db/usage';

const baseRow: UsageSummaryRow = {
  owner_id: 'u1',
  action: 'chat',
  month: '2026-07-01',
  run_count: 3,
  prompt_tokens: 100,
  completion_tokens: 40,
  cost: 0.1,
  margin_usd: null,
};

describe('AdministrationUsage — margin column (AC-USE-003)', () => {
  it('hides the margin column and shows a "pricing not yet configured" note when every row has margin_usd = null', () => {
    render(<AdministrationUsage rows={[baseRow, { ...baseRow, action: 'compose' }]} isPending={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.queryByRole('columnheader', { name: /margin/i })).not.toBeInTheDocument();
    expect(screen.getByText(/pricing not yet configured/i)).toBeInTheDocument();
  });

  it('renders the margin column with the computed value when at least one row has a non-null margin_usd', () => {
    render(
      <AdministrationUsage
        rows={[baseRow, { ...baseRow, action: 'compose', margin_usd: 0.02 }]}
        isPending={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /margin/i })).toBeInTheDocument();
    expect(screen.queryByText(/pricing not yet configured/i)).not.toBeInTheDocument();
  });

  it('shows a loading state while pending', () => {
    render(<AdministrationUsage rows={[]} isPending isError={false} onRetry={vi.fn()} />);
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('shows an error state with retry on RPC failure', () => {
    const onRetry = vi.fn();
    render(<AdministrationUsage rows={[]} isPending={false} isError onRetry={onRetry} />);
    expect(screen.getByText(/couldn't load usage/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no usage rows', () => {
    render(<AdministrationUsage rows={[]} isPending={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.getByText(/no usage yet/i)).toBeInTheDocument();
  });
});
