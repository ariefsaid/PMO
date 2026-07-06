import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateUser: vi.fn(),
  signInWithPassword: vi.fn(),
}));

const trackHelpers = vi.hoisted(() => ({
  trackAuthLoginSucceeded: vi.fn(),
  trackAuthLoginFailed: vi.fn(),
}));

vi.mock('@/src/lib/analytics', () => ({
  trackAuthLoginSucceeded: trackHelpers.trackAuthLoginSucceeded,
  trackAuthLoginFailed: trackHelpers.trackAuthLoginFailed,
  trackDemoPersonaSelected: vi.fn(),
}));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: auth.signInWithPassword,
      signInWithOtp: vi.fn(),
      updateUser: auth.updateUser,
      resend: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
    })),
  },
}));

import { AuthProvider } from './AuthProvider';
import UpdatePasswordPage from './UpdatePasswordPage';
import LoginPage from './LoginPage';

function renderUpdate(url: string) {
  window.history.replaceState({}, '', url);
  return render(
    <AuthProvider>
      <MemoryRouter>
        <UpdatePasswordPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

async function submitMatched(password: string) {
  await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
  await userEvent.type(screen.getByLabelText(/new password/i), password);
  await userEvent.type(screen.getByLabelText(/confirm password/i), password);
  await userEvent.click(screen.getByRole('button', { name: /set new password/i }));
}

async function submitCredentials(email: string, password: string) {
  await userEvent.type(screen.getByLabelText(/email/i), email);
  await userEvent.type(screen.getByLabelText(/password/i), password);
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

beforeEach(() => {
  auth.getSession.mockReset();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.updateUser.mockReset();
  auth.signInWithPassword.mockReset();
  trackHelpers.trackAuthLoginSucceeded.mockReset();
  trackHelpers.trackAuthLoginFailed.mockReset();
});

describe('auth-floor analytics (AC-AUTHF-036)', () => {
  it('AC-AUTHF-036: success/failure tracking uses the new codes and never carries PII', async () => {
    // reset-success: UpdatePasswordPage on a successful SET after a reset (wasInvite===false).
    // Two getSession() callers resolve per mount (AuthProvider's own effect + the page's in-page
    // recovery-detection effect) — queue the same session twice.
    const resetSession = { data: { session: { user: { id: 'u1', user_metadata: {} } } } };
    auth.getSession.mockResolvedValueOnce(resetSession).mockResolvedValueOnce(resetSession);
    auth.updateUser.mockResolvedValueOnce({ error: null });
    renderUpdate('/update-password?type=recovery&token=abc');
    await submitMatched('BrandNewPass1!');
    expect(trackHelpers.trackAuthLoginSucceeded).toHaveBeenCalledWith('password_reset');
    cleanup();

    // invite-accept success (wasInvite===true)
    const inviteSession = {
      data: { session: { user: { id: 'u2', user_metadata: { invite_pending: true } } } },
    };
    auth.getSession.mockResolvedValueOnce(inviteSession).mockResolvedValueOnce(inviteSession);
    auth.updateUser.mockResolvedValueOnce({ error: null });
    renderUpdate('/update-password?type=recovery&token=def');
    await submitMatched('InvitePass1!');
    expect(trackHelpers.trackAuthLoginSucceeded).toHaveBeenCalledWith('invite_accept');
    cleanup();

    // weak-password failure
    const weakSession = { data: { session: { user: { id: 'u3', user_metadata: {} } } } };
    auth.getSession.mockResolvedValueOnce(weakSession).mockResolvedValueOnce(weakSession);
    auth.updateUser.mockResolvedValueOnce({
      error: { message: 'Password should be at least 10 characters.' },
    });
    renderUpdate('/update-password?type=recovery&token=ghi');
    await submitMatched('short1short1');
    expect(trackHelpers.trackAuthLoginFailed).toHaveBeenCalledWith(expect.any(String), 'weak_password');
    cleanup();

    // confirm-required on login
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    renderLogin();
    await submitCredentials('pm@acme.test', 'Passw0rd!dev');
    await waitFor(() =>
      expect(trackHelpers.trackAuthLoginFailed).toHaveBeenCalledWith('password', 'email_not_confirmed')
    );
    cleanup();

    // expired-token failure
    const expiredSession = { data: { session: { user: { id: 'u4', user_metadata: {} } } } };
    auth.getSession.mockResolvedValueOnce(expiredSession).mockResolvedValueOnce(expiredSession);
    auth.updateUser.mockResolvedValueOnce({ error: { message: 'Token has expired or is invalid' } });
    renderUpdate('/update-password?type=recovery&token=jkl');
    await submitMatched('AnotherPass1!');
    expect(trackHelpers.trackAuthLoginFailed).toHaveBeenCalledWith(expect.any(String), 'expired_token');

    // PII guard: no email/password/raw-token value in ANY analytics call. (The 'expired_token'
    // REASON CODE itself is an allowed, non-PII enum value — only actual secret values are banned.)
    const all = JSON.stringify([
      ...trackHelpers.trackAuthLoginSucceeded.mock.calls,
      ...trackHelpers.trackAuthLoginFailed.mock.calls,
    ]);
    expect(all).not.toMatch(
      /someone@example\.com|pm@acme\.test|BrandNewPass1!|InvitePass1!|Passw0rd!dev|token=|access_token|refresh_token/i
    );
  });
});
