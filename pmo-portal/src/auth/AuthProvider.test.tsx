import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';

const trackAuthLogoutSucceeded = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/analytics', () => ({ trackAuthLogoutSucceeded }));

// Mutable session/profile the mocked client returns; reset per test.
const state = vi.hoisted(() => ({
  session: null as unknown,
  profile: null as unknown,
  profileError: null as unknown,
  // Optional manual queue of deferred `single` resolvers for the stale-read ordering test.
  // When non-null, each profiles `.single()` call shifts the next producer off the queue;
  // the fallback below reads `state.profile`/`state.profileError` live.
  nextSingles: null as null | Array<() => Promise<{ data: unknown; error: unknown }>>,
  authChange: null as null | ((event: string, session: unknown) => void),
  sessionPromise: null as null | Promise<{ data: { session: unknown } }>,
}));

// A deferred promise helper so a test can control WHEN a profile read resolves.
const defer = () => {
  let resolve!: (v: { data: unknown; error: unknown }) => void;
  const promise = new Promise<{ data: unknown; error: unknown }>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const mockedReset = vi.hoisted(() => vi.fn());
const mockedUpdate = vi.hoisted(() => vi.fn());
const mockedResend = vi.hoisted(() => vi.fn());

vi.mock('@/src/lib/supabase/client', () => {
  return {
    supabase: {
      auth: {
        getSession: vi.fn().mockImplementation(() =>
          state.sessionPromise ?? Promise.resolve({ data: { session: state.session } })
        ),
        onAuthStateChange: vi.fn((callback: (event: string, session: unknown) => void) => {
          state.authChange = callback;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        }),
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
            single: vi.fn().mockImplementation(() => {
              if (state.nextSingles && state.nextSingles.length > 0) {
                const producer = state.nextSingles.shift()!;
                return producer();
              }
              return Promise.resolve({ data: state.profile, error: state.profileError });
            }),
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
  state.nextSingles = null;
  state.authChange = null;
  state.sessionPromise = null;
});

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(/AuthProvider/);
  });
});

