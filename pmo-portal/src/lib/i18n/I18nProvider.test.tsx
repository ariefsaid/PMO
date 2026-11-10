import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { formatCurrency, formatDateTime, formatInstantDate } from '@/src/lib/format';
import { getActiveLocale, resetActiveLocale } from '@/src/lib/locale/activeLocale';
import { FALLBACK_TIMEZONE } from '@/src/lib/locale/resolveLocale';

const { authState, orgDefaults, initI18nCalls } = vi.hoisted(() => ({
  authState: { currentUser: null as Record<string, unknown> | null },
  orgDefaults: {
    current: {
      defaultLocale: null as string | null,
      defaultNumberLocale: null as string | null,
      defaultTimezone: null as string | null,
    },
  },
  initI18nCalls: [] as Array<string | undefined>,
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: authState.currentUser }),
}));

vi.mock('@/src/lib/db/orgs', () => ({
  getOrgLocaleDefaults: vi.fn(async () => orgDefaults.current),
}));

// The catalogue load is irrelevant to formatting and would reach for the network.
vi.mock('./index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./index')>();
  return {
    ...actual,
    initI18n: (locale?: string) => {
      initI18nCalls.push(locale);
      return new Promise(() => {});
    },
  };
});

import { I18nProvider } from './I18nProvider';
import { useResolvedLocale } from '@/src/hooks/useResolvedLocale';

const INSTANT = '2026-06-14T23:30:00.000Z';

/**
 * A date-and-money screen in miniature: the formatters every list/detail page calls. It subscribes
 * to the resolved locale the way real screens do (through the auth/org queries), so it re-renders
 * when the org row lands rather than keeping its first paint.
 */
function DateScreen() {
  useResolvedLocale();
  return (
    <div data-testid="date-screen">
      <span>{formatInstantDate(INSTANT)}</span>
      <span>{formatDateTime(new Date(INSTANT))}</span>
      <span>{formatCurrency(1234567, 'USD')}</span>
    </div>
  );
}

function renderTree() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <DateScreen />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  authState.currentUser = { id: 'u1', org_id: 'org-1', locale: null, number_locale: null, timezone: null };
  orgDefaults.current = { defaultLocale: 'en', defaultNumberLocale: 'en-US', defaultTimezone: 'UTC' };
  initI18nCalls.length = 0;
});
afterEach(() => resetActiveLocale());

describe('I18nProvider starts i18next in the RESOLVED language (#2097)', () => {
  it('a user whose profile resolves before the first render boots Indonesian, not English-then-switch', async () => {
    authState.currentUser = {
      id: 'u1', org_id: 'org-1', locale: 'id', number_locale: 'id-ID', timezone: 'Asia/Jakarta',
    };
    renderTree();
    // The catalogue init is handed the resolved locale, so the FIRST namespace fetch is
    // `/locales/id/...` — the previous shape always booted in English and re-fetched after the
    // profile landed.
    await waitFor(() => expect(initI18nCalls).toContain('id'));
  });

  it('an unresolved profile still boots on the fallback locale (resolveLocale is the only source)', async () => {
    authState.currentUser = null;
    renderTree();
    await waitFor(() => expect(initI18nCalls.length).toBeGreaterThan(0));
    expect(initI18nCalls[0]).toBe('en');
  });
});

describe('I18nProvider renders date screens when a stored preference is unusable (#684)', () => {
  it('a user who inherits an unusable org timezone still sees dates, in FALLBACK_TIMEZONE', async () => {
    // The org's (usable) Indonesian number locale is the signal that the org row has landed.
    orgDefaults.current = { defaultLocale: 'en', defaultNumberLocale: 'id-ID', defaultTimezone: 'Mars/Olympus' };
    renderTree();
    await waitFor(() => expect(getActiveLocale().numberLocale).toBe('id-ID'));
    expect(getActiveLocale().timezone).toBe(FALLBACK_TIMEZONE);
    expect(screen.getByTestId('date-screen')).toHaveTextContent('Jun 15, 2026');
    expect(screen.getByTestId('date-screen')).toHaveTextContent('1.234.567');
  });

  it('an unusable profile timezone and number locale do not break the screen', async () => {
    authState.currentUser = {
      id: 'u1', org_id: 'org-1', locale: null, number_locale: 'en_US', timezone: 'Asia/Jakarta ',
    };
    renderTree();
    await waitFor(() => expect(getActiveLocale().timezone).toBe('UTC'));
    expect(getActiveLocale().numberLocale).toBe('en-US');
    expect(screen.getByTestId('date-screen')).toHaveTextContent('Jun 14, 2026');
    expect(screen.getByTestId('date-screen')).toHaveTextContent('$1,234,567');
  });

  it('usable preferences are applied unchanged', async () => {
    authState.currentUser = {
      id: 'u1', org_id: 'org-1', locale: 'en', number_locale: 'id-ID', timezone: 'Asia/Jakarta',
    };
    renderTree();
    await waitFor(() => expect(getActiveLocale()).toEqual({ locale: 'en', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' }));
    expect(screen.getByTestId('date-screen')).toHaveTextContent('Jun 15, 2026');
  });
});
