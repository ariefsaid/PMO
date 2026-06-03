import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';

// Mutable session/profile the mocked client returns; reset per test.
const state = vi.hoisted(() => ({
  session: null as unknown,
  profile: null as unknown,
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
              Promise.resolve({ data: state.profile, error: null })
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
});

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(/AuthProvider/);
  });
});

function Probe() {
  const { currentUser, role } = useAuth();
  return (
    <div>
      {currentUser?.full_name}|{role}
    </div>
  );
}

describe('AuthProvider', () => {
  it('exposes profile and role from the session (AC-AUTH-007)', async () => {
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
});