function Probe() {
  const { currentUser, role, profileError, profileErrorKind } = useAuth();
  return (
    <div>
      {currentUser?.full_name}|{role}
      {profileError && <span data-testid="profile-error">{profileError}</span>}
      {profileErrorKind && <span data-testid="profile-error-kind">{profileErrorKind}</span>}
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

  // AC-MSAUTH-010: a zero-rows PostgREST error (PGRST116 — "Cannot coerce the result
  // to a single JSON object") means the user has no `profiles` row yet (e.g. signed in
  // via SSO before being invited). Classify it as "not_provisioned", not a generic error.
  it('AC-MSAUTH-010: classifies a PGRST116 profile-fetch error as profileErrorKind=not_provisioned', async () => {
    state.session = { user: { id: '00000000-0000-0000-0000-0000000000fe' } };
    state.profile = null;
    state.profileError = {
      message: 'Cannot coerce the result to a single JSON object',
      code: 'PGRST116',
    };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('profile-error-kind')).toHaveTextContent('not_provisioned')
    );
  });

  it('AC-MSAUTH-011: classifies a generic (non-PGRST116) profile-fetch error as profileErrorKind=load_error', async () => {
    state.session = { user: { id: '00000000-0000-0000-0000-0000000000fd' } };
    state.profile = null;
    state.profileError = { message: 'network timeout', code: '57014' };

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() =>
      expect(screen.getByTestId('profile-error-kind')).toHaveTextContent('load_error')
    );
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
    expect(screen.queryByTestId('profile-error-kind')).toBeNull();
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

// ── Auth refresh contract (profile language settings slice) ─────────────────
function RefreshProbe() {
  const { currentUser, refreshCurrentUser } = useAuth();
  const [result, setResult] = useState<string | null>(null);
  return (
    <div>
      <span data-testid="refresh-locale">{currentUser?.locale ?? 'none'}</span>
      <button
        data-testid="refresh"
        onClick={() => void refreshCurrentUser().then((r) => setResult(JSON.stringify(r)))}
      />
      {result && <span data-testid="refresh-result">{result}</span>}
    </div>
  );
}

function profileFor(id: string, locale: string): Record<string, unknown> {
  return {
    id,
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
    locale,
    number_locale: 'id-ID',
    timezone: 'Asia/Jakarta',
  };
}

describe('AuthProvider refreshCurrentUser (profile language settings slice)', () => {
  it('keeps a newer auth event when an older initial session read resolves afterward', async () => {
    let resolveInitial!: (value: { data: { session: unknown } }) => void;
    state.sessionPromise = new Promise((resolve) => { resolveInitial = resolve; });
    state.profile = profileFor('u-current', 'id');
    function IdentityProbe() {
      const { currentUser } = useAuth();
      return <span data-testid="identity">{currentUser?.id ?? 'none'}</span>;
    }
    render(<AuthProvider><IdentityProbe /></AuthProvider>);
    await act(async () => state.authChange?.('SIGNED_IN', { user: { id: 'u-current' } }));
    await waitFor(() => expect(screen.getByTestId('identity')).toHaveTextContent('u-current'));

    state.profile = profileFor('u-old', 'en');
    await act(async () => resolveInitial({ data: { session: { user: { id: 'u-old' } } } }));
    expect(screen.getByTestId('identity')).toHaveTextContent('u-current');
  });

  it('suspends the previous profile while a different session profile loads', async () => {
    state.session = { user: { id: 'u-switch-a' } };
    state.profile = profileFor('u-switch-a', 'en');
    function TransitionProbe() {
      const { currentUser, loading } = useAuth();
      return <span data-testid="transition">{currentUser?.id ?? 'none'}|{loading ? 'loading' : 'ready'}</span>;
    }
    render(<AuthProvider><TransitionProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('transition')).toHaveTextContent('u-switch-a|ready'));

    const next = defer();
    state.nextSingles = [() => next.promise];
    await act(async () => state.authChange?.('SIGNED_IN', { user: { id: 'u-switch-b' } }));
    expect(screen.getByTestId('transition')).toHaveTextContent('none|loading');

    await act(async () => next.resolve({ data: profileFor('u-switch-b', 'id'), error: null }));
    await waitFor(() => expect(screen.getByTestId('transition')).toHaveTextContent('u-switch-b|ready'));
  });

  it('lets a manual profile refresh finish across a same-user token event', async () => {
    state.session = { user: { id: 'u-refresh-token' } };
    state.profile = profileFor('u-refresh-token', 'en');
    render(<AuthProvider><RefreshProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('refresh-locale')).toHaveTextContent('en'));

    const refreshed = defer();
    state.nextSingles = [() => refreshed.promise];
    fireEvent.click(screen.getByTestId('refresh'));
    await act(async () => state.authChange?.('TOKEN_REFRESHED', { user: { id: 'u-refresh-token' } }));
    await act(async () => refreshed.resolve({ data: profileFor('u-refresh-token', 'id'), error: null }));
    await waitFor(() => expect(screen.getByTestId('refresh-locale')).toHaveTextContent('id'));
    expect(screen.getByTestId('refresh-result')).toHaveTextContent(JSON.stringify({ error: null }));
  });

  it('still reloads the profile on a same-user auth event when no manual refresh is running', async () => {
    state.session = { user: { id: 'u-same' } };
    state.profile = profileFor('u-same', 'en');
    render(<AuthProvider><RefreshProbe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('refresh-locale')).toHaveTextContent('en'));
    state.profile = profileFor('u-same', 'id');
    await act(async () => state.authChange?.('USER_UPDATED', { user: { id: 'u-same' } }));
    await waitFor(() => expect(screen.getByTestId('refresh-locale')).toHaveTextContent('id'));
  });

  it('refreshCurrentUser replaces currentUser from a fresh profile read (AC-L10N-060 support)', async () => {
    state.session = { user: { id: 'u-refresh-1' } };
    state.profile = profileFor('u-refresh-1', 'en');
    render(
      <AuthProvider>
        <RefreshProbe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('refresh-locale')).toHaveTextContent('en'));

    state.profile = profileFor('u-refresh-1', 'id');
    fireEvent.click(screen.getByTestId('refresh'));

    await waitFor(() => expect(screen.getByTestId('refresh-locale')).toHaveTextContent('id'));
    expect(screen.getByTestId('refresh-result').textContent).toBe(JSON.stringify({ error: null }));
  });

  it('refreshCurrentUser returns an error and preserves the current profile when the refresh read fails', async () => {
    state.session = { user: { id: 'u-refresh-2' } };
    state.profile = profileFor('u-refresh-2', 'en');
    render(
      <AuthProvider>
        <RefreshProbe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('refresh-locale')).toHaveTextContent('en'));

    state.profileError = { message: 'profile refresh failed', code: '57014' };
    fireEvent.click(screen.getByTestId('refresh'));

    await waitFor(() =>
      expect(screen.getByTestId('refresh-result').textContent).toContain('profile refresh failed')
    );
    expect(screen.getByTestId('refresh-result').textContent).toContain('"error"');
    // The previously usable profile must be preserved, not cleared to null.
    expect(screen.getByTestId('refresh-locale')).toHaveTextContent('en');
  });

  it('rejects a stale profile read that completes after a newer refresh (ordering guard)', async () => {
    const p1 = defer(); // initial load from apply()
    const p2 = defer(); // manual refresh
    state.nextSingles = [() => p1.promise, () => p2.promise];
    state.session = { user: { id: 'u-refresh-3' } };
    render(
      <AuthProvider>
        <RefreshProbe />
      </AuthProvider>
    );

    // Flush the getSession/apply microtask so the session mirror is populated (and the initial
    // read has pulled P1) BEFORE triggering the manual refresh — but P1 stays unresolved.
    await new Promise((r) => setTimeout(r, 0));

    // Trigger the manual refresh BEFORE the initial (deferred) read resolves.
    fireEvent.click(screen.getByTestId('refresh'));
    // The refresh read resolves first with locale 'id'.
    p2.resolve({ data: profileFor('u-refresh-3', 'id'), error: null });
    await waitFor(() => expect(screen.getByTestId('refresh-locale')).toHaveTextContent('id'));

    // The OLDER initial read now resolves with a stale 'en' — it must NOT overwrite 'id'.
    p1.resolve({ data: profileFor('u-refresh-3', 'en'), error: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('refresh-locale')).toHaveTextContent('id');
  });
});

