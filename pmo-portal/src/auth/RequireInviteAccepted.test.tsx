import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const state = vi.hoisted(() => ({
  session: null as unknown,
  profile: null as unknown,
}));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: state.session } })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({ single: vi.fn(() => Promise.resolve({ data: state.profile, error: null })) }),
      }),
    })),
  },
}));

import { AuthProvider } from './AuthProvider';
import { RequireAuth } from './RequireAuth';
import { RequireInviteAccepted } from './RequireInviteAccepted';

function tree(initial: string) {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <AuthProvider>
        <Routes>
          <Route path="/update-password" element={<div>UPDATE PASSWORD PAGE</div>} />
          <Route element={<RequireAuth />}>
            <Route element={<RequireInviteAccepted />}>
              <Route path="/" element={<div>PROTECTED HOME</div>} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('RequireInviteAccepted (AC-AUTHF-016)', () => {
  it('AC-AUTHF-016: a signed-in user with user_metadata.invite_pending===true is redirected to /update-password', async () => {
    state.session = { user: { id: 'u1', user_metadata: { invite_pending: true } } };
    state.profile = {
      id: 'u1',
      role: 'Project Manager',
      full_name: 'Invitee',
      email: 'invitee@example.com',
    };
    render(tree('/'));
    await waitFor(() => expect(screen.getByText('UPDATE PASSWORD PAGE')).toBeInTheDocument());
    expect(screen.queryByText('PROTECTED HOME')).toBeNull();
  });

  it('AC-AUTHF-016: a recovery-only session (invite_pending absent) is NOT redirected by the gate (D-AUTHF-14)', async () => {
    state.session = { user: { id: 'u1', user_metadata: {} } };
    state.profile = {
      id: 'u1',
      role: 'Project Manager',
      full_name: 'PM',
      email: 'pm@acme.test',
    };
    render(tree('/'));
    await waitFor(() => expect(screen.getByText('PROTECTED HOME')).toBeInTheDocument());
    expect(screen.queryByText('UPDATE PASSWORD PAGE')).toBeNull();
  });
});
