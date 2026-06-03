import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';

// Mutable session/profile the mocked client returns; reset per test.
const state = vi.hoisted(() => ({
  session: null as unknown,
  profile: null as unknown,
  profileError: null as unknown,
}));

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
