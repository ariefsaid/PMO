import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FxRateMatch } from '@/src/lib/repositories/types';

const h = vi.hoisted(() => ({
  user: { currentUser: { org_id: 'org-1' } },
  currency: { currency: 'IDR', isResolved: true, isError: false },
  orgDay: { day: '2026-10-12' as string | null, isPending: false, isError: false, retry: vi.fn() },
  rate: {
    data: { rate: 16234.56, rate_date: '2026-10-09' } as FxRateMatch | null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  rateFallback: null as { data: FxRateMatch | null; isPending: boolean; isError: boolean; refetch: () => void } | null,
  canUpload: true,
  rateArgs: vi.fn(),
  dayArgs: vi.fn(),
  currencyRetry: vi.fn(),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canUpload }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => h.user }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrencyState: () => h.currency }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: (enabled: boolean) => {
    h.dayArgs(enabled);
    return h.orgDay;
  },
}));
vi.mock('@/src/hooks/useFxRates', () => ({
  useFxRate: (...args: unknown[]) => {
    h.rateArgs(...args);
    // the second lookup (the organisation's today, when nothing is on or before the document date)
    return h.rateFallback && args[2] === h.orgDay.day && args[2] !== '2026-10-10' ? h.rateFallback : h.rate;
  },
}));

import { MemoryRouter } from 'react-router';
import FxEquivalent from './FxEquivalent';

beforeEach(() => {
  h.user = { currentUser: { org_id: 'org-1' } };
  h.currency = { currency: 'IDR', isResolved: true, isError: false };
  h.orgDay = { day: '2026-10-12', isPending: false, isError: false, retry: vi.fn() };
  h.rate = {
    data: { rate: 16234.56, rate_date: '2026-10-09' },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  };
  h.rateFallback = null;
  h.canUpload = true;
  h.rateArgs.mockReset();
  h.dayArgs.mockReset();
  h.currencyRetry.mockReset();
});
afterEach(() => cleanup());

const renderEquivalent = (props: Partial<React.ComponentProps<typeof FxEquivalent>> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><MemoryRouter>
      <FxEquivalent amount={100} currency="USD" date="2026-10-10" {...props} />
    </MemoryRouter></QueryClientProvider>,
  );
};

function expectRateEnabled(enabled: boolean) {
  const flags = h.rateArgs.mock.calls.map((call) => call[3]);
  // The first lookup is the document's own date; the second (today's, as a fallback) only opens when that one is empty.
  if (enabled) expect(flags).toContain(true);
  else expect(flags).not.toContain(true);
}