describe('AuthProvider signOut analytics (auth_logout_succeeded, 2026-07-13 wiring plan)', () => {
  function SignOutProbe() {
    const { signOut } = useAuth();
    const [done, setDone] = useState(false);
    return (
      <>
        <button
          data-testid="sign-out"
          onClick={() => void signOut().then(() => setDone(true))}
        >
          Sign out
        </button>
        {done && <span data-testid="sign-out-done" />}
      </>
    );
  }

  it('AC: a completed signOut fires trackAuthLogoutSucceeded via the facade', async () => {
    trackAuthLogoutSucceeded.mockClear();
    const { supabase } = await import('@/src/lib/supabase/client');
    (supabase.auth.signOut as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ error: null });

    render(
      <AuthProvider>
        <SignOutProbe />
      </AuthProvider>
    );
    fireEvent.click(screen.getByTestId('sign-out'));

    await waitFor(() => expect(trackAuthLogoutSucceeded).toHaveBeenCalledTimes(1));
    expect(trackAuthLogoutSucceeded).toHaveBeenCalledWith();
  });

  it('FIX 2: a signOut that returns { error } does NOT fire trackAuthLogoutSucceeded', async () => {
    trackAuthLogoutSucceeded.mockClear();
    const { supabase } = await import('@/src/lib/supabase/client');
    (supabase.auth.signOut as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: { message: 'network error', name: 'AuthApiError', status: 500 },
    });

    render(
      <AuthProvider>
        <SignOutProbe />
      </AuthProvider>
    );
    fireEvent.click(screen.getByTestId('sign-out'));

    // Wait for the probe's own promise-chain completion signal (not just the
    // signOut call) so the assertion isn't racing the still-in-flight handler.
    await waitFor(() => expect(screen.getByTestId('sign-out-done')).toBeInTheDocument());
    expect(trackAuthLogoutSucceeded).not.toHaveBeenCalled();
  });
});
