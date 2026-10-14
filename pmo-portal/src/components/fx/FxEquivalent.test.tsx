import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FxRateMatch } from '@/src/lib/repositories/types';

const enCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'));
const idCatalogue = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'));

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
  rateArgs: vi.fn(),
  dayArgs: vi.fn(),
  currencyRetry: vi.fn(),
}));
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
    return h.rate;
  },
}));

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
  h.rateArgs.mockReset();
  h.dayArgs.mockReset();
  h.currencyRetry.mockReset();
});
afterEach(() => cleanup());

const renderEquivalent = (props: Partial<React.ComponentProps<typeof FxEquivalent>> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FxEquivalent amount={100} currency="USD" date="2026-10-10" {...props} />
    </QueryClientProvider>,
  );
};

function expectRateEnabled(enabled: boolean) {
  const call = h.rateArgs.mock.calls.at(-1);
  expect(call?.[3]).toBe(enabled);
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

  it('does not use the unresolved USD placeholder to decide currency eligibility', () => {
    h.currency = { currency: 'USD', isResolved: false, isError: false };
    renderEquivalent();
    expect(screen.getByRole('status')).toHaveTextContent(/organization currency/i);
    expectRateEnabled(false);
    expect(h.dayArgs).toHaveBeenLastCalledWith(false);
  });

  it('shows a valid USD/IDR equivalent using the selected publication date and preserves the original amount', () => {
    const amount = 100;
    renderEquivalent();
    expect(screen.getByText('≈ Rp 1,623,456 (JISDOR 2026-10-09)')).toBeInTheDocument();
    expectRateEnabled(true);
    expect(h.rateArgs).toHaveBeenLastCalledWith('USD', 'IDR', '2026-10-10', true);
    expect(amount).toBe(100);
  });

  it('keeps a compact equivalent to one visual line with a full accessible name', () => {
    renderEquivalent({ compact: true });
    const clipped = screen.getByText('≈ Rp 1,623,456 (JISDOR 2026-10-09)', { selector: '[aria-hidden="true"]' });
    expect(clipped).toHaveClass('truncate', 'whitespace-nowrap');
    expect(clipped).toHaveAttribute('title', clipped.textContent);
    expect(screen.getByText(clipped.textContent ?? '', { selector: '.sr-only' })).toBeInTheDocument();
  });

  it.each(['EUR', 'IDR'])('does not offer JISDOR for unsupported currency %s', (currency) => {
    h.currency = { currency: 'IDR', isResolved: true, isError: false };
    renderEquivalent({ currency });
    if (currency === 'IDR') expect(screen.queryByText(/JISDOR/)).not.toBeInTheDocument();
    else expect(screen.getByText(/USD contracts in IDR organizations only/i)).toBeInTheDocument();
    expectRateEnabled(false);
  });

  it('does not offer USD to a non-IDR organization', () => {
    h.currency = { currency: 'EUR', isResolved: true, isError: false };
    renderEquivalent();
    expect(screen.getByText(/USD contracts in IDR organizations only/i)).toBeInTheDocument();
    expectRateEnabled(false);
  });

  it.each([
    ['en', 'No document date — no JISDOR equivalent.'],
    ['id', 'Tidak ada tanggal dokumen — tidak ada ekuivalen JISDOR.'],
  ])('explains the missing document date in %s', (language, message) => {
    const i18n = i18next.createInstance();
    void i18n.init({ lng: language, fallbackLng: false, defaultNS: 'common', resources: { en: { common: enCatalogue }, id: { common: idCatalogue } }, initImmediate: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <FxEquivalent amount={100} currency="USD" date={null} />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    expect(screen.getByText(message)).toBeInTheDocument();
    expectRateEnabled(false);
  });

  it('includes the requested date when the selector returns no match', () => {
    h.rate = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    renderEquivalent();
    expect(screen.getByText(/No JISDOR rate for 2026-10-10/i)).toBeInTheDocument();
    expectRateEnabled(true);
  });

  it('shows organization-day pending and failure states with retry only for failure', () => {
    h.orgDay = { day: null, isPending: true, isError: false, retry: vi.fn() };
    renderEquivalent({ date: 'latest' });
    expect(screen.getByRole('status')).toHaveTextContent(/Checking today’s JISDOR date/i);
    expectRateEnabled(false);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();

    cleanup();
    h.orgDay = { day: null, isPending: false, isError: true, retry: vi.fn() };
    renderEquivalent({ date: 'latest' });
    expect(screen.getByRole('alert')).toHaveTextContent(/organization’s local date/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.orgDay.retry).toHaveBeenCalledOnce();
  });

  it('uses organization day for latest lookup and reports that day when absent', () => {
    h.rate = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    renderEquivalent({ date: 'latest' });
    expect(screen.getByText(/No JISDOR rate for 2026-10-12/i)).toBeInTheDocument();
    expect(h.dayArgs).toHaveBeenLastCalledWith(true);
    expect(h.rateArgs).toHaveBeenLastCalledWith('USD', 'IDR', '2026-10-12', true);
  });

  it('keeps pending and error states distinct and offers retry only for failures', () => {
    h.rate = { data: null, isPending: true, isError: false, refetch: vi.fn() };
    renderEquivalent();
    expect(screen.getByRole('status')).toHaveTextContent(/checking JISDOR/i);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    cleanup();
    h.rate = { data: null, isPending: false, isError: true, refetch: vi.fn() };
    renderEquivalent();
    expect(screen.getByRole('alert')).toHaveTextContent(/Could not load JISDOR/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.rate.refetch).toHaveBeenCalledOnce();
  });

  it('treats zero as a real amount and null as no equivalent lookup', () => {
    renderEquivalent({ amount: 0 });
    expect(screen.getByText('≈ Rp 0 (JISDOR 2026-10-09)')).toBeInTheDocument();
    cleanup();
    const { container } = renderEquivalent({ amount: null });
    expect(container).toBeEmptyDOMElement();
    expectRateEnabled(false);
  });
});
