import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import enCatalogue from '../public/locales/en/common.json';
import idCatalogue from '../public/locales/id/common.json';

/**
 * ux/1110 restore (R1, AC-PLC-007): the three always-visible resolution lines on Profile &
 * preferences — "Effective language: …" / "Effective number format: …" / "Effective timezone: …".
 * The redesign removed them, leaving a user unable to read anywhere which language, number
 * convention and timezone their preferences actually resolve to (the info only surfaced inside the
 * 'inherit' option label). #684's preview answers "what would SAVING produce?"; these lines answer
 * "what is in effect right now?" — they render the saved values through the resolver
 * (`resolvedLocale`), always, whatever the selects show.
 */

const { setLocalePreferences, refreshMock, resolvedLocaleState, orgDefaultsState } = vi.hoisted(() => ({
  setLocalePreferences: vi.fn(),
  refreshMock: vi.fn(),
  resolvedLocaleState: {
    current: { locale: 'en', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' },
  },
  orgDefaultsState: {
    current: {
      defaultLocale: null as string | null,
      defaultNumberLocale: null as string | null,
      defaultTimezone: 'Asia/Jakarta' as string | null,
    },
  },
}));

let currentUserState: Record<string, unknown> | null = null;

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    session: null,
    currentUser: currentUserState,
    role: currentUserState?.role ?? null,
    loading: false,
    profileError: null,
    profileErrorKind: null,
    signInWithPassword: vi.fn(),
    signInWithMagicLink: vi.fn(),
    signInWithMicrosoft: vi.fn(),
    requestPasswordReset: vi.fn(),
    updatePassword: vi.fn(),
    resendEmailConfirmation: vi.fn(),
    signOut: vi.fn(),
    refreshCurrentUser: refreshMock,
  }),
}));

vi.mock('@/src/lib/repositories/profilePreferences', () => ({
  profilePreferencesRepository: { setLocalePreferences },
}));

vi.mock('@/src/hooks/useResolvedLocale', () => ({
  useResolvedLocale: () => resolvedLocaleState.current,
  useOrgLocaleDefaults: () => orgDefaultsState.current,
}));

import ProfileSettings from './ProfileSettings';

beforeEach(() => {
  setLocalePreferences.mockReset();
  refreshMock.mockReset();
  resolvedLocaleState.current = { locale: 'en', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };
  orgDefaultsState.current = { defaultLocale: null, defaultNumberLocale: null, defaultTimezone: 'Asia/Jakarta' };
  currentUserState = {
    id: 'user-123',
    full_name: 'Alice Manager',
    role: 'Project Manager',
    email: 'pm@acme.test',
    org_id: 'org-1',
    locale: 'id',
    number_locale: 'en-US',
    timezone: 'Asia/Jakarta',
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <ProfileSettings />
    </MemoryRouter>,
  );
}

describe('ProfileSettings — the always-visible effective resolution lines (ux/1110 restore, AC-PLC-007)', () => {
  it('shows all three effective lines for a user with explicit overrides, not only when inherit is chosen', () => {
    // The user overrides everything; the lines still name what those choices resolve to.
    resolvedLocaleState.current = { locale: 'id', numberLocale: 'en-US', timezone: 'Asia/Jakarta' };
    renderPage();

    expect(screen.getByText('Effective language: Bahasa Indonesia')).toBeInTheDocument();
    expect(screen.getByText('Effective number format: 1,234,567.89')).toBeInTheDocument();
    // AC-PLC-007's exact precondition oracle.
    expect(screen.getByText('Effective timezone: Asia/Jakarta')).toBeInTheDocument();
  });

  it('shows the resolved organization defaults for a user with no overrides (all inherit)', () => {
    currentUserState = { ...currentUserState, locale: null, number_locale: null, timezone: null };
    resolvedLocaleState.current = { locale: 'en', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };
    orgDefaultsState.current = { defaultLocale: 'en', defaultNumberLocale: 'en-US', defaultTimezone: 'Asia/Jakarta' };
    renderPage();

    expect(screen.getByText('Effective language: English')).toBeInTheDocument();
    expect(screen.getByText('Effective number format: 1.234.567,89')).toBeInTheDocument();
    expect(screen.getByText('Effective timezone: Asia/Jakarta')).toBeInTheDocument();
  });

  it('the lines follow the SAVED resolution, never the pending unsaved selection', () => {
    // #684's preview under the number select reflects the PENDING choice; the effective line
    // stays on the saved value until save + session refresh.
    currentUserState = { ...currentUserState, locale: 'en', number_locale: 'en-US', timezone: 'Asia/Jakarta' };
    resolvedLocaleState.current = { locale: 'en', numberLocale: 'en-US', timezone: 'Asia/Jakarta' };
    renderPage();

    expect(screen.getByText('Effective number format: 1,234,567.89')).toBeInTheDocument();
  });

  it('renders the catalogue Bahasa lines (Bahasa aktif / Format angka aktif / Zona waktu aktif)', async () => {
    resolvedLocaleState.current = { locale: 'id', numberLocale: 'en-US', timezone: 'Asia/Jakarta' };
    const instance = i18next.createInstance();
    await instance.init({
      lng: 'id',
      fallbackLng: 'en',
      ns: 'common',
      defaultNS: 'common',
      resources: { en: { common: enCatalogue }, id: { common: idCatalogue } },
      interpolation: { escapeValue: false },
    });
    render(
      <MemoryRouter>
        <I18nextProvider i18n={instance}>
          <ProfileSettings />
        </I18nextProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Bahasa aktif: Bahasa Indonesia')).toBeInTheDocument();
    expect(screen.getByText('Format angka aktif: 1,234,567.89')).toBeInTheDocument();
    expect(screen.getByText('Zona waktu aktif: Asia/Jakarta')).toBeInTheDocument();
  });
});
