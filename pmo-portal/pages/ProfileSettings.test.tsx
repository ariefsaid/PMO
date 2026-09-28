import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import React from 'react'
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { axeViolations } from '@/src/components/__tests__/axe';
import enCatalogue from '../public/locales/en/common.json';
import idCatalogue from '../public/locales/id/common.json';

// ── Mocks ──────────────────────────────────────────────────────────────────
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
    // Distinctive values ensure the page does not quietly rewrite independent preferences.
    number_locale: 'id-ID',
    timezone: 'Asia/Jakarta',
  };
});

function renderPage() {
  return render(<ProfileSettings />);
}

function languageSelect() {
  return screen.getByLabelText(/interface language/i) as HTMLSelectElement;
}

describe('ProfileSettings (profile language settings slice)', () => {
  it('exposes exactly the three language options and reflects the current stored choice', () => {
    // Inherit (NULL)
    currentUserState = { ...currentUserState, locale: null };
    const { unmount } = renderPage();
    const select = languageSelect();
    const options = within(select).getAllByRole('option');
    // AC-PLC-001: the inherit option names the inherited org value (no org default → English).
    expect(options.map((o) => o.textContent)).toEqual([
      'Organization default — English',
      'Bahasa Indonesia',
      'English',
    ]);
    expect(select).toHaveValue('inherit');
    unmount();

    // Explicit Bahasa Indonesia
    currentUserState = { ...currentUserState, locale: 'id' };
    renderPage();
    expect(languageSelect()).toHaveValue('id');
  });

  it('renders an explicit English choice as the current stored value', () => {
    currentUserState = { ...currentUserState, locale: 'en' };
    renderPage();
    expect(languageSelect()).toHaveValue('en');
  });

  it('saving Organization default writes null to language only, then refreshes', async () => {
    currentUserState = { ...currentUserState, locale: 'en' };
    setLocalePreferences.mockResolvedValue(undefined);
    let resolveRefresh!: (value: { error: null }) => void;
    refreshMock.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));

    renderPage();
    fireEvent.change(languageSelect(), { target: { value: 'inherit' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(setLocalePreferences).toHaveBeenCalledWith('user-123', {
      locale: null,
      numberLocale: 'id-ID',
      timezone: 'Asia/Jakarta',
    }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();
    await act(async () => resolveRefresh({ error: null }));
    expect(await screen.findByRole('status')).toHaveTextContent(/preferences saved/i);
  });

  it('disables the select and save button and shows a saving status while the write is pending', async () => {
    let resolveDAL!: () => void;
    setLocalePreferences.mockImplementation(
      () => new Promise<void>((res) => (resolveDAL = () => res()))
    );
    refreshMock.mockResolvedValue({ error: null });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(languageSelect()).toBeDisabled();
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByText(/saving your preference/i)).toBeInTheDocument();
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();

    await act(async () => resolveDAL());
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/preferences saved/i));
  });

  it('shows an assertive error and no success when the database write rejects', async () => {
    currentUserState = { ...currentUserState, locale: 'en' };
    setLocalePreferences.mockRejectedValue(new Error('db write failed'));
    refreshMock.mockResolvedValue({ error: null });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not save your preference/i));
    expect(screen.getByRole('alert')).not.toHaveTextContent(/db write failed/i);
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
    // The chosen value stays retryable after an error (select re-enabled).
    expect(languageSelect()).not.toBeDisabled();
    expect(languageSelect()).toHaveValue('en');
  });

  it('shows an assertive error and no success when the profile refresh fails after a successful write', async () => {
    currentUserState = { ...currentUserState, locale: 'en' };
    setLocalePreferences.mockResolvedValue(undefined);
    refreshMock.mockResolvedValue({ error: 'profile refresh failed' });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/could not save your preference/i)
    );
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();
  });

  it('is axe-clean (WCAG AA) including the labelled control and live feedback', async () => {
    currentUserState = { ...currentUserState, locale: 'en' };
    const { container } = renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /profile & preferences/i })).toBeInTheDocument()
    );
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });
});

