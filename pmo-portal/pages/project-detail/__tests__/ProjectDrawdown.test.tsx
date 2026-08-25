/**
 * ProjectDrawdown — the card the PM manages by (#566 / OD-CR-13).
 *
 * The states that matter are the ones the ticket exists to provide: the figures with their tax
 * basis on every one of them (OD-TAX-1), and over-commitment made VISIBLE in its two distinct
 * shapes. Loading and error are here too, because a "0 of 0" in place of either would be a
 * plausible number where a non-answer belongs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { ProjectDrawdown as Drawdown } from '@/src/lib/db/workOrders';

const state: {
  data: Drawdown | null;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = { data: null, isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectDrawdown: () => state,
}));

import ProjectDrawdown from '../ProjectDrawdown';

const drawdown = (over: Partial<Drawdown> = {}): Drawdown => ({
  committed: 500_000,
  draft: 100_000,
  ceiling: 900_000,
  currency: 'USD',
  basis: 'net',
  ...over,
});

beforeEach(() => {
  state.data = drawdown();
  state.isPending = false;
  state.isError = false;
  state.refetch.mockClear();
});

describe('async states', () => {
  it('renders a skeleton while the drawdown is loading, and no figures', () => {
    state.isPending = true;
    state.data = null;
    render(<ProjectDrawdown projectId="p1" />);
    expect(screen.getByTestId('drawdown-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('drawdown-ceiling')).not.toBeInTheDocument();
  });

  it('renders an error with a retry when the read fails', async () => {
    state.isError = true;
    state.data = null;
    render(<ProjectDrawdown projectId="p1" />);
    expect(screen.getByText("Couldn't load the drawdown")).toBeInTheDocument();
    expect(screen.queryByTestId('drawdown-committed')).not.toBeInTheDocument();
  });

  it('treats a NULL drawdown as an error, never as a zero ceiling', () => {
    // The RPC returns zero rows for a project the caller cannot see. Rendering "$0 of $0" there
    // would put a plausible number where an error belongs (#508).
    state.data = null;
    render(<ProjectDrawdown projectId="p1" />);
    expect(screen.getByText("Couldn't load the drawdown")).toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
  });
});

describe('the figures', () => {
  it('shows the ceiling, the issued drawdown, the draft pipeline and the headroom', () => {
    render(<ProjectDrawdown projectId="p1" />);
    expect(screen.getByTestId('drawdown-ceiling')).toHaveTextContent('$900,000');
    expect(screen.getByTestId('drawdown-committed')).toHaveTextContent('$500,000');
    expect(screen.getByTestId('drawdown-draft')).toHaveTextContent('$100,000');
    // headroom = ceiling - committed, the number a PM decides the next work order against.
    expect(screen.getByTestId('drawdown-headroom')).toHaveTextContent('$400,000');
  });

  it('OD-TAX-1: every figure carries its tax basis — no bare number', () => {
    render(<ProjectDrawdown projectId="p1" />);
    for (const id of [
      'drawdown-ceiling',
      'drawdown-committed',
      'drawdown-draft',
      'drawdown-headroom',
    ]) {
      expect(screen.getByTestId(id)).toHaveTextContent('net of tax');
    }
  });

  it('says so when there is no ceiling yet, instead of drawing a bar against zero', () => {
    state.data = drawdown({ ceiling: 0, committed: 0, draft: 0 });
    render(<ProjectDrawdown projectId="p1" />);
    expect(screen.getByTestId('drawdown-no-ceiling')).toBeInTheDocument();
  });
});

describe('over-commitment is visible, never silent', () => {
  it('flags an ALREADY over-committed project and states the overage as its own figure', () => {
    state.data = drawdown({ committed: 1_000_000, draft: 0, ceiling: 900_000 });
    render(<ProjectDrawdown projectId="p1" />);
    expect(screen.getByTestId('drawdown-over-committed')).toBeInTheDocument();
    expect(screen.getByTestId('drawdown-over-amount')).toHaveTextContent('$100,000');
    // The headroom is negative and says so rather than clamping to zero.
    expect(screen.getByTestId('drawdown-headroom')).toHaveTextContent('-$100,000');
    expect(screen.queryByTestId('drawdown-would-over-commit')).not.toBeInTheDocument();
  });

  it('warns when issued FITS but issuing every draft would not — the pre-emptive half', () => {
    state.data = drawdown({ committed: 800_000, draft: 250_000, ceiling: 900_000 });
    render(<ProjectDrawdown projectId="p1" />);
    expect(screen.getByTestId('drawdown-would-over-commit')).toBeInTheDocument();
    // committed + draft - ceiling = 150,000
    expect(screen.getByTestId('drawdown-would-over-amount')).toHaveTextContent('$150,000');
    expect(screen.queryByTestId('drawdown-over-committed')).not.toBeInTheDocument();
  });

  it('shows neither warning when everything fits under the ceiling', () => {
    render(<ProjectDrawdown projectId="p1" />);
    expect(screen.queryByTestId('drawdown-over-committed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drawdown-would-over-commit')).not.toBeInTheDocument();
  });

  it('a draft that exactly reaches the ceiling is NOT an over-commitment (the boundary)', () => {
    state.data = drawdown({ committed: 800_000, draft: 100_000, ceiling: 900_000 });
    render(<ProjectDrawdown projectId="p1" />);
    expect(screen.queryByTestId('drawdown-would-over-commit')).not.toBeInTheDocument();
    expect(screen.getByTestId('drawdown-headroom')).toHaveTextContent('$100,000');
  });
});
