import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { orgDayNow } from '@/src/hooks/useOrgToday';
import { resetActiveLocale } from '@/src/lib/locale/activeLocale';

const { orgDefaults } = vi.hoisted(() => ({
  orgDefaults: { current: { defaultLocale: 'en', defaultNumberLocale: 'en-US', defaultTimezone: 'Asia/Jakarta' } },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'u1', org_id: 'org-1', locale: null, number_locale: null, timezone: null },
    session: { user: { id: 'u1' } }, loading: false, profileError: null, profileErrorKind: null,
    refreshCurrentUser: vi.fn(), signOut: vi.fn(),
  }),
}));
vi.mock('@/src/lib/db/orgs', () => ({ getOrgLocaleDefaults: vi.fn(async () => orgDefaults.current) }));
vi.mock('@/src/lib/db/stageNames', () => ({ listStageNames: vi.fn(async () => []) }));
vi.mock('@/src/lib/i18n/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/i18n/index')>();
  return { ...actual, initI18n: () => new Promise(() => {}) };
});

import { I18nProvider } from '@/src/lib/i18n/I18nProvider';
import { RequireAuth } from './RequireAuth';

const mounts = vi.hoisted(() => ({ count: 0 }));
function Form() {
  const [day] = React.useState(() => orgDayNow());   // what a form mounted at first paint does
  React.useEffect(() => { mounts.count += 1; }, []);
  return <span data-testid="default-day">{day}</span>;
}
function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter><Routes><Route element={<RequireAuth />}><Route path="/" element={<Form />} /></Route></Routes></MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe('signed-in shell and the organisation day (#2914)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-25T18:00:00Z') }); mounts.count = 0; });  // 26 Nov 01:00 in Jakarta
  afterEach(() => { vi.useRealTimers(); resetActiveLocale(); });

  it("organisation timezone not yet known: the form cannot mount, and when it does it opens on the organisation's day", async () => {
    renderApp();
    expect(screen.queryByTestId('default-day')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('default-day')).toHaveTextContent('2026-11-26'));
  });

  it('the app tree mounts once on sign-in for a non-UTC organisation', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByTestId('default-day')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 50));
    expect(mounts.count).toBe(1);
  });
});
