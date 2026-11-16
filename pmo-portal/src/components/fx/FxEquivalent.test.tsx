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
import { formatDateOnly } from '@/src/lib/format';

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
const D09 = formatDateOnly('2026-10-09');
const D13 = formatDateOnly('2026-10-13');

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

  it('wraps a compact equivalent whole on a phone (never cut, no ellipsis) with a full accessible name', () => {
    renderEquivalent({ compact: true });
    const clipped = screen.getByText('≈ IDR 1,623,456 (using IDR 16,234.56 rate)', { selector: '[aria-hidden="true"]' });
    expect(clipped).not.toHaveClass('truncate');
    expect(clipped).not.toHaveClass('whitespace-nowrap');
    expect(clipped).not.toHaveClass('overflow-hidden');
    expect(clipped).toHaveClass('whitespace-normal', 'break-words');
    expect(clipped).toHaveAttribute('title', `${clipped.textContent} · JISDOR rate of ${D09}`);
    expect(screen.getByText(`${clipped.textContent} (JISDOR rate of ${D09})`, { selector: '.sr-only' })).toBeInTheDocument();
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

  it('AC-FX-004 the equivalent is one unbreakable line, so "≈ IDR" never separates from its number (#2249)', () => {
    renderEquivalent();
    const figure = screen.getByText('≈ IDR 1,623,456 (using IDR 16,234.56 rate)');
    expect(figure).toHaveClass('whitespace-nowrap');
  });

  it('falls back to the latest available rate when none exists on or before the document date', () => {
    h.rate = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    h.rateFallback = { data: { rate: 18500, rate_date: '2026-10-12' }, isPending: false, isError: false, refetch: vi.fn() };
    renderEquivalent();
    expect(screen.getByText('≈ IDR 1,850,000 (using IDR 18,500 rate)')).toBeInTheDocument();
    expect(h.rateArgs).toHaveBeenCalledWith('USD', 'IDR', '2026-10-12', true);
  });

  it('includes the requested date when the selector returns no match', () => {
    h.rate = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    renderEquivalent({ date: '2020-10-10' });
    // #2088: the message formats the day through the app's date vocabulary, never raw ISO.
    expect(screen.getByText(/No JISDOR rate for 10 Oct 2020/i)).toBeInTheDocument();
    expectRateEnabled(true);
  });

  it('prefers the rate on or before the document date and does not look up today', () => {
    renderEquivalent();
    expect(h.dayArgs).toHaveBeenLastCalledWith(false);
    expect(h.rateArgs).not.toHaveBeenCalledWith('USD', 'IDR', '2026-10-12', true);
  });

  it('keeps the publication date out of the text and in the title and screen-reader text', () => {
    renderEquivalent();
    const visible = screen.getByText('≈ IDR 1,623,456 (using IDR 16,234.56 rate)');
    const figure = visible.parentElement as HTMLElement;
    expect(visible.textContent).not.toContain('2026-10-09');
    expect(figure).toHaveAttribute('title', `JISDOR rate of ${D09}`);
    expect(figure).toHaveTextContent(`≈ IDR 1,623,456 (using IDR 16,234.56 rate) (JISDOR rate of ${D09})`);
    expect(screen.getByText(new RegExp(`JISDOR rate of ${D09}`), { selector: '.sr-only' })).toBeInTheDocument();
  });

  it('with no rate ever uploaded, a person who may upload sees the no-rate sentence and the link to Exchange rates', () => {
    h.rate = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    h.rateFallback = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    renderEquivalent();
    expect(screen.getByText(/No JISDOR rate for 10 Oct\./i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload an exchange rate' })).toHaveAttribute('href', '/administration/exchange-rates');
  });

  it('with no rate ever uploaded, everyone else sees the no-rate sentence and no link', () => {
    h.canUpload = false;
    h.rate = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    h.rateFallback = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    renderEquivalent();
    expect(screen.getByText(/No JISDOR rate for 10 Oct\./i)).toBeInTheDocument();
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

  it('uses organization day for latest lookup and reports that day when absent', () => {
    h.orgDay = { day: '2020-10-12', isPending: false, isError: false, retry: vi.fn() };
    h.rate = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    renderEquivalent({ date: 'latest' });
    // #2088: the reported day is formatted, never raw ISO (the year stays on a past date).
    expect(screen.getByText(/No JISDOR rate for 12 Oct 2020/i)).toBeInTheDocument();
    expect(h.dayArgs).toHaveBeenLastCalledWith(true);
    expect(h.rateArgs).toHaveBeenLastCalledWith('USD', 'IDR', '2020-10-12', true);
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

  describe('rate date only when it differs from the document date (owner ruling)', () => {
    it('a document with only a later rate keeps the visible text and names the rate date in title and screen-reader text', () => {
      h.rate = { data: null, isPending: false, isError: false, refetch: vi.fn() };
      h.rateFallback = { data: { rate: 18500, rate_date: '2026-10-13' }, isPending: false, isError: false, refetch: vi.fn() };
      h.orgDay = { day: '2026-10-13', isPending: false, isError: false, retry: vi.fn() };
      const { container } = renderEquivalent();
      const visible = screen.getByText('≈ IDR 1,850,000 (using IDR 18,500 rate)');
      const figure = visible.parentElement as HTMLElement;
      expect(visible.textContent).not.toMatch(/2026|Oct/);
      expect(figure).toHaveAttribute('title', `JISDOR rate of ${D13}`);
      expect(screen.getByText(new RegExp(`JISDOR rate of ${D13}`), { selector: '.sr-only' })).toBeInTheDocument();
      expect(container.textContent).toContain(D13); // only through the screen-reader span
    });

    it('a rate on the document date shows no date anywhere', () => {
      h.rate = { data: { rate: 18500, rate_date: '2026-10-10' }, isPending: false, isError: false, refetch: vi.fn() };
      const { container } = renderEquivalent();
      const figure = screen.getByText('≈ IDR 1,850,000 (using IDR 18,500 rate)');
      expect(figure).not.toHaveAttribute('title');
      expect(container.querySelector('.sr-only')).toBeNull();
      expect(container.textContent).not.toMatch(/JISDOR|2026|Oct/);
    });

    it('compact: no date in title or sr text when the rate is on the document date', () => {
      h.rate = { data: { rate: 18500, rate_date: '2026-10-10' }, isPending: false, isError: false, refetch: vi.fn() };
      const { container } = renderEquivalent({ compact: true });
      expect(container.querySelector('[title]')).toBeNull();
      expect(container.textContent).not.toMatch(/JISDOR|Oct/);
    });
  });
});
