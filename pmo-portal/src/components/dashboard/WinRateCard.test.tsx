import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { WinRateCard } from './WinRateCard';
import i18next from 'i18next';
import idCommon from '../../../public/locales/id/common.json';
import idDashboard from '../../../public/locales/id/dashboard.json';

const populatedOracle = {
  wins_count: 2, losses_count: 1, wins_value: 8_000_000, losses_value: 650_000,
  win_rate_count: 0.666667, win_rate_value: 0.924855,
  value_by_currency: [
    { currency: 'USD', wins_value: 8_000_000, losses_value: 650_000, win_rate_value: 0.924855 },
  ],
};
const zeroOracle = {
  wins_count: 0, losses_count: 0, wins_value: 0, losses_value: 0,
  win_rate_count: 0, win_rate_value: 0,
};

type Oracle = Omit<typeof populatedOracle, 'value_by_currency'> & {
  value_by_currency?: Array<{ currency: string; wins_value: number; losses_value: number; win_rate_value: number | null }>;
  declined_count?: number;
};
let oracle: Oracle = populatedOracle;
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

  it('AC-1117: defaults to count basis and uses the RPC currency row for value basis', () => {
    render(<WinRateCard currency="USD" />);
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    // S6: value mode keeps the figure + bar form; only the numbers change.
    const usd = screen.getByTestId('win-rate-value-USD');
    expect(within(usd).getByText('92.5%')).toBeInTheDocument();
    expect(within(usd).getByRole('progressbar', { name: 'USD win rate 92.5%' })).toHaveAttribute('aria-valuenow', '92');
    fireEvent.click(screen.getByTestId('win-rate-toggle-count'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
  });

  it('retains aggregate value-rate rendering for legacy RPC payloads without currency rows', () => {
    const { value_by_currency: _rows, ...legacyPayload } = populatedOracle;
    oracle = legacyPayload;
    render(<WinRateCard currency="USD" />);
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('92.5%');
    expect(screen.queryByTestId('win-rate-value-breakdown')).not.toBeInTheDocument();
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
    const idr = screen.getByTestId('win-rate-value-IDR');
    // C7: the percent is never prefixed by a currency; the currency names the bar.
    expect(within(idr).getByText('92.5%')).toBeInTheDocument();
    expect(idr).not.toHaveTextContent(/IDR\s*92\.5%/);
    expect(idr).toHaveTextContent(/IDR 8M won of IDR 8\.7M closed/);
    expect(within(idr).getByRole('progressbar', { name: 'IDR win rate 92.5%' })).toBeInTheDocument();
    // C7: a currency with no recorded loss has no measurable rate, so it gets no trivial 100% line.
    expect(screen.queryByTestId('win-rate-value-USD')).toBeNull();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });

  it('S6: value mode draws one bar per currency with a measurable rate', () => {
    oracle = {
      ...populatedOracle,
      value_by_currency: [
        { currency: 'IDR', wins_value: 8_000_000, losses_value: 650_000, win_rate_value: 0.924855 },
        { currency: 'USD', wins_value: 3_000, losses_value: 1_000, win_rate_value: 0.75 },
      ],
    };
    render(<WinRateCard currency="USD" />);
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.getByRole('progressbar', { name: 'IDR win rate 92.5%' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'USD win rate 75.0%' })).toHaveAttribute('aria-valuenow', '75');
    expect(screen.getByTestId('win-rate-value-USD')).toHaveTextContent(/\$3K won of \$4K closed/);
    expect(screen.getByText('Won')).toBeInTheDocument();
  });

  it('C7: value mode with no measurable currency says so once instead of drawing empty bars', () => {
    oracle = {
      ...populatedOracle,
      value_by_currency: [{ currency: 'USD', wins_value: 1_000, losses_value: 0, win_rate_value: null }],
    };
    render(<WinRateCard currency="USD" />);
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('No recorded losses yet, so a win rate by value cannot be measured.')).toBeInTheDocument();
  });

  it('AC-1106: renders the currency breakdown with Indonesian catalogue copy', async () => {
    i18next.addResourceBundle('id', 'common', idCommon, true, true);
    i18next.addResourceBundle('id', 'dashboard', idDashboard, true, true);
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
    try {
      render(<WinRateCard currency="USD" />);
      fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
      expect(screen.getByTestId('win-rate-value-IDR')).toHaveTextContent(/menang dari/);
      expect(screen.getByRole('progressbar', { name: 'Tingkat kemenangan IDR 92.5%' })).toBeInTheDocument();
    } finally {
      await i18next.changeLanguage('en');
    }
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

  it('uses a heading without a second card frame when embedded in an area panel', () => {
    const { container } = render(<WinRateCard currency="USD" embedded />);
    const section = screen.getByRole('region', { name: 'Win rate' });
    expect(section).not.toHaveClass('rounded-lg', 'border');
    expect(screen.getByRole('heading', { name: 'Win rate', level: 3 })).toBeInTheDocument();
    expect(container.querySelector('section.rounded-lg.border')).toBeNull();
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
    oracle = { ...populatedOracle, declined_count: 3 };
    render(<WinRateCard currency="USD" />);
    expect(screen.getByTestId('win-rate-declined')).toHaveTextContent('3 declined to bid');
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
  });

  it('AC-DEC-002: when ONLY declined deals exist in the window, the declined count shows instead of being hidden', () => {
    oracle = { ...zeroOracle, declined_count: 2 };
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
