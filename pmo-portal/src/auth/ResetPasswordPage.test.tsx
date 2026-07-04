import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      resetPasswordForEmail: auth.resetPasswordForEmail,
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
    })),
  },
}));

import { AuthProvider } from './AuthProvider';
import ResetPasswordPage from './ResetPasswordPage';

function renderPage() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

beforeEach(() => {
  auth.resetPasswordForEmail.mockReset();
  vi.unstubAllEnvs();
});

describe('ResetPasswordPage', () => {
  it('AC-AUTHF-001: renders email field, Send reset link action, and Back-to-sign-in link; no demo panel', () => {
    renderPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
    // FR-AUTHF-060: no demo panel on this page
    expect(screen.queryByText(/Passw0rd!dev/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Executive|Admin/i })).toBeNull();
  });

  it('AC-AUTHF-002: submitting a valid email calls resetPasswordForEmail with origin + /update-password', async () => {
    auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });
    renderPage();
    await userEvent.type(screen.getByLabelText(/email/i), 'someone@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => {
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('someone@example.com', {
        redirectTo: window.location.origin + '/update-password',
      });
    });
  });

  it('AC-AUTHF-002: the form enters a loading (aria-busy) state while the request is in flight', async () => {
    auth.resetPasswordForEmail.mockReturnValue(new Promise(() => {}));
    renderPage();
    await userEvent.type(screen.getByLabelText(/email/i), 'someone@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /send reset link/i })).toHaveAttribute('aria-busy', 'true')
    );
  });

  it('AC-AUTHF-003: the check-your-email notice is byte-identical for a known vs unknown email', async () => {
    let firstSnapshot: string | null = null;
    for (const email of ['pm@acme.test', 'nobody@nowhere.test']) {
      auth.resetPasswordForEmail.mockReset();
      auth.resetPasswordForEmail.mockResolvedValueOnce({ error: null });
      const { unmount } = renderPage();
      await userEvent.type(screen.getByLabelText(/email/i), email);
      await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));
      const notice = await screen.findByRole('status');
      expect(notice.textContent).toMatch(/check your email/i);
      if (firstSnapshot === null) {
        firstSnapshot = notice.outerHTML;
      } else {
        expect(notice.outerHTML).toBe(firstSnapshot);
      }
      unmount();
    }
  });

  it('AC-AUTHF-004: a network/rate-limit error renders an ErrorBanner and no unhandled rejection', async () => {
    auth.resetPasswordForEmail.mockRejectedValueOnce(new Error('network'));
    renderPage();
    await userEvent.type(screen.getByLabelText(/email/i), 'someone@example.com');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // no navigation away (MemoryRouter — assert the Send reset link button is still in the document)
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });
});
