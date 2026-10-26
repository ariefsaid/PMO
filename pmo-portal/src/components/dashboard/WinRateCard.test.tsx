import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
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
let pending = false;

vi.mock('@/src/hooks/useDashboard', async (orig) => {
  const actual = await orig<typeof import('@/src/hooks/useDashboard')>();
  return {
    ...actual,
    useWinRate: (range: { key: string }) => {
      lastRange = range;
      return { data: oracle, isPending: pending, isError: false, refetch: vi.fn() };
    },
  };
});

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="router-search">{location.search}</output>;
}

function renderCard(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <WinRateCard currency="USD" />
    </MemoryRouter>,
  );
}

describe('WinRateCard (AC-1117 — preserve win-rate logic, recompose the figure)', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    lastRange = null;
    oracle = populatedOracle;
    pending = false;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('AC-1117: defaults to count basis and uses the RPC currency row for value basis', () => {
    renderCard();
    expect(screen.getByTestId('win-rate-rate-count')).toHaveTextContent('66.7%');
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));
    expect(screen.getByTestId('win-rate-values-USD')).toBeInTheDocument();
    expect(screen.getByTestId('win-rate-rate-USD')).toHaveTextContent('92.5%');
    expect(screen.getByTestId('win-rate-track-USD')).toHaveAttribute('aria-valuenow', '92.5');
    fireEvent.click(screen.getByTestId('win-rate-toggle-count'));
    expect(screen.getByTestId('win-rate-rate-count')).toHaveTextContent('66.7%');
  });

  it('#1380 keeps a persistent value track with currency, rate, and exact money in separate fields', () => {
    renderCard('/?winRateBasis=value&winRatePeriod=all');

    expect(screen.getByTestId('win-rate-figure')).toBeInTheDocument();
    expect(screen.getByTestId('win-rate-currency-USD')).toHaveTextContent('USD');
    expect(screen.getByTestId('win-rate-rate-USD')).toHaveTextContent('92.5%');
    expect(screen.getByTestId('win-rate-track-USD')).toHaveAttribute('aria-valuenow', '92.5');
    expect(screen.getByTestId('win-rate-values-USD')).toHaveTextContent(/8,000,000.*650,000.*8,650,000/);
    expect(screen.queryByTestId('win-rate-rate-count')).not.toBeInTheDocument();
    expect(screen.getByTestId('win-rate-unused-slot')).toBeInTheDocument();
  });

  it('retains an aggregate value-rate track for legacy RPC payloads without currency rows', () => {
    const { value_by_currency: _rows, ...legacyPayload } = populatedOracle;
    oracle = legacyPayload;
    renderCard('/?winRateBasis=value');
    expect(screen.getByTestId('win-rate-rate-USD')).toHaveTextContent('92.5%');
    expect(screen.getByTestId('win-rate-track-USD')).toHaveAttribute('aria-valuenow', '92.5');
    expect(screen.queryByTestId('win-rate-value-breakdown')).not.toBeInTheDocument();
  });

  it('AC-1106: renders mixed-currency tracks separately and preserves an unknown rate', () => {
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
    renderCard('/?winRateBasis=value');

    expect(screen.getByTestId('win-rate-currency-IDR')).toHaveTextContent('IDR');
    expect(screen.getByTestId('win-rate-rate-IDR')).toHaveTextContent('92.5%');
    expect(screen.getByTestId('win-rate-track-IDR')).toHaveAttribute('aria-valuenow', '92.5');
    expect(screen.getByTestId('win-rate-currency-USD')).toHaveTextContent('USD');
    expect(screen.getByTestId('win-rate-rate-USD')).toHaveTextContent('—');
    expect(screen.getByTestId('win-rate-track-USD')).toHaveAttribute('aria-valuetext', 'Rate unavailable');
    expect(screen.getByTestId('win-rate-values-USD')).toHaveTextContent(/1,000.*0.*1,000/);
    expect(screen.getAllByText('3 recorded outcomes across currencies')).toHaveLength(1);
    expect(screen.getByTestId('win-rate-unavailable-note')).toHaveTextContent('Value win rate needs recorded won and lost amounts in the same currency.');
    expect(screen.getByRole('link', { name: 'Review closed project values' })).toHaveAttribute('href', '/projects');
    expect(screen.queryByTestId('win-rate-rate-count')).not.toBeInTheDocument();
  });

  it('AC-1106: renders the currency breakdown with Indonesian catalogue copy', async () => {
    i18next.addResourceBundle('id', 'common', idCommon, true, true);
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
    };
    renderCard('/?winRateBasis=value');
    expect(screen.getByTestId('win-rate-currency-IDR')).toHaveTextContent('IDR');
    expect(screen.getByTestId('win-rate-rate-IDR')).toHaveTextContent('92.5%');
    expect(screen.getByTestId('win-rate-rate-USD')).toHaveTextContent('—');
    expect(screen.getByTestId('win-rate-track-USD')).toHaveAttribute('aria-valuetext', 'Tingkat tidak tersedia');
    await act(async () => { await i18next.changeLanguage('en'); });
  });

  it('#1380 preserves a measured 100% track and its one-outcome sample count', () => {
    oracle = {
      ...populatedOracle,
      wins_count: 1,
      losses_count: 0,
      wins_value: 8_000_000,
      losses_value: 0,
      win_rate_count: 1,
      win_rate_value: 1,
      value_by_currency: [{ currency: 'USD', wins_value: 8_000_000, losses_value: 0, win_rate_value: 1 }],
    };
    renderCard('/?winRateBasis=count');

    expect(screen.getByTestId('win-rate-rate-count')).toHaveTextContent('100.0%');
    expect(screen.getByTestId('win-rate-track-count')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByTestId('win-rate-sample-count')).toHaveTextContent('1 closed outcome');
  });

  it('AC-1117: changing the period re-queries with a new local range key', () => {
    renderCard();
    const initial = lastRange?.key;
    fireEvent.click(screen.getByTestId('win-rate-period-q'));
    expect(lastRange?.key).not.toBe(initial);
  });

  it('#1380 persists period and basis in the URL while retaining other scope', () => {
    renderCard('/?filter=mine');
    fireEvent.click(screen.getByTestId('win-rate-period-q'));
    fireEvent.click(screen.getByTestId('win-rate-toggle-value'));

    expect(screen.getByTestId('router-search')).toHaveTextContent('filter=mine');
    expect(screen.getByTestId('router-search')).toHaveTextContent('winRatePeriod=q');
    expect(screen.getByTestId('router-search')).toHaveTextContent('winRateBasis=value');
    expect(screen.getByTestId('win-rate-period-q')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('win-rate-toggle-value')).toHaveAttribute('aria-pressed', 'true');
  });

  it('announces the rate politely and groups basis controls for assistive technology', () => {
    renderCard();
    expect(screen.getByTestId('win-rate-rate-count')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('group', { name: /Win-rate basis/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Time frame/i })).toBeInTheDocument();
  });

  it('AC-RF-004: reports exact recorded outcomes and keeps the shared legend without a permanent caveat', () => {
    renderCard();
    expect(screen.getByTestId('win-rate-values-count')).toHaveTextContent('2 won');
    expect(screen.getByTestId('win-rate-values-count')).toHaveTextContent('1 lost');
    expect(screen.getByTestId('win-rate-sample-count')).toHaveTextContent('3 closed outcomes');
    expect(screen.getByText('Won')).toBeInTheDocument();
    expect(screen.getByText('Lost')).toBeInTheDocument();
    expect(screen.queryByText('Recorded outcomes only; unrecorded decisions are not counted.')).not.toBeInTheDocument();
  });

  it('AC-DEC-002: shows the declined count beside the rate without changing it', () => {
    oracle = { ...populatedOracle, declined_count: 3 };
    renderCard();
    expect(screen.getByTestId('win-rate-declined')).toHaveTextContent('3 declined to bid');
    expect(screen.getByTestId('win-rate-rate-count')).toHaveTextContent('66.7%');
  });

  it('AC-DEC-002: when only declined deals exist, shows the count outside the denominator', () => {
    oracle = { ...zeroOracle, declined_count: 2 };
    renderCard();
    expect(screen.getByTestId('win-rate-empty-note')).toBeInTheDocument();
    expect(screen.getByTestId('win-rate-declined')).toHaveTextContent('2 declined to bid');
  });

  it('AC-DEC-002: omits the declined note when there are no declined bids', () => {
    renderCard();
    expect(screen.queryByTestId('win-rate-declined')).not.toBeInTheDocument();
  });

  it('shows an unavailable plot instead of a fabricated 0% when there are no closed projects', () => {
    oracle = zeroOracle;
    renderCard();
    expect(screen.getByTestId('win-rate-empty-note')).toBeInTheDocument();
    expect(screen.getByTestId('win-rate-rate-count')).toHaveTextContent('—');
    expect(screen.getByTestId('win-rate-figure')).toBeInTheDocument();
    expect(screen.getByTestId('win-rate-track-count')).toHaveAttribute('aria-valuetext', 'Rate unavailable');
  });

  it('#1380 keeps all four period choices in the phone select', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    renderCard();
    const period = screen.getByTestId('win-rate-period-select');
    expect(period).toHaveAccessibleName(/time frame|periode/i);
    expect(period.querySelectorAll('option')).toHaveLength(4);
    expect(screen.queryByRole('group', { name: /time frame/i })).not.toBeInTheDocument();
  });
});
