import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';

const auth = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  signInWithOtp: vi.fn(),
  resend: vi.fn(),
}));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(),
      signInWithOtp: auth.signInWithOtp,
      resetPasswordForEmail: auth.resetPasswordForEmail,
      resend: auth.resend,
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
    })),
  },
}));

import { AuthProvider } from './AuthProvider';
import { useAuth } from './useAuth';

// Probe exposing the three redirect-bearing useAuth() methods (mirrors the AuthProvider.test.tsx
// / authFloorAnalytics.test.tsx probe pattern) — this owns AC-AUTHF-030 (redirect safety).
function RedirectsProbe() {
  const { requestPasswordReset, signInWithMagicLink, resendEmailConfirmation } = useAuth();
  return (
    <div>
      <button
        data-testid="reset"
        onClick={() => void requestPasswordReset('a@b.test')}
      />
      <button
        data-testid="magic-link"
        onClick={() => void signInWithMagicLink('a@b.test')}
      />
      <button
        data-testid="resend"
        onClick={() => void resendEmailConfirmation('a@b.test')}
      />
    </div>
  );
}

function renderProbe() {
  return render(
    <AuthProvider>
      <RedirectsProbe />
    </AuthProvider>
  );
}

beforeEach(() => {
  auth.resetPasswordForEmail.mockReset();
  auth.signInWithOtp.mockReset();
  auth.resend.mockReset();
});

describe('auth redirect safety (AC-AUTHF-030)', () => {
  it('AC-AUTHF-030: resetPasswordForEmail, signInWithOtp (magic link), and resend all pass an origin-only redirect', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    auth.signInWithOtp.mockResolvedValue({ error: null });
    auth.resend.mockResolvedValue({ error: null });
    renderProbe();

    fireEvent.click(screen.getByTestId('reset'));
    await waitFor(() => expect(auth.resetPasswordForEmail).toHaveBeenCalled());
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.test', {
      redirectTo: window.location.origin + '/update-password',
    });

    fireEvent.click(screen.getByTestId('magic-link'));
    await waitFor(() => expect(auth.signInWithOtp).toHaveBeenCalled());
    expect(auth.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.test',
        options: expect.objectContaining({ emailRedirectTo: window.location.origin }),
      })
    );

    fireEvent.click(screen.getByTestId('resend'));
    await waitFor(() => expect(auth.resend).toHaveBeenCalled());
    expect(auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'a@b.test',
      options: { emailRedirectTo: window.location.origin },
    });
  });
});
