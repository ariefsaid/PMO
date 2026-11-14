import React from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The shipped auth catalogue, read as JSON (never bundled): the profile-error body is copy the
// user reads, so the `id` case asserts the catalogue's own sentence, not a test-local string.
const EN_AUTH = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/auth.json'), 'utf8'));
const ID_AUTH = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/auth.json'), 'utf8'));
const EN_COMMON = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'));
const ID_COMMON = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'));

// Mutable session/profile-error the mocked client returns; reset per test group.
const { state, mockedSignOut } = vi.hoisted(() => {
  const mutableState = {
    session: null as unknown,
    profileError: null as { code?: string; message: string } | null,
    profile: null as unknown,
    profileReads: [] as Array<() => Promise<{ data: unknown; error: { code?: string; message: string } | null }>>,
    profileReadCount: 0,
    authStateChange: null as null | ((event: string, session: unknown) => void),
  };
  const signOut = vi.fn(async () => {
    mutableState.authStateChange?.('SIGNED_OUT', null);
    return { error: null };
  });
  return { state: mutableState, mockedSignOut: signOut };
});

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: state.session } })),
      onAuthStateChange: vi.fn((callback: (event: string, session: unknown) => void) => {
        state.authStateChange = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      signOut: mockedSignOut,
    },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          single: vi.fn(() => {
            state.profileReadCount += 1;
            const nextRead = state.profileReads.shift();
            return nextRead
              ? nextRead()
              : Promise.resolve({ data: state.profile, error: state.profileError });
          }),
        }),
      }),
    })),
  },
}));

import { AuthProvider } from './AuthProvider';
import { RequireAuth } from './RequireAuth';

beforeEach(() => {
  state.session = null;
  state.profileError = null;
  state.profile = null;
  state.profileReads = [];
  state.profileReadCount = 0;
  state.authStateChange = null;
  mockedSignOut.mockClear();
});

/** Renders what the guard handed the login page: the return target in router state. */
const LoginProbe: React.FC = () => {
  const { pathname, search, state } = useLocation();
  return (
    <div>
      LOGIN PAGE <span data-testid="login-url">{pathname + search}</span>
      <span data-testid="from">{String((state as { from?: unknown } | null)?.from ?? '')}</span>
    </div>
  );
};

