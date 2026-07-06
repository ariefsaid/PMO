import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      resend: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
    })),
  },
}));

import { AuthProvider } from './AuthProvider';
import ResetPasswordPage from './ResetPasswordPage';
import UpdatePasswordPage from './UpdatePasswordPage';

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe('auth pages never surface demo credentials (AC-AUTHF-035)', () => {
  it('AC-AUTHF-035: with VITE_DEMO_MODE=true, neither /reset-password nor /update-password shows demo credentials', () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');

    // /reset-password
    const r1 = render(
      <AuthProvider>
        <MemoryRouter>
          <ResetPasswordPage />
        </MemoryRouter>
      </AuthProvider>
    );
    expect(r1.queryByText(/Passw0rd!dev/i)).toBeNull();
    expect(r1.queryByRole('button', { name: /Executive|Admin|Finance/i })).toBeNull();
    r1.unmount();

    // /update-password (expired state — no params — but assert no demo panel either)
    window.history.replaceState({}, '', '/update-password');
    const r2 = render(
      <AuthProvider>
        <MemoryRouter>
          <UpdatePasswordPage />
        </MemoryRouter>
      </AuthProvider>
    );
    expect(r2.queryByText(/Passw0rd!dev/i)).toBeNull();
    expect(r2.queryByRole('button', { name: /Executive|Admin|Finance/i })).toBeNull();

    vi.unstubAllEnvs();
  });
});