describe('AC-FX-004 JISDOR equivalent display', () => {
  it('omits same-currency amounts without a rate lookup', () => {
    const { container } = renderEquivalent({ currency: 'IDR' });
    expect(container).toBeEmptyDOMElement();
    expectRateEnabled(false);
  });

  it('omits USD/USD amounts without a rate lookup', () => {
    h.currency = { currency: 'USD', isResolved: true, isError: false };
    const { container } = renderEquivalent();
    expect(container).toBeEmptyDOMElement();
    expectRateEnabled(false);
  });

  it('does not use the unresolved USD placeholder to decide currency eligibility, and shows nothing while it loads (FIN-S4)', () => {
    h.currency = { currency: 'USD', isResolved: false, isError: false };
    const { container } = renderEquivalent();
    expect(container).toBeEmptyDOMElement();
    expectRateEnabled(false);
    expect(h.dayArgs).toHaveBeenLastCalledWith(false);
  });

  it('shows a valid USD/IDR equivalent using the selected publication date and preserves the original amount', () => {
    const amount = 100;
    renderEquivalent();
    expect(screen.getByText('≈ IDR 1,623,456 (using IDR 16,234.56 rate)')).toBeInTheDocument();
    expectRateEnabled(true);
    expect(h.rateArgs).toHaveBeenCalledWith('USD', 'IDR', '2026-10-10', true);
    expect(amount).toBe(100);
  });

  it('keeps a compact equivalent to one visual line with a full accessible name', () => {
    renderEquivalent({ compact: true });
    const clipped = screen.getByText('≈ IDR 1,623,456 (using IDR 16,234.56 rate)', { selector: '[aria-hidden="true"]' });
    expect(clipped).toHaveClass('truncate', 'whitespace-nowrap');
    expect(clipped).toHaveAttribute('title', `${clipped.textContent} · JISDOR rate of 2026-10-09`);
    expect(screen.getByText(`${clipped.textContent} (JISDOR rate of 2026-10-09)`, { selector: '.sr-only' })).toBeInTheDocument();
  });

  it.each(['EUR', 'IDR'])('renders nothing for unsupported currency %s (FIN-S4)', (currency) => {
    h.currency = { currency: 'IDR', isResolved: true, isError: false };
    const { container } = renderEquivalent({ currency });
    expect(container).toBeEmptyDOMElement();
    expectRateEnabled(false);
  });

  it('renders nothing for USD in a non-IDR organization (FIN-S4)', () => {
    h.currency = { currency: 'EUR', isResolved: true, isError: false };
    const { container } = renderEquivalent();
    expect(container).toBeEmptyDOMElement();
    expectRateEnabled(false);
  });

  it('renders nothing when the amount has no document date (FIN-S4)', () => {
    const { container } = renderEquivalent({ date: null });
    expect(container).toBeEmptyDOMElement();
    expectRateEnabled(false);
  });

  it('falls back to the latest available rate when none exists on or before the document date', () => {
    h.rate = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    h.rateFallback = { data: { rate: 18500, rate_date: '2026-10-12' }, isPending: false, isError: false, refetch: vi.fn() };
    renderEquivalent();
    expect(screen.getByText('≈ IDR 1,850,000 (using IDR 18,500 rate)')).toBeInTheDocument();
    expect(h.rateArgs).toHaveBeenCalledWith('USD', 'IDR', '2026-10-12', true);
  });

  it('prefers the rate on or before the document date and does not look up today', () => {
    renderEquivalent();
    expect(h.dayArgs).toHaveBeenLastCalledWith(false);
    expect(h.rateArgs).not.toHaveBeenCalledWith('USD', 'IDR', '2026-10-12', true);
  });

  it('keeps the publication date out of the text and in the title and screen-reader text', () => {
    renderEquivalent();
    const figure = screen.getByText('≈ IDR 1,623,456 (using IDR 16,234.56 rate)');
    expect(figure.firstChild?.textContent).not.toContain('2026-10-09');
    expect(figure).toHaveAttribute('title', 'JISDOR rate of 2026-10-09');
    expect(screen.getByText(/JISDOR rate of 2026-10-09/, { selector: '.sr-only' })).toBeInTheDocument();
  });

  it('with no rate ever uploaded, a person who may upload sees — and the link to Exchange rates', () => {
    h.rate = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    h.rateFallback = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    renderEquivalent();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload an exchange rate' })).toHaveAttribute('href', '/administration/exchange-rates');
    expect(screen.queryByText(/No JISDOR rate for/)).not.toBeInTheDocument();
  });

  it('with no rate ever uploaded, everyone else sees — and a plain reason, no link', () => {
    h.canUpload = false;
    h.rate = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    h.rateFallback = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    renderEquivalent();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('No exchange rate uploaded')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders nothing while the organization day loads; a failure is one short line with no Retry (FIN-S4)', () => {
    h.orgDay = { day: null, isPending: true, isError: false, retry: vi.fn() };
    const { container } = renderEquivalent({ date: 'latest' });
    expect(container).toBeEmptyDOMElement();
    expectRateEnabled(false);

    cleanup();
    h.orgDay = { day: null, isPending: false, isError: true, retry: vi.fn() };
    renderEquivalent({ date: 'latest' });
    expect(screen.getByRole('alert')).toHaveTextContent(/Could not load JISDOR/i);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('uses organization day for latest lookup and shows the no-rate state when none exists', () => {
    h.rate = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    renderEquivalent({ date: 'latest' });
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload an exchange rate' })).toBeInTheDocument();
    expect(h.dayArgs).toHaveBeenCalledWith(true);
    expect(h.rateArgs).toHaveBeenCalledWith('USD', 'IDR', '2026-10-12', true);
  });

  it('renders nothing while the rate loads; a failure is one short line with no Retry (FIN-S4)', () => {
    h.rate = { data: null, isPending: true, isError: false, refetch: vi.fn() };
    const { container } = renderEquivalent();
    expect(container).toBeEmptyDOMElement();
    cleanup();
    h.rate = { data: null, isPending: false, isError: true, refetch: vi.fn() };
    renderEquivalent();
    expect(screen.getByRole('alert')).toHaveTextContent(/Could not load JISDOR/i);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('an org-currency failure is the same one short line', () => {
    h.currency = { currency: 'IDR', isResolved: false, isError: true };
    renderEquivalent();
    expect(screen.getByRole('alert')).toHaveTextContent(/Could not load JISDOR/i);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('treats zero as a real amount and null as no equivalent lookup', () => {
    renderEquivalent({ amount: 0 });
    expect(screen.getByText('≈ IDR 0 (using IDR 16,234.56 rate)')).toBeInTheDocument();
    cleanup();
    h.rateArgs.mockReset();
    const { container } = renderEquivalent({ amount: null });
    expect(container).toBeEmptyDOMElement();
    expectRateEnabled(false);
  });
});
