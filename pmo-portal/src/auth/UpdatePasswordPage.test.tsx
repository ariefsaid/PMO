import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateUser: vi.fn(),
}));

const trackHelpers = vi.hoisted(() => ({
  trackAuthLoginSucceeded: vi.fn(),
  trackAuthLoginFailed: vi.fn(),
}));

const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('@/src/lib/analytics', () => ({
  trackAuthLoginSucceeded: trackHelpers.trackAuthLoginSucceeded,
  trackAuthLoginFailed: trackHelpers.trackAuthLoginFailed,
}));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      updateUser: auth.updateUser,
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
    })),
  },
}));

import { AuthProvider } from './AuthProvider';
import UpdatePasswordPage from './UpdatePasswordPage';

function renderPage() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <UpdatePasswordPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

beforeEach(() => {
  auth.getSession.mockReset();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.updateUser.mockReset();
  trackHelpers.trackAuthLoginSucceeded.mockReset();
  trackHelpers.trackAuthLoginFailed.mockReset();
  navigateSpy.mockReset();
});

describe('UpdatePasswordPage', () => {
  it('AC-AUTHF-010: an active recovery session renders new-password + confirm + Set new password', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc&refresh_token=xyz');
    auth.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1', user_metadata: {} } } },
    });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set new password/i })).toBeInTheDocument();
  });

  it('AC-AUTHF-011: mismatched passwords show an inline error and do NOT call updateUser', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc');
    auth.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1', user_metadata: {} } } },
    });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    await userEvent.type(screen.getByLabelText(/new password/i), 'NewPass1!');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'NewPass2!');
    await userEvent.click(screen.getByRole('button', { name: /set new password/i }));
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('AC-AUTHF-012: matching passwords call updateUser({ password, data: { invite_pending: false } }) and no PII is tracked', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc');
    auth.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1', user_metadata: {} } } },
    });
    auth.updateUser.mockResolvedValueOnce({ error: null });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    await userEvent.type(screen.getByLabelText(/new password/i), 'BrandNewPass1!');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'BrandNewPass1!');
    await userEvent.click(screen.getByRole('button', { name: /set new password/i }));
    await waitFor(() =>
      expect(auth.updateUser).toHaveBeenCalledWith({
        password: 'BrandNewPass1!',
        data: { invite_pending: false },
      })
    );
    expect(JSON.stringify(trackHelpers.trackAuthLoginSucceeded.mock.calls)).not.toContain(
      'BrandNewPass1!'
    );
  });

  it('AC-AUTHF-013: on updateUser success the router navigates to / (replace)', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc');
    auth.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1', user_metadata: {} } } },
    });
    auth.updateUser.mockResolvedValueOnce({ error: null });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    await userEvent.type(screen.getByLabelText(/new password/i), 'BrandNewPass1!');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'BrandNewPass1!');
    await userEvent.click(screen.getByRole('button', { name: /set new password/i }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('AC-AUTHF-014: a weak-password error renders an ErrorBanner and stays on /update-password', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc');
    auth.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1', user_metadata: {} } } },
    });
    auth.updateUser.mockResolvedValueOnce({
      error: { message: 'Password should be at least 10 characters.' },
    });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    await userEvent.type(screen.getByLabelText(/new password/i), 'short1');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'short1');
    await userEvent.click(screen.getByRole('button', { name: /set new password/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('AC-AUTHF-015: direct navigation (no params) renders the expired state, not the form', () => {
    window.history.replaceState({}, '', '/update-password');
    renderPage();
    expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute(
      'href',
      '/reset-password'
    );
    // The 'Request a new link' control is a SINGLE <Link> — no <button> nested in an <a>
    // (invalid HTML; interactive-in-interactive; was producing two tab stops, same name).
    expect(screen.queryByRole('button', { name: /request a new link/i })).toBeNull();
    // Landmark: the page exposes a single <main> around the card content.
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
  });

  it('AC-AUTHF-015: params + no session (invalid/expired token) renders the expired state', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=stale');
    auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    renderPage();
    await waitFor(() => expect(screen.getByText(/invalid or expired/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
  });

  it('AC-AUTHF-034: an invite_pending session with NO recovery params renders the set-password form, not the expired state', async () => {
    // RequireInviteAccepted redirects a signed-in invite_pending user to /update-password via
    // <Navigate>, which carries no recovery URL params. The page must still recognize the
    // already-established session (user_metadata.invite_pending === true) and render the form.
    window.history.replaceState({}, '', '/update-password');
    auth.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1', user_metadata: { invite_pending: true } } } },
    });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set new password/i })).toBeInTheDocument();
    expect(screen.queryByText(/invalid or expired/i)).toBeNull();
  });

  it('AC-AUTHF-017: after a recovery session establishes, the URL is the clean /update-password path', async () => {
    window.history.replaceState({}, '', '/update-password?type=recovery&token=abc&refresh_token=xyz');
    auth.getSession.mockResolvedValueOnce({
      data: { session: { user: { id: 'u1', user_metadata: {} } } },
    });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/new password/i)).toBeVisible());
    // FR-AUTHF-027: history.replaceState stripped the params (supabase-js does not).
    expect(window.location.pathname).toBe('/update-password');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });
});
