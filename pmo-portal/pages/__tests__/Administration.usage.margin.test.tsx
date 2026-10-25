/**
 * AC-USE-003 — Usage section margin column (ops-admin-surface S5). Renders the Usage section
 * with margin_usd all-null -> the column is absent and a "Pricing not yet configured" note
 * shows; with at least one non-null margin -> the column renders the computed value. Sourced
 * ONLY from the usage RPCs (the privacy line, NFR-PRIV-001).
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { AdministrationUsage } from '../AdministrationUsage';
import type { UsageSummaryRow } from '@/src/lib/db/usage';
import type { AgentCostRunStatsRow } from '@/src/components/admin/AgentCostMetrics';

const baseRow: UsageSummaryRow = {
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
const baseRunStats: AgentCostRunStatsRow = {
  action: 'chat',
  month: '2026-07-01',
  runs: 3,
  avg_rounds: 1,
  p50_cost: 0.01,
  p95_cost: 0.02,
  max_cost: 0.02,
  cache_hit_pct: 0,
  p50_ms: 100,
  p95_ms: 200,
};

const CurrentUrl: React.FC = () => {
  const location = useLocation();
  return <output data-testid="current-url">{location.pathname}{location.search}{location.hash}</output>;
};

const renderUsage = (ui: React.ReactElement, initialEntry = '/administration/usage') =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CurrentUrl />
      {ui}
    </MemoryRouter>,
  );

describe('AdministrationUsage — margin column (AC-USE-003)', () => {
  it('hides the margin column and shows a "pricing not yet configured" note when every row has margin_usd = null', () => {
    renderUsage(<AdministrationUsage rows={[baseRow, { ...baseRow, action: 'compose' }]} isPending={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.queryByRole('columnheader', { name: /margin/i })).not.toBeInTheDocument();
    expect(screen.getByText(/pricing not yet configured/i)).toBeInTheDocument();
  });

  it('renders the margin column with the computed value when at least one row has a non-null margin_usd', () => {
    renderUsage(
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
    renderUsage(<AdministrationUsage rows={[]} isPending isError={false} onRetry={vi.fn()} />);
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('shows an error state with retry on RPC failure', () => {
    const onRetry = vi.fn();
    renderUsage(<AdministrationUsage rows={[]} isPending={false} isError onRetry={onRetry} />);
    expect(screen.getByText(/couldn't load usage/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no usage rows', () => {
    renderUsage(<AdministrationUsage rows={[]} isPending={false} isError={false} onRetry={vi.fn()} />);
    expect(screen.getByText(/no usage yet/i)).toBeInTheDocument();
  });

  it('filters the monthly table by period and action, with a clear recovery for no matches', () => {
    renderUsage(
      <AdministrationUsage
        rows={[
          baseRow,
          { ...baseRow, month: '2026-08-01', action: 'compose' },
          { ...baseRow, month: '2026-09-01', action: 'chat' },
        ]}
        runStatsRows={[baseRunStats]}
        isPending={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'chat' } });
    expect(screen.getByText(/no usage matches/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Diagnostics'));
    expect(screen.getByText(/no agent cost data yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('2026-08-01');
    expect(table).toHaveTextContent('2026-09-01');
    expect(table).toHaveTextContent('2026-07-01');
    expect(table.textContent!.indexOf('2026-09-01')).toBeLessThan(table.textContent!.indexOf('2026-07-01'));

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'oldest' } });
    expect(table.textContent!.indexOf('2026-07-01')).toBeLessThan(table.textContent!.indexOf('2026-09-01'));
  });

  it('puts diagnostics behind a collapsed disclosure after the consumption table', () => {
    renderUsage(
      <AdministrationUsage rows={[baseRow]} isPending={false} isError={false} onRetry={vi.fn()} />,
    );

    const diagnostics = screen.getByText('Diagnostics').closest('details');
    expect(diagnostics).not.toHaveAttribute('open');
    expect(screen.getByRole('columnheader', { name: 'Month' })).toBeInTheDocument();
    expect(diagnostics).toBeInTheDocument();
  });

  it('stores period and action state in the URL while preserving unrelated query and hash state', () => {
    renderUsage(
      <AdministrationUsage rows={[baseRow]} isPending={false} isError={false} onRetry={vi.fn()} />,
      '/administration/usage?keep=1#scope',
    );

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'chat' } });
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'oldest' } });
    expect(screen.getByTestId('current-url')).toHaveTextContent('keep=1');
    expect(screen.getByTestId('current-url')).toHaveTextContent('period=2026-07-01');
    expect(screen.getByTestId('current-url')).toHaveTextContent('action=chat');
    expect(screen.getByTestId('current-url')).toHaveTextContent('sort=oldest');
    expect(screen.getByTestId('current-url')).toHaveTextContent('#scope');
  });
});
