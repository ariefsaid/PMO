import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor, fireEvent } from '@testing-library/react';

// Mutable session/profile the mocked client returns; reset per test.
const state = vi.hoisted(() => ({
  session: null as unknown,
  profile: null as unknown,
  profileError: null as unknown,
}));

const mockedReset = vi.hoisted(() => vi.fn());
const mockedUpdate = vi.hoisted(() => vi.fn());
const mockedResend = vi.hoisted(() => vi.fn());

vi.mock('@/src/lib/supabase/client', () => {
  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockImplementation(() =>
          Promise.resolve({ data: { session: state.session } })
        ),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        signInWithPassword: vi.fn(),
        signInWithOtp: vi.fn(),
        resetPasswordForEmail: mockedReset,
        updateUser: mockedUpdate,
        resend: mockedResend,
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            single: vi.fn().mockImplementation(() =>
              Promise.resolve({ data: state.profile, error: state.profileError })
            ),
          }),
        }),
      })),
    },
  };
});

import { useAuth } from './useAuth';
import { AuthProvider } from './AuthProvider';

beforeEach(() => {
  state.session = null;
  state.profile = null;
  state.profileError = null;
});

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(/AuthProvider/);
  });
});

function Probe() {
  const { currentUser, role, profileError } = useAuth();
  return (
    <div>
      {currentUser?.full_name}|{role}
      {profileError && <span data-testid="profile-error">{profileError}</span>}
    </div>
  );
}

describe('AuthProvider', () => {
  it('exposes profile and role from the session (AC-AUTH-007)', async () => {
    // This test is also the canonical unit-level coverage for AC-AUTH-007.
    state.session = { user: { id: '00000000-0000-0000-0000-0000000000a2' } };
    state.profile = {
      id: '00000000-0000-0000-0000-0000000000a2',
      full_name: 'Alice Manager',
      role: 'Project Manager',
      email: 'pm@acme.test',
      org_id: '00000000-0000-0000-0000-000000000001',
      company_id: null,
      avatar_url: null,
      title: null,
      location: null,
      skills: [],
      utilization: null,
      created_at: '',
      updated_at: '',
    };
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(screen.getByText('Alice Manager|Project Manager')).toBeInTheDocument()
    );
  });

  it('sets profileError when session exists but profile fetch fails', async () => {
    // Regression guard: a failed profiles row must NOT produce a silent blank app.
    // This is the canonical unit-level coverage for AC-AUTH-008.
    state.session = { user: { id: '00000000-0000-0000-0000-0000000000ff' } };
    state.profile = null;
    state.profileError = { message: 'Profile not found', code: 'PGRST116' };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('profile-error')).toBeInTheDocument()
    );
    expect(screen.getByTestId('profile-error').textContent).toMatch(/profile/i);
  });

  it('keeps currentUser null and clears profileError when there is no session', async () => {
    state.session = null;
    state.profile = null;
    state.profileError = null;

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.queryByTestId('profile-error')).toBeNull());
  });
});

describe('AuthContext auth-floor methods', () => {
  beforeEach(() => {
    mockedReset.mockReset();
    mockedUpdate.mockReset();
    mockedResend.mockReset();
  });

  // Probe that exposes the three new useAuth() methods via test-id anchors so the
  // test can await each Promise and assert the mocked-client call args + return shape.
  function MethodsProbe() {
    const { requestPasswordReset, updatePassword, resendEmailConfirmation } = useAuth();
    return (
      <div>
        <button
          data-testid="reset"
          onClick={() => void requestPasswordReset('x@example.com').then((r) => {
            document.getElementById('out')!.textContent = JSON.stringify(r);
          })}
        />
        <button
          data-testid="update"
          onClick={() => void updatePassword('NewPass1!').then((r) => {
            document.getElementById('out')!.textContent = JSON.stringify(r);
          })}
        />
        <button
          data-testid="resend"
          onClick={() => void resendEmailConfirmation('x@example.com').then((r) => {
            document.getElementById('out')!.textContent = JSON.stringify(r);
          })}
        />
        <span id="out" data-testid="out" />
      </div>
    );
  }

  it('AC-AUTHF-011/015: requestPasswordReset calls resetPasswordForEmail with origin-rooted redirectTo', async () => {
    mockedReset.mockResolvedValueOnce({ error: null });
    render(
      <AuthProvider>
        <MethodsProbe />
      </AuthProvider>
    );
    fireEvent.click(screen.getByTestId('reset'));
    await waitFor(() => expect(mockedReset).toHaveBeenCalled());
    expect(mockedReset).toHaveBeenCalledWith('x@example.com', {
      redirectTo: 'http://localhost:3000/update-password',
    });
    await waitFor(() =>
      expect(screen.getByTestId('out').textContent).toBe(JSON.stringify({ error: null }))
    );
  });

  it('AC-AUTHF-022/035: updatePassword sends password + invite_pending=false in one call', async () => {
    mockedUpdate.mockResolvedValueOnce({ error: null });
    render(
      <AuthProvider>
        <MethodsProbe />
      </AuthProvider>
    );
    fireEvent.click(screen.getByTestId('update'));
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
    expect(mockedUpdate).toHaveBeenCalledWith({
      password: 'NewPass1!',
      data: { invite_pending: false },
    });
    await waitFor(() =>
      expect(screen.getByTestId('out').textContent).toBe(JSON.stringify({ error: null }))
    );
  });

  it('AC-AUTHF-041: resendEmailConfirmation calls resend({ type: signup, email, origin redirect })', async () => {
    mockedResend.mockResolvedValueOnce({ error: null });
    render(
      <AuthProvider>
        <MethodsProbe />
      </AuthProvider>
    );
    fireEvent.click(screen.getByTestId('resend'));
    await waitFor(() => expect(mockedResend).toHaveBeenCalled());
    expect(mockedResend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'x@example.com',
      options: { emailRedirectTo: 'http://localhost:3000' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('out').textContent).toBe(JSON.stringify({ error: null }))
    );
  });
});

// AUDIT-M11 (2026-07-04 audit): a rejected getSession() must resolve loading (signed-out),
// not strand the app on the loading screen forever.
describe('AuthProvider getSession rejection', () => {
  it('treats a rejected getSession as signed-out and finishes loading', async () => {
    const { supabase } = await import('@/src/lib/supabase/client');
    (supabase.auth.getSession as ReturnType<typeof vi.fn>).mockImplementationOnce(() =>
      Promise.reject(new Error('network down'))
    );

    function LoadingProbe() {
      const { loading, currentUser } = useAuth();
      return <div data-testid="state">{loading ? 'loading' : `done|${currentUser === null}`}</div>;
    }

    render(
      <AuthProvider>
        <LoadingProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('done|true'));
  });
});