describe('ProfileSettings personal locale preferences', () => {
  it('AC-PLC-001: shows stored inheritance separately from effective defaults and offers number previews', () => {
    currentUserState = {
      ...currentUserState,
      locale: null,
      number_locale: null,
      timezone: null,
    };
    resolvedLocaleState.current = { locale: 'en', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

    renderPage();

    expect(languageSelect()).toHaveValue('inherit');
    expect(screen.getByLabelText(/number format/i)).toHaveValue('inherit');
    expect(screen.getByRole('combobox', { name: /timezone/i })).toHaveTextContent(/organization default/i);
    expect(screen.getByText(/effective.*english/i)).toBeInTheDocument();
    expect(screen.getByText('1.234.567,89')).toBeInTheDocument();
    expect(screen.getByText('1,234,567.89')).toBeInTheDocument();
  });

  it('AC-PLC-001: names the organization timezone on Organization default, not the user override', async () => {
    currentUserState = { ...currentUserState, timezone: 'UTC' };
    resolvedLocaleState.current = { locale: 'en', numberLocale: 'id-ID', timezone: 'UTC' };
    orgDefaultsState.current = { defaultLocale: null, defaultNumberLocale: null, defaultTimezone: 'Asia/Jakarta' };

    renderPage();
    fireEvent.click(screen.getByRole('combobox', { name: /timezone/i }));

    expect(await screen.findByRole('option', { name: /organization default — Asia\/Jakarta/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /organization default — UTC/i })).not.toBeInTheDocument();
  });

  it('AC-PLC-001: names the inherited organization language and number format on Organization default, even with explicit overrides selected', () => {
    // The user overrides both; the organization says English + English grouping.
    currentUserState = { ...currentUserState, locale: 'id', number_locale: 'id-ID', timezone: 'UTC' };
    resolvedLocaleState.current = { locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' };
    orgDefaultsState.current = { defaultLocale: 'en', defaultNumberLocale: 'en-US', defaultTimezone: 'Asia/Jakarta' };

    renderPage();

    expect(languageSelect()).toHaveValue('id');
    expect(within(languageSelect()).getByRole('option', { name: 'Organization default — English' })).toHaveValue('inherit');
    const numberSelect = screen.getByLabelText(/number format/i) as HTMLSelectElement;
    expect(numberSelect).toHaveValue('id-ID');
    expect(within(numberSelect).getByRole('option', { name: 'Organization default — 1,234,567.89' })).toHaveValue('inherit');
  });

  it('AC-PLC-001: an inherited number format with no organization number default follows the language it would derive from', () => {
    // No org number default: the inherited convention derives from the language (resolveLocale).
    currentUserState = { ...currentUserState, locale: null, number_locale: null, timezone: null };
    resolvedLocaleState.current = { locale: 'id', numberLocale: 'id', timezone: 'Asia/Jakarta' };
    orgDefaultsState.current = { defaultLocale: 'id', defaultNumberLocale: null, defaultTimezone: 'Asia/Jakarta' };

    renderPage();

    expect(within(languageSelect()).getByRole('option', { name: 'Organization default — Bahasa Indonesia' })).toBeInTheDocument();
    const numberSelect = screen.getByLabelText(/number format/i) as HTMLSelectElement;
    expect(within(numberSelect).getByRole('option', { name: 'Organization default — 1.234.567,89' })).toBeInTheDocument();
    // The effective line shows the convention's example, never a bare language tag like "id".
    expect(screen.getByText('Effective number format: 1.234.567,89')).toBeInTheDocument();

    // Choosing English as the language changes what "Organization default" number format would give.
    fireEvent.change(languageSelect(), { target: { value: 'en' } });
    expect(within(numberSelect).getByRole('option', { name: 'Organization default — 1,234,567.89' })).toBeInTheDocument();
  });

  it('AC-PLC-001: keeps explicit choices explicit when they match organization defaults', () => {
    currentUserState = { ...currentUserState, locale: 'en', number_locale: 'id-ID', timezone: 'Asia/Jakarta' };
    resolvedLocaleState.current = { locale: 'en', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

    renderPage();

    expect(languageSelect()).toHaveValue('en');
    expect(screen.getByLabelText(/number format/i)).toHaveValue('id-ID');
    expect(screen.getByRole('combobox', { name: /timezone/i })).toHaveTextContent(/Asia\/Jakarta/i);
  });

  it('AC-PLC-002: saves all three preferences in one write and waits for profile refresh', async () => {
    currentUserState = { ...currentUserState, locale: 'en', number_locale: 'id-ID', timezone: 'Asia/Jakarta' };
    resolvedLocaleState.current = { locale: 'en', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };
    setLocalePreferences.mockResolvedValue(undefined);
    let resolveRefresh!: (value: { error: null }) => void;
    refreshMock.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));

    renderPage();
    fireEvent.change(languageSelect(), { target: { value: 'en' } });
    fireEvent.change(screen.getByLabelText(/number format/i), { target: { value: 'inherit' } });
    fireEvent.click(screen.getByRole('combobox', { name: /timezone/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Asia/Jakarta' }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(setLocalePreferences).toHaveBeenCalledWith('user-123', {
      locale: 'en',
      numberLocale: null,
      timezone: 'Asia/Jakarta',
    }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();
    await act(async () => resolveRefresh({ error: null }));
    expect(await screen.findByRole('status')).toHaveTextContent(/preferences saved/i);
  });

  it('AC-PLC-003: preserves choices and shows an accessible retry error after write or refresh failure', async () => {
    currentUserState = { ...currentUserState, locale: null, number_locale: null, timezone: null };
    setLocalePreferences.mockRejectedValueOnce(new Error('write failed'));

    renderPage();
    fireEvent.change(languageSelect(), { target: { value: 'id' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(languageSelect()).toHaveValue('id');
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();

    setLocalePreferences.mockResolvedValueOnce(undefined);
    refreshMock.mockResolvedValueOnce({ error: 'refresh failed' });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(languageSelect()).toHaveValue('id');
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();
  });

  it('AC-PLC-003: a failed write keeps the choices, then a retry succeeds with exactly one success and one refresh', async () => {
    currentUserState = { ...currentUserState, locale: null, number_locale: null, timezone: null };
    setLocalePreferences.mockRejectedValueOnce(new Error('write failed')).mockResolvedValueOnce(undefined);
    refreshMock.mockResolvedValue({ error: null });

    renderPage();
    fireEvent.change(languageSelect(), { target: { value: 'id' } });
    fireEvent.change(screen.getByLabelText(/number format/i), { target: { value: 'en-US' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // Failure: accessible alert, choices intact, no refresh, no success.
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save your preference/i);
    expect(languageSelect()).toHaveValue('id');
    expect(screen.getByLabelText(/number format/i)).toHaveValue('en-US');
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();

    // Retry with the same retained choices.
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/preferences saved/i));

    expect(setLocalePreferences).toHaveBeenCalledTimes(2);
    expect(setLocalePreferences).toHaveBeenLastCalledWith('user-123', { locale: 'id', numberLocale: 'en-US', timezone: null });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/preferences saved/i)).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('AC-PLC-006: rejects an invalid timezone before any profile preference write', async () => {
    currentUserState = { ...currentUserState, locale: 'en', number_locale: 'en-US', timezone: 'Not/A_Time_Zone' };
    setLocalePreferences.mockResolvedValue(undefined);

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(setLocalePreferences).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe('ProfileSettings localized labels (AC-ACCT-006)', () => {
  it('renders the catalogue English heading when the interface language is English', async () => {
    currentUserState = { ...currentUserState, locale: 'en' };
    const instance = i18next.createInstance();
    await instance.init({
      lng: 'en',
      fallbackLng: 'en',
      ns: 'common',
      defaultNS: 'common',
      resources: {
        en: { common: enCatalogue },
        id: { common: idCatalogue },
      },
      interpolation: { escapeValue: false },
    });
    render(
      <I18nextProvider i18n={instance}>
        <ProfileSettings />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Profile & preferences' })).toBeInTheDocument()
    );
  });

  it('renders the catalogue Bahasa heading when the interface language is Bahasa Indonesia', async () => {
    currentUserState = { ...currentUserState, locale: 'id' };
    const instance = i18next.createInstance();
    await instance.init({
      lng: 'id',
      fallbackLng: 'en',
      ns: 'common',
      defaultNS: 'common',
      resources: {
        en: { common: enCatalogue },
        id: { common: idCatalogue },
      },
      interpolation: { escapeValue: false },
    });
    render(
      <I18nextProvider i18n={instance}>
        <ProfileSettings />
      </I18nextProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Profil & preferensi' })).toBeInTheDocument()
    );
  });
});
