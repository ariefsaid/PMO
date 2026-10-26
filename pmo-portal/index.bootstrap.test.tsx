import { act, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import React from 'react';
import type { i18n } from 'i18next';

const cold = vi.hoisted(() => ({ instance: null as i18n | null }));

vi.mock('./App', async () => {
  const { createInstance } = await import('i18next');
  const { I18nextProvider, initReactI18next, useTranslation } = await import('react-i18next');
  const instance = createInstance();
  instance.use({ type: 'backend' as const, init() {}, read() { /* catalogue still pending */ } });
  instance.use(initReactI18next);
  cold.instance = instance;
  function Entry() {
    const { t } = useTranslation();
    return <h1>{t('signIn', 'Sign in')}</h1>;
  }
  return { default: () => <I18nextProvider i18n={instance}><Entry /></I18nextProvider> };
});
vi.mock('@/src/lib/i18n', () => ({
  initI18n: () => cold.instance!.init({
    lng: 'en', fallbackLng: 'en', ns: ['common'],
    react: { useSuspense: false },
  }),
}));
vi.mock('@/src/lib/chunkReload', () => ({ installChunkReloadGuard: vi.fn() }));

afterEach(() => document.getElementById('root')?.remove());

it('cold entry shows the sign-in heading while the first catalogue is still pending', async () => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  await act(async () => { await import('./index'); });
  expect(cold.instance?.isInitialized).toBeFalsy();
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
