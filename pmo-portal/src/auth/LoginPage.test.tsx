import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
}));

const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: auth.signInWithPassword,
      signInWithOtp: auth.signInWithOtp,
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
    })),
  },
}));

import { AuthProvider } from './AuthProvider';
import LoginPage from './LoginPage';

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

beforeEach(() => {
  auth.signInWithPassword.mockReset();
  auth.signInWithOtp.mockReset();
  navigateSpy.mockReset();
});

describe('LoginPage', () => {
  it('shows an inline error on invalid credentials (AC-AUTH-004)', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() =>
      expect(screen.getByText(/invalid login credentials/i)).toBeInTheDocument()
    );
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('navigates to / on successful sign-in (FR-AUTH-020)', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('shows a check-your-email notice after requesting a magic link (FR-AUTH-022)', async () => {
    auth.signInWithOtp.mockResolvedValue({ error: null });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'engineer@acme.test');
    await userEvent.click(screen.getByRole('button', { name: /send magic link/i }));
    await waitFor(() =>
      expect(screen.getByText(/check your email/i)).toBeInTheDocument()
    );
  });
});
