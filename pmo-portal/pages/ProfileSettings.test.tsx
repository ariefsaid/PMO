import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { axeViolations } from '@/src/components/__tests__/axe';

// ── Mocks ──────────────────────────────────────────────────────────────────
const { setMyLocalePreferences, refreshMock } = vi.hoisted(() => ({
  setMyLocalePreferences: vi.fn(),
  refreshMock: vi.fn(),
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

vi.mock('@/src/lib/db/preferences', () => ({ setMyLocalePreferences }));

import ProfileSettings from './ProfileSettings';

beforeEach(() => {
  setMyLocalePreferences.mockReset();
  refreshMock.mockReset();
  currentUserState = {
    id: 'user-123',
    full_name: 'Alice Manager',
    role: 'Project Manager',
    email: 'pm@acme.test',
    org_id: 'org-1',
    // ⚑ Distinctive, load-bearing values the save must pass through VERBATIM (the slice must not
    //    reset/alter number-locale or timezone).
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
    expect(options.map((o) => o.textContent)).toEqual([
      'Organization default',
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

  it('saving Organization default writes null while preserving numberLocale and timezone, then refreshes', async () => {
    currentUserState = { ...currentUserState, locale: 'en' };
    setMyLocalePreferences.mockResolvedValue(undefined);
    refreshMock.mockResolvedValue({ error: null });

    renderPage();
    fireEvent.change(languageSelect(), { target: { value: 'inherit' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(setMyLocalePreferences).toHaveBeenCalledWith('user-123', {
        locale: null,
        numberLocale: 'id-ID',
        timezone: 'Asia/Jakarta',
      })
    );
    // Refresh must be awaited BEFORE success appears, and its { error: null } result is required.
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent(/preferences saved/i);
  });

  it('disables the select and save button and shows a saving status while the write is pending', async () => {
    let resolveDAL!: () => void;
    setMyLocalePreferences.mockImplementation(
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
    setMyLocalePreferences.mockRejectedValue(new Error('db write failed'));
    refreshMock.mockResolvedValue({ error: null });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/db write failed/i));
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
    // The chosen value stays retryable after an error (select re-enabled).
    expect(languageSelect()).not.toBeDisabled();
    expect(languageSelect()).toHaveValue('en');
  });

  it('shows an assertive error and no success when the profile refresh fails after a successful write', async () => {
    currentUserState = { ...currentUserState, locale: 'en' };
    setMyLocalePreferences.mockResolvedValue(undefined);
    refreshMock.mockResolvedValue({ error: 'profile refresh failed' });

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/profile refresh failed/i)
    );
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();
  });

  it('is axe-clean (WCAG AA) including the labelled control and live feedback', async () => {
    currentUserState = { ...currentUserState, locale: 'en' };
    const { container } = renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /profile settings/i })).toBeInTheDocument()
    );
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });
});