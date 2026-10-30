import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { WinRateCard } from './WinRateCard';
import i18next from 'i18next';
import idDashboard from '../../../public/locales/id/dashboard.json';

const populatedOracle = {
  wins_count: 2, losses_count: 1, wins_value: 8_000_000, losses_value: 650_000,
  win_rate_count: 0.666667, win_rate_value: 0.924855,
  value_by_currency: [
    { currency: 'USD', wins_value: 8_000_000, losses_value: 650_000, win_rate_value: 0.924855 },
  ],
  open_count: 3,
  stale_count: 1,
  bids_by_currency: [
    { currency: 'USD', wins_count: 2, losses_count: 1, open_count: 3, wins_value: 8_000_000, losses_value: 650_000, open_value: 1_000_000 },
  ],
};
const zeroOracle = {
  wins_count: 0, losses_count: 0, wins_value: 0, losses_value: 0,
  win_rate_count: 0, win_rate_value: 0,
};

type Oracle = Omit<typeof populatedOracle, 'value_by_currency' | 'bids_by_currency' | 'open_count' | 'stale_count'> & {
  value_by_currency?: Array<{ currency: string; wins_value: number; losses_value: number; win_rate_value: number | null }>;
  bids_by_currency?: Array<{ currency: string; wins_count: number; losses_count: number; open_count: number; wins_value: number; losses_value: number; open_value: number }>;
  open_count?: number;
  stale_count?: number;
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
  afterEach(async () => {
    await act(async () => { await i18next.changeLanguage('en'); });
  });

  it('AC-1117: defaults to count basis and uses the RPC currency row for value basis', () => {
    render(<WinRateCard currency="USD" />);
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
    expect(screen.getAllByRole('progressbar')[0].firstElementChild).toHaveClass('bg-primary');
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    const usdRow = screen.getByTestId('win-rate-currency-USD');
    expect(usdRow).toHaveTextContent('92.5%');
    expect(usdRow).toHaveTextContent('82.9%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-count'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
  });

  it('AC-1380/AC-1441: count and value use per-currency bars for decided win rate and all-bid conversion', () => {
    oracle = {
      ...populatedOracle,
      wins_count: 3,
      wins_value: 8_001_000,
      value_by_currency: [
        { currency: 'IDR', wins_value: 8_000_000, losses_value: 650_000, win_rate_value: 0.924855 },
        { currency: 'USD', wins_value: 1_000, losses_value: 0, win_rate_value: null },
      ],
      bids_by_currency: [
        { currency: 'IDR', wins_count: 2, losses_count: 1, open_count: 3, wins_value: 8_000_000, losses_value: 650_000, open_value: 1_000_000 },
        { currency: 'USD', wins_count: 1, losses_count: 0, open_count: 0, wins_value: 1_000, losses_value: 0, open_value: 0 },
      ],
    };
    render(<WinRateCard currency="USD" />);

    expect(screen.getByTestId('win-rate-currency-IDR')).toBeInTheDocument();
    expect(screen.getByTestId('win-rate-currency-USD')).toHaveTextContent(/1 won of 1 decided/i);
    expect(screen.getByTestId('win-rate-currency-IDR')).toHaveTextContent('66.7%');
    expect(screen.getAllByRole('progressbar')).toHaveLength(4);
    expect(screen.getByTestId('win-rate-open-count')).toHaveTextContent('3 still open');
    expect(screen.getByTestId('win-rate-stale-count')).toHaveTextContent('1 stale');

    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    const idrRow = screen.getByTestId('win-rate-currency-IDR');
    expect(idrRow).toHaveTextContent('IDR');
    expect(idrRow).toHaveTextContent('92.5%');
    expect(idrRow).not.toHaveTextContent(/IDR\s+92\.5%/);
    expect(within(idrRow).getAllByRole('progressbar')).toHaveLength(2);
    expect(screen.getByTestId('win-rate-open-count')).toHaveTextContent('3 still open');
    expect(screen.getAllByRole('progressbar')).toHaveLength(4);
  });

  it('retains aggregate value-rate rendering for legacy RPC payloads without currency rows', () => {
    const { value_by_currency: _rows, bids_by_currency: _bids, open_count: _open, stale_count: _stale, ...legacyPayload } = populatedOracle;
    oracle = legacyPayload;
    render(<WinRateCard currency="USD" />);
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.getByTestId('win-rate-currency-USD')).toHaveTextContent('92.5%');
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
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
      bids_by_currency: [
        { currency: 'IDR', wins_count: 2, losses_count: 1, open_count: 3, wins_value: 8_000_000, losses_value: 650_000, open_value: 1_000_000 },
        { currency: 'USD', wins_count: 1, losses_count: 0, open_count: 0, wins_value: 0, losses_value: 0, open_value: 0 },
      ],
    };
    render(<WinRateCard currency="USD" />);
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(within(screen.getByTestId('win-rate-currency-IDR')).getByTestId('kpi-win-rate')).toHaveTextContent('92.5%');
    expect(screen.getByTestId('win-rate-currency-IDR')).toHaveTextContent('82.9%');
    expect(screen.getByTestId('win-rate-reason-USD')).toHaveTextContent(/No decided bid value recorded/i);
  });

  it('AC-UXA-003: localizes the decided-bid count and accessible rate in Bahasa', async () => {
    i18next.addResourceBundle('id', 'dashboard', idDashboard, true, true);
    await act(async () => { await i18next.changeLanguage('id'); });
    oracle = populatedOracle;
    render(<WinRateCard currency="USD" />);
    expect(screen.getByText('2 menang dari 3 yang diputuskan')).toBeInTheDocument();
    const decidedRate = screen.getByRole('progressbar', { name: 'Tingkat kemenangan USD dari tender yang diputuskan' });
    expect(decidedRate).toHaveAttribute('aria-valuetext', '66.7%');
    expect(screen.getByText('Menang')).toBeInTheDocument();
    expect(screen.getByText('Kalah atau masih terbuka')).toBeInTheDocument();
  });

  it('AC-1106: renders the currency breakdown with Indonesian catalogue copy', async () => {
    i18next.addResourceBundle('id', 'dashboard', idDashboard, true, true);
    await act(async () => { await i18next.changeLanguage('id'); });
    oracle = {
      ...populatedOracle,
      wins_value: null as unknown as number,
      losses_value: null as unknown as number,
      win_rate_value: null as unknown as number,
      value_by_currency: [
        { currency: 'IDR', wins_value: 8_000_000, losses_value: 650_000, win_rate_value: 0.924855 },
        { currency: 'USD', wins_value: 1_000, losses_value: 0, win_rate_value: null },
      ],
      bids_by_currency: [
        { currency: 'IDR', wins_count: 2, losses_count: 1, open_count: 3, wins_value: 8_000_000, losses_value: 650_000, open_value: 1_000_000 },
        { currency: 'USD', wins_count: 1, losses_count: 0, open_count: 0, wins_value: 0, losses_value: 0, open_value: 0 },
      ],
    };
    render(<WinRateCard currency="USD" />);
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.getByTestId('win-rate-currency-IDR')).toHaveTextContent('92.5%');
    expect(screen.getByTestId('win-rate-reason-USD')).toHaveTextContent(/Nilai tender yang diputuskan tidak tercatat/i);
    const decidedRate = within(screen.getByTestId('win-rate-currency-IDR')).getAllByRole('progressbar')[0];
    expect(decidedRate).toHaveAccessibleName('Tingkat kemenangan IDR dari tender yang diputuskan');
    expect(decidedRate).toHaveAttribute('aria-valuetext', '92.5%');
    expect(screen.getByText('Kalah atau masih terbuka')).toBeInTheDocument();
  });

  it('AC-1117: changing the period re-queries with a new range key', () => {
    render(<WinRateCard currency="USD" />);
    const initial = lastRange?.key;
    fireEvent.click(screen.getByTestId('win-rate-period-q'));
    expect(lastRange?.key).not.toBe(initial);
  });

  it('keeps the redesign heading and embedded frame while honoring a parent period range', () => {
    const parentRange = { key: 'company-period:2026-01:2026-10' };
    const { container } = render(<WinRateCard currency="USD" embedded range={parentRange} hidePeriodControl />);
    const section = screen.getByRole('region', { name: 'Win rate' });
    expect(section).not.toHaveClass('rounded-lg', 'border');
    expect(screen.getByRole('heading', { name: 'Win rate', level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Time frame/i })).not.toBeInTheDocument();
    expect(container.querySelector('section.rounded-lg.border')).toBeNull();
    expect(lastRange?.key).toBe(parentRange.key);
  });

  it('announces the rate politely and groups the basis + frame segs for a11y', () => {
    render(<WinRateCard currency="USD" />);
    expect(screen.getByTestId('kpi-win-rate')).toHaveAttribute('aria-live', 'polite');
    // W2-10: WinRateCard uses semantics="toggle" (no tabpanel) → role="group" + aria-pressed
    expect(screen.getByRole('group', { name: /Win-rate basis/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Time frame/i })).toBeInTheDocument();
  });

  it('AC-1441: keeps decided rate distinct from conversion across all bids', () => {
    render(<WinRateCard currency="USD" />);
    expect(screen.getByText(/2 won of 3 decided/i)).toBeInTheDocument();
    expect(screen.getByText(/2 won of 6 bids/i)).toBeInTheDocument();
    expect(screen.getByText('Won')).toBeInTheDocument();
    expect(screen.getByText('Lost or still open')).toBeInTheDocument();
    expect(screen.getByTestId('win-rate-period-rule')).toHaveTextContent(/decision date.*creation date.*stale count is current.*last stage change/i);
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
