import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ContextBar } from '../ContextBar';
import enCatalogue from '../../../../public/locales/en/common.json';

vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {} }) }));

let effectiveRole = 'Admin';
const viewAs = vi.fn();
const signOut = vi.fn();
const onOpenPalette = vi.fn();

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole, realRole: 'Admin', canImpersonate: false, viewAs }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', full_name: 'Ada Lovelace', org_id: 'org-1' }, role: effectiveRole, signOut }),
}));
vi.mock('@/src/lib/features', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/lib/features')>();
  return { ...real };
});
vi.mock('@/src/components/shell/NotificationBell', () => ({ NotificationBell: () => null }));

beforeEach(() => {
  effectiveRole = 'Admin';
  viewAs.mockClear();
  signOut.mockClear();
  onOpenPalette.mockClear();
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('theme');
  localStorage.removeItem('text-size');
});

describe('ContextBar floor control', () => {
  it('floor: Profile & preferences opens the profile settings route', async () => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: 'en',
      fallbackLng: 'en',
      ns: 'common',
      defaultNS: 'common',
      resources: { en: { common: enCatalogue } },
      interpolation: { escapeValue: false },
    });

    render(
      <I18nextProvider i18n={instance}>
        <MemoryRouter initialEntries={['/']}>
          <ContextBar breadcrumb={[{ label: 'Dashboard' }]} onOpenPalette={onOpenPalette} />
          <Routes><Route path="/settings/profile" element={<p>Profile settings page</p>} /></Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /profile & preferences/i }));

    expect(await screen.findByText('Profile settings page')).toBeInTheDocument();
  });
});
