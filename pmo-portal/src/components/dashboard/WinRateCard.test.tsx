import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WinRateCard } from './WinRateCard';
import i18next from 'i18next';
import idCommon from '../../../public/locales/id/common.json';

const populatedOracle = {
  wins_count: 2, losses_count: 1, wins_value: 8_000_000, losses_value: 650_000,
  win_rate_count: 0.666667, win_rate_value: 0.924855,
};
const zeroOracle = {
  wins_count: 0, losses_count: 0, wins_value: 0, losses_value: 0,
  win_rate_count: 0, win_rate_value: 0,
};

let oracle: typeof populatedOracle & { value_by_currency?: Array<{ currency: string; wins_value: number; losses_value: number; win_rate_value: number | null }> } = populatedOracle;
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
    render(<WinRateCard currency="USD" />);
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('92.5%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-count'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
  });

  it('AC-1106: renders mixed-currency value rates separately and labels unmeasured loss rate', () => {
    oracle = {
      ...populatedOracle,
      wins_value: null as unknown as number,
      losses_value: null as unknown as number,
      win_rate_value: null as unknown as number,
      value_by_currency: [
        { currency: 'IDR', wins_value: 8_000_000, losses_value: 650_000, win_rate_value: 0.924855 },
        { currency: 'USD', wins_value: 1_000, losses_value: 0, win_rate_value: null },
      ],
    };
    render(<WinRateCard currency="USD" />);
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.getByTestId('win-rate-value-IDR')).toHaveTextContent(/IDR.*92\.5%.*won of.*closed/i);
    expect(screen.getByTestId('win-rate-value-USD')).toHaveTextContent(/USD.*No recorded losses/i);
    expect(screen.queryByTestId('kpi-win-rate')).toBeNull();
  });

  it('AC-1106: renders the currency breakdown with Indonesian catalogue copy', async () => {
    i18next.addResourceBundle('id', 'common', idCommon, true, true);
    await i18next.changeLanguage('id');
    oracle = {
      ...populatedOracle,
      wins_value: null as unknown as number,
      losses_value: null as unknown as number,
      win_rate_value: null as unknown as number,
      value_by_currency: [
        { currency: 'IDR', wins_value: 8_000_000, losses_value: 650_000, win_rate_value: 0.924855 },
        { currency: 'USD', wins_value: 1_000, losses_value: 0, win_rate_value: null },
      ],
    };
    render(<WinRateCard currency="USD" />);
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.getByTestId('win-rate-value-IDR')).toHaveTextContent('IDR 92.5%');
    expect(screen.getByTestId('win-rate-value-USD')).toHaveTextContent(/USD — belum ada kekalahan tercatat/i);
    await i18next.changeLanguage('en');
  });

  it('AC-1117: changing the period re-queries with a new range key', () => {
    render(<WinRateCard currency="USD" />);
    const initial = lastRange?.key;
    fireEvent.click(screen.getByTestId('win-rate-period-q'));
    expect(lastRange?.key).not.toBe(initial);
  });

  it('announces the rate politely and groups the basis + frame segs for a11y', () => {
    render(<WinRateCard currency="USD" />);
    expect(screen.getByTestId('kpi-win-rate')).toHaveAttribute('aria-live', 'polite');
    // W2-10: WinRateCard uses semantics="toggle" (no tabpanel) → role="group" + aria-pressed
    expect(screen.getByRole('group', { name: /Win-rate basis/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Time frame/i })).toBeInTheDocument();
  });

  it('AC-RF-004: limits the metric to recorded outcomes and keeps a basis-aware readout', () => {
    render(<WinRateCard currency="USD" />);
    expect(screen.getByText(/2 won of 3 closed/i)).toBeInTheDocument();
    expect(screen.getByText('Won')).toBeInTheDocument();
    expect(screen.getByText('Lost')).toBeInTheDocument();
    expect(screen.getByText('Recorded outcomes only; unrecorded decisions are not counted.')).toBeInTheDocument();
  });

  // AC-DEC-002 (#774): declined-to-bid deals sit outside both denominators but are still reported.
  it('AC-DEC-002: shows the declined count beside the rate without changing the rate', () => {
    oracle = { ...populatedOracle, declined_count: 3 } as typeof populatedOracle;
    render(<WinRateCard currency="USD" />);
    expect(screen.getByTestId('win-rate-declined')).toHaveTextContent('3 declined to bid');
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
  });

  it('AC-DEC-002: when ONLY declined deals exist in the window, the declined count shows instead of being hidden', () => {
    oracle = { ...zeroOracle, declined_count: 2 } as typeof populatedOracle;
    render(<WinRateCard currency="USD" />);
    expect(screen.getByText(/No closed projects in this window/i)).toBeInTheDocument();
    expect(screen.getByTestId('win-rate-declined')).toHaveTextContent('2 declined to bid');
  });

  it('AC-DEC-002: no declined line when there are none', () => {
    render(<WinRateCard currency="USD" />);
    expect(screen.queryByTestId('win-rate-declined')).toBeNull();
  });

  it('shows an empty message (not a fabricated 0%) when there are no closed projects', () => {
    oracle = zeroOracle;
    render(<WinRateCard currency="USD" />);
    expect(screen.getByText(/No closed projects in this window/i)).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-win-rate')).toBeNull();
  });
});
