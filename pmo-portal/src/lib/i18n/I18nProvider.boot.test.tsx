// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

// Fresh real i18next instance so we exercise the shipped boot + preload + deferred-fallback paths.
vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('i18next')>();
  return { ...actual, default: actual.createInstance({ react: { useSuspense: false } }) };
});

vi.mock('@/src/lib/lazyWithPreload', () => ({
  lazyWithPreload: () => ({ preload: async () => ({}) }),
}));

const authState = vi.hoisted(() => ({
  loading: true,
  session: null as { user: { id: string } } | null,
  currentUser: null as Record<string, unknown> | null,
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    loading: authState.loading,
    session: authState.session,
    currentUser: authState.currentUser,
    role: authState.currentUser?.role ?? null,
    profileError: null,
    profileErrorKind: null,
    refreshCurrentUser: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('@/src/lib/db/orgs', () => ({
  getOrgLocaleDefaults: vi.fn(async () => ({
    defaultLocale: 'en',
    defaultNumberLocale: 'en-US',
    defaultTimezone: 'Asia/Jakarta',
  })),
}));
vi.mock('@/src/hooks/useOrgTerminology', () => ({ useApplyOrgTerminology: () => {} }));
vi.mock('@/src/hooks/useOrgRoleNames', () => ({ useApplyOrgRoleNames: () => {} }));
vi.mock('@/src/hooks/useOrgStageNames', () => ({ useApplyOrgStageNames: () => {} }));

import { I18nProvider } from './I18nProvider';
import { resetI18nForTests } from './index';
import { preloadForPath } from '@/App';
import { resetActiveLocale } from '@/src/lib/locale/activeLocale';

function OverviewConsumers() {
  const { t } = useTranslation();
  return (
    <div data-testid="overview-consumers">
      <span>{t('shell.nav.projects', 'Projects')}</span>
      <span>{t('project:financialStatements.period', 'Period')}</span>
      <span>{t('projects:title', 'Projects')}</span>
      <span>{t('recordFolders:title', 'Folders')}</span>
      <span>{t('status:active', 'Active')}</span>
      <span>{t('workOrderPva:title', 'PVA')}</span>
      <span>{t('notifications:title', 'Notifications')}</span>
      <span>{t('home:title', 'Home')}</span>
      <span>{t('incidents:title', 'Incidents')}</span>
      <span>{t('equipment:title', 'Equipment')}</span>
      <span>{t('safety:title', 'Safety')}</span>
      <span>{t('siteReport:title', 'Site Report')}</span>
      <span>{t('crews:title', 'Crews')}</span>
      <span>{t('financeHub:title', 'Finance')}</span>
      <span>{t('journals:title', 'Journals')}</span>
      <span>{t('imprest:title', 'Imprest')}</span>
      <span>{t('materialRequests:title', 'Material Requests')}</span>
      <span>{t('workInHand:title', 'Work in Hand')}</span>
      <span>{t('profilePreferences:title', 'Profile')}</span>
      <span data-testid="en-only">{t('onlyInEnglish')}</span>
      <span data-testid="interp">{t('demo.quickSignIn', '{{label}}, {{email}}', { label: 'Executive', email: 'exec@acme.test' })}</span>
    </div>
  );
}

beforeEach(() => {
  authState.loading = true;
  authState.session = null;
  authState.currentUser = null;
  resetI18nForTests();
  resetActiveLocale();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetI18nForTests();
  resetActiveLocale();
});

describe('P3 boot language ordering and single-wave overview catalogue preload', () => {
  it('signed-in Indonesian user never requests an English catalogue before Indonesian, and missing keys still fall back to English after first paint', async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === '/locales/id/common.json') {
        return { ok: true, status: 200, json: async () => ({ shell: { nav: { projects: 'Proyek' } } }) };
      }
      if (url === '/locales/en/common.json') {
        return { ok: true, status: 200, json: async () => ({ shell: { nav: { projects: 'Projects' } }, onlyInEnglish: 'English fallback text' }) };
      }
      if (url === '/locales/id/project.json') {
        return { ok: true, status: 200, json: async () => ({ financialStatements: { period: 'Periode' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ title: url.includes('/id/') ? 'ID' : 'EN' }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={client}>
        <I18nProvider>
          <OverviewConsumers />
        </I18nProvider>
      </QueryClientProvider>
    );

    // 1. Auth still loading (before getSession): zero catalogue fetches, and pre-init never leaks raw tokens.
    const view = render(tree());
    expect(screen.getByTestId('interp').textContent).not.toContain('{{');
    await Promise.resolve();
    expect(requestedUrls).toEqual([]);

    // 2. Session known, profile still loading: still zero catalogue fetches.
    authState.session = { user: { id: 'u1' } };
    view.rerender(tree());
    await Promise.resolve();
    expect(requestedUrls).toEqual([]);

    // 3. Profile resolves as Indonesian: first catalogue fetches MUST be Indonesian, never English.
    authState.loading = false;
    authState.currentUser = {
      id: 'u1', org_id: 'org-1', role: 'Finance', locale: 'id', number_locale: 'id-ID', timezone: 'Asia/Jakarta',
    };
    view.rerender(tree());

    await waitFor(() => expect(screen.getByText('Proyek')).toBeInTheDocument());
    const firstIdIndex = requestedUrls.findIndex((u) => u.startsWith('/locales/id/'));
    const firstEnIndex = requestedUrls.findIndex((u) => u.startsWith('/locales/en/'));
    expect(firstIdIndex).toBe(0);
    expect(firstEnIndex === -1 || firstEnIndex > firstIdIndex).toBe(true);

    // 4. After first paint, the English fallback loads in the background and resolves missing keys.
    await waitFor(() => expect(screen.getByTestId('en-only')).toHaveTextContent('English fallback text'), { timeout: 4000 });
    expect(screen.getByTestId('interp')).toHaveTextContent('Executive, exec@acme.test');
  });

  it('counts catalogue request waves for the project overview: shell and overview namespaces load in one Indonesian wave', async () => {
    let currentWave = 0;
    let waveOpen = false;
    const waves: string[][] = [];
    const resolvers: Array<() => void> = [];

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/locales/id/')) {
        if (!waveOpen) {
          waveOpen = true;
          currentWave += 1;
          waves.push([]);
          queueMicrotask(() => { waveOpen = false; });
        }
        waves[currentWave - 1].push(url);
      }
      return new Promise((resolve) => {
        const done = () => resolve({
          ok: true,
          status: 200,
          json: async () => {
            if (url === '/locales/id/common.json') return { shell: { nav: { projects: 'Proyek' } } };
            if (url === '/locales/id/project.json') return { financialStatements: { period: 'Periode' } };
            return { title: 'Terjemahan' };
          },
        });
        if (url.startsWith('/locales/id/')) resolvers.push(done);
        else done();
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    // Preload at boot before React mounts (same as index.tsx).
    preloadForPath('/projects/41000000-0000-0000-0000-000000000001/overview');
    expect(waves.length).toBe(0);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={client}>
        <I18nProvider>
          <OverviewConsumers />
        </I18nProvider>
      </QueryClientProvider>
    );

    const view = render(tree());
    expect(waves.length).toBe(0);

    // Profile resolves as Indonesian.
    authState.loading = false;
    authState.session = { user: { id: 'u1' } };
    authState.currentUser = {
      id: 'u1', org_id: 'org-1', role: 'Finance', locale: 'id', number_locale: 'id-ID', timezone: 'Asia/Jakarta',
    };
    view.rerender(tree());

    await waitFor(() => expect(waves.length).toBe(1));
    // Every required shell + overview namespace is already in flight in wave 1 before any response arrives.
    for (const ns of ['common', 'project', 'projects', 'recordFolders', 'status', 'workOrderPva', 'notifications', 'home']) {
      expect(waves[0]).toContain(`/locales/id/${ns}.json`);
    }

    // Complete wave 1 and verify mounted overview + shell consumers trigger ZERO further Indonesian waves.
    await act(async () => {
      while (resolvers.length > 0) resolvers.shift()?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('Periode')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 30));
    expect(waves.length).toBe(1);
  });

  it('signed-out pages still load catalogues immediately without waiting for a profile', async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return { ok: true, status: 200, json: async () => ({ shell: { nav: { projects: 'Projects' } } }) };
    }));

    authState.loading = false;
    authState.session = null;
    authState.currentUser = null;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <OverviewConsumers />
        </I18nProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(requestedUrls).toContain('/locales/en/common.json'));
  });
});
