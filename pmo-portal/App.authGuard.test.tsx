import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) })),
  },
}));

import App from './App';

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('Real application root: unauthenticated guard', () => {
  it('AC-AUTH-001 unauthenticated visit to / redirects to /login', async () => {
    window.history.pushState({}, '', '/');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeVisible();
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
  });

  it('AC-AUTH-002 deep-link to a protected route redirects to /login when logged out', async () => {
    window.history.pushState({}, '', '/projects/40000000-0000-0000-0000-000000000001');
    render(<App />);
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeVisible();
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
  });
});