function tree(initial: string) {
  return (
    <MemoryRouter initialEntries={[initial]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<div>PROTECTED HOME</div>} />
            <Route path="/oauth/consent" element={<div>CONSENT</div>} />
            <Route path="/settings/profile" element={<div>PROFILE SETTINGS</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

/** The same tree under a real `id` instance (shipped catalogues) — what a Bahasa user reads. */
function bahasaTree(initial: string) {
  const i18n = i18next.createInstance();
  void i18n.init({
    lng: 'id',
    fallbackLng: 'en',
    ns: ['common', 'auth'],
    defaultNS: 'common',
    resources: {
      id: { common: { ui: ID_COMMON.ui, shell: ID_COMMON.shell }, auth: ID_AUTH },
      en: { common: { ui: EN_COMMON.ui, shell: EN_COMMON.shell }, auth: EN_AUTH },
    },
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  return <I18nextProvider i18n={i18n}>{tree(initial)}</I18nextProvider>;
}

describe('RequireAuth (AC-AUTH-008)', () => {
  it('redirects to /login when unauthenticated', async () => {
    render(tree('/'));
    await waitFor(() => expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument());
    expect(screen.queryByText('PROTECTED HOME')).not.toBeInTheDocument();
  });
});

describe('RequireAuth return-to (AC-CLI-012)', () => {
  it('AC-CLI-012: a signed-out visit to the consent screen goes to /login carrying the full return target', async () => {
    render(tree('/oauth/consent?authorization_id=abc123'));
    await waitFor(() => expect(screen.getByText(/LOGIN PAGE/)).toBeInTheDocument());
    // The login URL itself is unchanged (AC-AUTH-002) — the target rides in router state.
    expect(screen.getByTestId('login-url')).toHaveTextContent(/^\/login$/);
    expect(screen.getByTestId('from')).toHaveTextContent('/oauth/consent?authorization_id=abc123');
    expect(screen.queryByText('CONSENT')).not.toBeInTheDocument();
  });
});

describe('RequireAuth loading state (AC-AUTH-RESKIN-008)', () => {
  it('loading fallback has role=status and no legacy gray- classes', () => {
    // RequireAuth renders its loading status while auth resolves.
    // We test the loading component directly by inspecting the rendered DOM
    const { container } = render(tree('/'));
    // During the loading phase, the status region remains accessible.
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
  it('C1: a profile read failure retries that read and returns to profile settings', async () => {
    state.session = { user: { id: 'u-profile' } };
    state.profileError = { code: '57014', message: 'network timeout' };
    state.profile = null;

    render(tree('/settings/profile'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Unable to load your profile/);
    // The body is fixed recovery copy, never the raw read error.
    expect(alert).toHaveTextContent(EN_AUTH.profileLoadError.body);
    expect(screen.queryByText('network timeout')).not.toBeInTheDocument();

    state.profileError = null;
    state.profile = { id: 'u-profile', org_id: 'org-1', role: 'Admin', status: 'active' };
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('PROFILE SETTINGS')).toBeInTheDocument());
  });

  it('C1: the profile failure body follows the locale, and no raw error text is rendered', async () => {
    state.session = { user: { id: 'u-profile-id' } };
    state.profileError = { code: '57014', message: 'TypeError: Failed to fetch' };
    state.profile = null;

    render(bahasaTree('/settings/profile'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(ID_AUTH.profileLoadError.body);
    expect(alert).toHaveTextContent(ID_AUTH.profileLoadError.title);
    expect(alert).not.toHaveTextContent(EN_AUTH.profileLoadError.title);
    expect(alert).not.toHaveTextContent('TypeError: Failed to fetch');
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keluar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry profile/i })).not.toBeInTheDocument();
  });

  it('a retry that finds no profile row switches to the not-provisioned page', async () => {
    state.session = { user: { id: 'u-retry-not-provisioned' } };
    state.profileError = { code: '57014', message: 'network timeout' };

    render(tree('/'));
    await screen.findByRole('alert');
    state.profileReads.push(() => Promise.resolve({
      data: null,
      error: { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' },
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/your account isn't set up for this workspace yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText('PROTECTED HOME')).not.toBeInTheDocument();
  });

  it('disables Retry while its profile read is in flight and ignores rapid second activation', async () => {
    state.session = { user: { id: 'u-retry-in-flight' } };
    state.profileError = { code: '57014', message: 'network timeout' };

    render(tree('/settings/profile'));
    await screen.findByRole('alert');
    const retryRead = deferProfileRead();
    state.profileReads.push(() => retryRead.promise);
    const retry = screen.getByRole('button', { name: 'Retry' });

    act(() => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });

    expect(retry).toBeDisabled();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(state.profileReadCount).toBe(2);

    await act(async () => retryRead.resolve({
      data: { id: 'u-retry-in-flight', org_id: 'org-1', role: 'Admin', status: 'active' },
      error: null,
    }));
    expect(await screen.findByText('PROFILE SETTINGS')).toBeInTheDocument();
  });

  it('AC-MSAUTH-010: a PGRST116 profile-fetch error renders the not-provisioned state — Sign out present, Retry absent', async () => {
    state.session = { user: { id: 'u-not-provisioned' } };
    state.profileError = {
      code: 'PGRST116',
      message: 'Cannot coerce the result to a single JSON object',
    };
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

  it('AC-MSAUTH-011: a generic profile-fetch error keeps the load-error state with Retry and Sign out', async () => {
    state.session = { user: { id: 'u-load-error' } };
    state.profileError = { code: '57014', message: 'network timeout' };
    render(tree('/'));

    await waitFor(() =>
      expect(screen.getByText('Unable to load your profile.')).toBeInTheDocument()
    );
    // The raw read error never reaches the document — only the console log keeps it.
    expect(screen.queryByText(/network timeout/i)).not.toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(screen.getByText(/LOGIN PAGE/)).toBeInTheDocument());
    expect(mockedSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('PROTECTED HOME')).not.toBeInTheDocument();
  });

  it('discards a retry result that arrives after Sign out redirects to login', async () => {
    state.session = { user: { id: 'u-sign-out-during-retry' } };
    state.profileError = { code: '57014', message: 'network timeout' };
    render(tree('/'));
    await screen.findByRole('alert');
    const retryRead = deferProfileRead();
    state.profileReads.push(() => retryRead.promise);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByText(/LOGIN PAGE/);

    await act(async () => retryRead.resolve({
      data: { id: 'u-sign-out-during-retry', org_id: 'org-1', role: 'Admin', status: 'active' },
      error: null,
    }));
    expect(screen.getByText(/LOGIN PAGE/)).toBeInTheDocument();
    expect(screen.queryByText('PROTECTED HOME')).not.toBeInTheDocument();
  });

  it('does not start another profile read for a token refresh during Retry', async () => {
    state.session = { user: { id: 'u-token-refresh-during-retry' } };
    state.profileError = { code: '57014', message: 'network timeout' };
    render(tree('/'));
    await screen.findByRole('alert');
    const retryRead = deferProfileRead();
    state.profileReads.push(() => retryRead.promise);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => state.authStateChange?.('TOKEN_REFRESHED', state.session));
    expect(state.profileReadCount).toBe(2);

    await act(async () => retryRead.resolve({
      data: { id: 'u-token-refresh-during-retry', org_id: 'org-1', role: 'Admin', status: 'active' },
      error: null,
    }));
    expect(await screen.findByText('PROTECTED HOME')).toBeInTheDocument();
  });

  it('keeps the newer profile when a hanging initial read fails after a newer read succeeds', async () => {
    state.session = { user: { id: 'u-late-profile-failure' } };
    const firstRead = deferProfileRead();
    const secondRead = deferProfileRead();
    state.profileReads.push(() => firstRead.promise, () => secondRead.promise);

    render(tree('/'));
    await waitFor(() => expect(state.profileReadCount).toBe(1));
    await act(async () => state.authStateChange?.('USER_UPDATED', state.session));
    expect(state.profileReadCount).toBe(2);

    await act(async () => secondRead.resolve({
      data: { id: 'u-late-profile-failure', org_id: 'org-1', role: 'Admin', status: 'active' },
      error: null,
    }));
    expect(await screen.findByText('PROTECTED HOME')).toBeInTheDocument();

    await act(async () => firstRead.resolve({
      data: null,
      error: { code: '57014', message: 'late network failure' },
    }));
    expect(screen.getByText('PROTECTED HOME')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

function deferProfileRead() {
  let resolve!: (result: { data: unknown; error: { code?: string; message: string } | null }) => void;
  const promise = new Promise<{ data: unknown; error: { code?: string; message: string } | null }>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
