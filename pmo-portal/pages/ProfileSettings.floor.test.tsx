import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router';

const { setLocalePreferences, refreshMock, resolvedLocaleState, orgDefaultsState } = vi.hoisted(() => ({
  setLocalePreferences: vi.fn(),
  refreshMock: vi.fn(),
  resolvedLocaleState: { current: { locale: 'en', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' } },
  orgDefaultsState: { current: { defaultLocale: null as string | null, defaultNumberLocale: null as string | null, defaultTimezone: 'Asia/Jakarta' as string | null } },
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
    refreshCurrentUser: refreshMock,
  }),
}));
vi.mock('@/src/lib/repositories/profilePreferences', () => ({ profilePreferencesRepository: { setLocalePreferences } }));
vi.mock('@/src/hooks/useResolvedLocale', () => ({
  useResolvedLocale: () => resolvedLocaleState.current,
  useOrgLocaleDefaults: () => orgDefaultsState.current,
}));

import ProfileSettings from './ProfileSettings';

beforeEach(() => {
  delete document.documentElement.dataset.textSize;
  localStorage.removeItem('text-size');
  localStorage.removeItem('home-layout');
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
    number_locale: 'id-ID',
    timezone: 'Asia/Jakarta',
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <Link to="/next">Continue</Link>
      <Routes>
        <Route path="/profile" element={<ProfileSettings />} />
        <Route path="/next" element={<p>Next page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Profile settings floor controls', () => {
  it('floor: Home layout selection applies Focused and saves it on this device', () => {
    renderPage();
    const layout = screen.getByLabelText(/home layout/i);
    fireEvent.change(layout, { target: { value: 'focused' } });

    expect(layout).toHaveValue('focused');
    expect(localStorage.getItem('home-layout')).toBe('focused');
  });

  it('floor: Discard leaves the page without saving the unsaved preference', async () => {
    currentUserState = { ...currentUserState, locale: 'en' };
    renderPage();
    fireEvent.change(screen.getByLabelText(/interface language/i), { target: { value: 'id' } });
    await userEvent.click(screen.getByRole('link', { name: 'Continue' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Discard your changes?' });
    await userEvent.click(within(dialog).getByRole('button', { name: /^discard$/i }));

    expect(await screen.findByText('Next page')).toBeInTheDocument();
    expect(setLocalePreferences).not.toHaveBeenCalled();
  });
});
