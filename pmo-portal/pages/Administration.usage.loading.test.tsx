import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

type Q = { data: unknown[] | undefined; isPending: boolean; isError: boolean; refetch: () => Promise<unknown> };
const h = vi.hoisted(() => ({ usage: undefined as unknown, runs: undefined as unknown }));
vi.mock('@/src/hooks/useUsage', () => ({ useUsage: () => h.usage, useAgentRunStats: () => h.runs }));
// Administration.tsx pulls in every admin section; only the usage panel is under test here.
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u', org_id: 'o' } }) }));

import { UsagePanel } from './Administration';

const usageRow = { month: '2026-10-01', action: 'chat', run_count: 3, prompt_tokens: 1000, completion_tokens: 200, cached_tokens: 600, reasoning_tokens: 40, cost: 0.5, margin_usd: null };
const runRow = { action: 'chat', month: '2026-10-01', runs: 3, avg_rounds: 2, p50_cost: 0.1, p95_cost: 0.2, max_cost: 0.3, cache_hit_pct: 60, p50_ms: 900, p95_ms: 2200 };
const q = (over: Partial<Q>): Q => ({ data: [], isPending: false, isError: false, refetch: vi.fn().mockResolvedValue(undefined), ...over });

beforeEach(() => { h.usage = q({ data: [usageRow] }); h.runs = q({ data: [runRow] }); });

describe('AC-NBR-035 usage panel loads per read', () => {
  it('(P) run stats pending: the table and usage tiles render; only the run-stat tiles show loading', () => {
    h.runs = q({ data: undefined, isPending: true });
    render(<UsagePanel />);
    expect(screen.getByRole('columnheader', { name: 'Action' })).toBeInTheDocument();
    expect(screen.getByText('chat')).toBeInTheDocument();
    const tiles = within(screen.getByTestId('stat-tiles'));
    expect(tiles.getByText('Cache hit-rate')).toBeVisible();
    expect(tiles.getByText('60%')).toBeVisible();
    expect(screen.getAllByTestId('agent-cost-run-loading').length).toBe(3);
    expect(screen.queryByText('2.2s')).not.toBeInTheDocument();
  });

  it('(F) run stats failed: the table and usage tiles render; the run-stat tiles say they are unavailable', () => {
    h.runs = q({ data: undefined, isError: true });
    render(<UsagePanel />);
    expect(screen.getByText('chat')).toBeInTheDocument();
    expect(within(screen.getByTestId('stat-tiles')).getByText('60%')).toBeVisible();
    expect(screen.getAllByTestId('agent-cost-run-unavailable').length).toBe(3);
    expect(screen.queryByText("Couldn't load usage")).not.toBeInTheDocument();
  });

  it('(P) usage pending: the run stats do not stand in for the usage table', () => {
    h.usage = q({ data: undefined, isPending: true });
    render(<UsagePanel />);
    expect(screen.queryByText('chat')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
  });

  it('AC-NBR-091 usage empty while run stats are pending does not conclude "no agent cost data"', () => {
    h.usage = q({ data: [] });
    h.runs = q({ data: undefined, isPending: true });
    render(<UsagePanel />);
    expect(screen.queryByText('No agent cost data yet')).not.toBeInTheDocument();
  });
});
