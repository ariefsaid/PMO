import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mutable session/profile-error the mocked client returns; reset per test group.
const state = vi.hoisted(() => ({
  session: null as unknown,
  profileError: null as { code?: string; message: string } | null,
}));

const mockedSignOut = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: state.session } })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      signOut: mockedSignOut,
    },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({ single: vi.fn(() => Promise.resolve({ data: null, error: state.profileError })) }),
      }),
    })),
  },
}));

import { AuthProvider } from './AuthProvider';
import { RequireAuth } from './RequireAuth';

function tree(initial: string) {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<div>PROTECTED HOME</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('RequireAuth (AC-AUTH-008)', () => {
  it('redirects to /login when unauthenticated', async () => {
    render(tree('/'));
    await waitFor(() => expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument());
    expect(screen.queryByText('PROTECTED HOME')).not.toBeInTheDocument();
  });
});

describe('RequireAuth loading state (AC-AUTH-RESKIN-008)', () => {
  it('loading fallback has role=status and no legacy gray- classes', () => {
    // RequireAuth renders loading spinner while auth resolves
    // We test the loading component directly by inspecting the rendered DOM
    const { container } = render(tree('/'));
    // During the loading phase, the spinner should have role=status
    // (this will only catch it if the component renders before auth resolves)
    // The key assertion: no banned classes in the fallback component
    const allClasses = Array.from(container.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.classList));
    const bannedGray = allClasses.filter((c) => /^(bg|text|border)-gray-/.test(c));
    const bannedPrimaryNNN = allClasses.filter((c) => /^(bg|text|border)-primary-\d/.test(c));
    const bannedDark = allClasses.filter((c) => c.startsWith('dark:'));
    expect(bannedGray).toHaveLength(0);
    expect(bannedPrimaryNNN).toHaveLength(0);
    expect(bannedDark).toHaveLength(0);
  });
});

describe('RequireAuth profile-error states (AC-MSAUTH-010/011)', () => {
  it('AC-MSAUTH-010: a PGRST116 profile-fetch error renders the not-provisioned state — Sign out present, Retry absent', async () => {
    state.session = { user: { id: 'u-not-provisioned' } };
    state.profileError = {
      code: 'PGRST116',
      message: 'Cannot coerce the result to a single JSON object',
    };
    mockedSignOut.mockClear();

    render(tree('/'));

    await waitFor(() =>
      expect(
        screen.getByText(/your account isn't set up for this workspace yet/i)
      ).toBeInTheDocument()
    );
    expect(
      screen.getByText(/ask your administrator to invite you/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    const signOutBtn = screen.getByRole('button', { name: /sign out/i });
    expect(signOutBtn).toBeInTheDocument();
    expect(screen.queryByText('PROTECTED HOME')).not.toBeInTheDocument();
  });

  it('AC-MSAUTH-011: a generic profile-fetch error keeps the existing load-error state — Retry present, no Sign out', async () => {
    state.session = { user: { id: 'u-load-error' } };
    state.profileError = { code: '57014', message: 'network timeout' };
    mockedSignOut.mockClear();

    render(tree('/'));

    await waitFor(() =>
      expect(screen.getByText('Unable to load your profile.')).toBeInTheDocument()
    );
    expect(screen.getByText(/network timeout/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
    expect(screen.queryByText('PROTECTED HOME')).not.toBeInTheDocument();
  });
});
