import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useTranslation } from 'react-i18next';
import en from '@/public/locales/en/common.json';
import id from '@/public/locales/id/common.json';

// The global view-test setup initializes the default engine with in-memory English resources.
// Use a fresh real engine so the shipped bootstrap exercises actual deferred catalogue loads.
vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('i18next')>();
  return { ...actual, default: actual.createInstance({ react: { useSuspense: false } }) };
});

const state = vi.hoisted(() => ({ locale: 'en' }));
vi.mock('@/src/hooks/useResolvedLocale', () => ({ useResolvedLocale: () => ({ locale: state.locale, numberLocale: state.locale === 'id' ? 'id-ID' : 'en-US', timezone: 'UTC' }) }));
vi.mock('@/src/hooks/useOrgTerminology', () => ({ useApplyOrgTerminology: () => {} }));
vi.mock('@/src/hooks/useOrgRoleNames', () => ({ useApplyOrgRoleNames: () => {} }));
vi.mock('@/src/hooks/useOrgStageNames', () => ({ useApplyOrgStageNames: () => {} }));

import { I18nProvider } from './I18nProvider';
import { i18next, initI18n } from './index';
import { resetActiveLocale } from '@/src/lib/locale/activeLocale';

function Period() {
  const { t } = useTranslation('project');
  return <label>{t('financialStatements.period', 'Period')}</label>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetActiveLocale(); });

it('AC-008 keeps Periode when an older English switch finishes after the profile returns to Indonesian', async () => {
  let releaseBoot!: () => void;
  const boot = new Promise<void>((resolve) => { releaseBoot = resolve; });
  let releaseEnglish!: () => void;
  const english = new Promise<void>((resolve) => { releaseEnglish = resolve; });
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/locales/en/common.json') await boot;
    if (path === '/locales/en/workOrderPva.json') await english;
    return { ok: true, json: async () => path.endsWith('/common.json') ? (path.includes('/id/') ? id : en) : {} };
  });
  vi.stubGlobal('fetch', fetcher);
  const starting = initI18n('en');
  const tree = () => <I18nProvider><Period /></I18nProvider>;
  const view = render(tree());
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => String(path) === '/locales/en/common.json')).toBe(true));
  state.locale = 'id';
  view.rerender(tree());
  // Metadata follows the profile while the first catalogue is blocked.
  await waitFor(() => expect(document.documentElement.lang).toBe('id'));
  await act(async () => { releaseBoot(); await starting; });
  await waitFor(() => expect(screen.getByText('Periode')).toBeInTheDocument());

  // A route catalogue is still in flight when an older profile update asks for English.
  let namespaceLoad!: Promise<unknown>;
  act(() => { namespaceLoad = i18next.loadNamespaces('workOrderPva'); });
  await waitFor(() => expect(fetcher.mock.calls.some(([path]) => String(path) === '/locales/en/workOrderPva.json')).toBe(true));
  const changeLanguage = vi.spyOn(i18next, 'changeLanguage');
  state.locale = 'en';
  view.rerender(tree());
  await waitFor(() => expect(changeLanguage).toHaveBeenCalledWith('en'));
  state.locale = 'id';
  view.rerender(tree());
  await waitFor(() => expect(document.documentElement.lang).toBe('id'));
  await act(async () => { releaseEnglish(); await namespaceLoad; });
  await waitFor(() => expect(screen.getByText('Periode')).toBeInTheDocument());
  expect(i18next.language).toBe('id');
  expect(document.documentElement.lang).toBe('id');
});
