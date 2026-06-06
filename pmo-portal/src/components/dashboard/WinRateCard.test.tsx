import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WinRateCard } from './WinRateCard';

const populatedOracle = {
  wins_count: 2, losses_count: 1, wins_value: 8_000_000, losses_value: 650_000,
  win_rate_count: 0.666667, win_rate_value: 0.924855,
};
const zeroOracle = {
  wins_count: 0, losses_count: 0, wins_value: 0, losses_value: 0,
  win_rate_count: 0, win_rate_value: 0,
};

let oracle: typeof populatedOracle = populatedOracle;
let lastRange: { key: string } | null = null;

vi.mock('@/src/hooks/useDashboard', async (orig) => {
  const actual = await orig<typeof import('@/src/hooks/useDashboard')>();
  return {
    ...actual,
    useWinRate: (range: { key: string }) => {
      lastRange = range;
      return { data: oracle, isPending: false, isError: false, refetch: vi.fn() };
    },
  };
});

describe('WinRateCard (AC-1117 — preserve win-rate logic, re-skin chrome)', () => {
  beforeEach(() => { lastRange = null; oracle = populatedOracle; });

  it('AC-1117: defaults to count basis (66.7%) and toggles to value (92.5%)', () => {
    render(<WinRateCard />);
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('92.5%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-count'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
  });

  it('AC-1117: changing the period re-queries with a new range key', () => {
    render(<WinRateCard />);
    const initial = lastRange?.key;
    fireEvent.click(screen.getByTestId('win-rate-period-q'));
    expect(lastRange?.key).not.toBe(initial);
  });

  it('announces the rate politely and groups the basis + frame segs for a11y', () => {
    render(<WinRateCard />);
    expect(screen.getByTestId('kpi-win-rate')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('tablist', { name: /Win-rate basis/i })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /Time frame/i })).toBeInTheDocument();
  });

  it('renders a basis-aware won/closed readout and a Won/Lost dot+text legend', () => {
    render(<WinRateCard />);
    expect(screen.getByText(/2 won of 3 closed/i)).toBeInTheDocument();
    expect(screen.getByText('Won')).toBeInTheDocument();
    expect(screen.getByText('Lost')).toBeInTheDocument();
  });

  it('shows an empty message (not a fabricated 0%) when there are no closed deals', () => {
    oracle = zeroOracle;
    render(<WinRateCard />);
    expect(screen.getByText(/No closed deals in this window/i)).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-win-rate')).toBeNull();
  });
});
