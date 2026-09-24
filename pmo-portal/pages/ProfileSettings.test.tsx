import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { axeViolations } from '@/src/components/__tests__/axe';

// ── Mocks ──────────────────────────────────────────────────────────────────
const { setInterfaceLanguage, refreshMock } = vi.hoisted(() => ({
  setInterfaceLanguage: vi.fn(),
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

vi.mock('@/src/lib/repositories/profilePreferences', () => ({
  profilePreferencesRepository: { setInterfaceLanguage },
}));

import ProfileSettings from './ProfileSettings';

beforeEach(() => {
  setInterfaceLanguage.mockReset();
  refreshMock.mockReset();
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

  it('saving Organization default writes null to language only, then refreshes', async () => {
    currentUserState = { ...currentUserState, locale: 'en' };
    setInterfaceLanguage.mockResolvedValue(undefined);
    let resolveRefresh!: (value: { error: null }) => void;
    refreshMock.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));

    renderPage();
    fireEvent.change(languageSelect(), { target: { value: 'inherit' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(setInterfaceLanguage).toHaveBeenCalledWith('user-123', null)
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/preferences saved/i)).not.toBeInTheDocument();
    await act(async () => resolveRefresh({ error: null }));
    expect(await screen.findByRole('status')).toHaveTextContent(/preferences saved/i);
  });

  it('disables the select and save button and shows a saving status while the write is pending', async () => {
    let resolveDAL!: () => void;
    setInterfaceLanguage.mockImplementation(
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
    setInterfaceLanguage.mockRejectedValue(new Error('db write failed'));
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
    setInterfaceLanguage.mockResolvedValue(undefined);
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
      expect(screen.getByRole('heading', { name: /profile settings/i })).toBeInTheDocument()
    );
    const { blocking } = await axeViolations(container);
    expect(blocking).toEqual([]);
  });
});
