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

  // --- Design token / a11y assertions (reskin) ---

  it('renders the Sign In button as the primary action with role=button (AC-AUTH-RESKIN-001)', () => {
    renderLogin();
    const signInBtn = screen.getByRole('button', { name: /sign in/i });
    // Primary action: uses bg-primary token (class presence proves no legacy primary-NNN)
    expect(signInBtn.className).toMatch(/bg-primary/);
    // Must NOT carry legacy prototype classes
    expect(signInBtn.className).not.toMatch(/bg-primary-600/);
    expect(signInBtn.className).not.toMatch(/bg-gray-/);
  });

  it('renders magic-link button as outline/secondary — not primary (AC-AUTH-RESKIN-002)', () => {
    renderLogin();
    const mlBtn = screen.getByRole('button', { name: /send magic link/i });
    // outline variant uses border-input, NOT bg-primary
    expect(mlBtn.className).not.toMatch(/bg-primary[^-]/);
  });

  it('error state has role=alert for screen readers (AC-AUTH-RESKIN-003)', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Bad credentials' } });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'x@x.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'bad');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('magic-link sent confirmation has role=status (AC-AUTH-RESKIN-004)', async () => {
    auth.signInWithOtp.mockResolvedValue({ error: null });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'x@x.test');
    await userEvent.click(screen.getByRole('button', { name: /send magic link/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });

  it('shows loading spinner while submitting (AC-AUTH-RESKIN-005)', async () => {
    // Never resolves so spinner stays visible
    auth.signInWithPassword.mockReturnValue(new Promise(() => {}));
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'x@x.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    // Button goes aria-busy during submission
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sign in/i })).toHaveAttribute('aria-busy', 'true')
    );
  });

  it('page wrapper carries no legacy dark: or gray- classes (AC-AUTH-RESKIN-006)', () => {
    const { container } = renderLogin();
    // Walk all elements checking for banned classes
    const allClasses = Array.from(container.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.classList));
    const banned = allClasses.filter(
      (c) =>
        c.startsWith('dark:') ||
        /^(bg|text|border)-gray-/.test(c) ||
        /^(bg|text|border)-primary-\d/.test(c)
    );
    expect(banned).toHaveLength(0);
  });

  it('email and password inputs have visible labels (AC-AUTH-RESKIN-007)', () => {
    renderLogin();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });
});
