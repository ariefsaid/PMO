import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import authEn from '../../public/locales/en/auth.json';
import authId from '../../public/locales/id/auth.json';

type Analytics = typeof import('@/src/lib/analytics');

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
  resend: vi.fn(),
}));

const trackHelpers = vi.hoisted(() => ({
  trackDemoPersonaSelected: vi.fn<Analytics['trackDemoPersonaSelected']>(),
  trackAuthLoginSucceeded: vi.fn<Analytics['trackAuthLoginSucceeded']>(),
  trackAuthLoginFailed: vi.fn<Analytics['trackAuthLoginFailed']>(),
}));

const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock('react-router', async (orig) => {
  const actual = await orig<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('@/src/lib/analytics', async importOriginal => ({
  ...await importOriginal<Analytics>(),
  trackDemoPersonaSelected: trackHelpers.trackDemoPersonaSelected,
  trackAuthLoginSucceeded: trackHelpers.trackAuthLoginSucceeded,
  trackAuthLoginFailed: trackHelpers.trackAuthLoginFailed,
} satisfies Analytics));

vi.mock('@/src/lib/legalConfig', () => ({
  LEGAL_ENTITY_NAME: 'PMO Portal',
  DOMAIN: 'pmoportal.app',
  CONTACT_EMAIL: 'support@pmoportal.app',
  HELP_WHATSAPP: '6281234567890',
  HOSTING_LOCATION: 'Singapore',
  HELP_URL: 'https://wa.me/6281234567890',
}));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithPassword: auth.signInWithPassword,
      signInWithOtp: auth.signInWithOtp,
      signInWithOAuth: auth.signInWithOAuth,
      resend: auth.resend,
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
    })),
  },
}));

import { AuthProvider } from './AuthProvider';
import LoginPage from './LoginPage';

function renderLogin(from?: unknown) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[{ pathname: '/login', state: from === undefined ? undefined : { from } }]}>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

async function signInWithPassword() {
  await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
  await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
  await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

beforeEach(() => {
  auth.signInWithPassword.mockReset();
  auth.signInWithOtp.mockReset();
  auth.signInWithOAuth.mockReset();
  auth.resend.mockReset();
  trackHelpers.trackDemoPersonaSelected.mockReset();
  trackHelpers.trackAuthLoginSucceeded.mockReset();
  trackHelpers.trackAuthLoginFailed.mockReset();
  navigateSpy.mockReset();
  vi.unstubAllEnvs();
});

describe('LoginPage', () => {
  it('exposes the legal links in the page contentinfo landmark', () => {
    renderLogin();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    const footer = screen.getByRole('contentinfo');
    expect(screen.getByRole('main')).not.toContainElement(footer);
    expect(within(footer).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  });

  it('keeps a single sign-in landmark and heading without the welcome sentence', () => {
    renderLogin();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('PMO Portal')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to your account' })).toBeInTheDocument();
    expect(screen.queryByText('Welcome back. Use your work account or email to continue.')).toBeNull();
  });

  it('explains why the magic-link action is disabled and links the explanation accessibly', async () => {
    renderLogin();
    const magicLink = screen.getByRole('button', { name: /email me a magic link/i });
    expect(magicLink).toBeDisabled();
    const descriptionId = magicLink.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    const reason = document.getElementById(descriptionId!);
    expect(reason).toHaveTextContent('Enter an email above to request a sign-in link.');

    await userEvent.type(screen.getByLabelText(/email/i), 'person@example.test');
    expect(magicLink).toBeEnabled();
    expect(magicLink).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText('Enter an email above to request a sign-in link.')).toBeNull();
  });

  it('explains the busy reason while the magic-link action is disabled during sign-in', async () => {
    auth.signInWithPassword.mockReturnValue(new Promise(() => {}));
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'person@example.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    const magicLink = screen.getByRole('button', { name: /email me a magic link/i });
    expect(magicLink).toBeDisabled();
    const descriptionId = magicLink.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)).toHaveTextContent(
      'Wait for the current sign-in attempt to finish before requesting a link.',
    );
  });

  it('shows an inline error on invalid credentials (AC-AUTH-004)', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    // C4: the GoTrue string is re-worded into a sentence with a remedy, not printed verbatim.
    await waitFor(() =>
      expect(screen.getByText(/email or password is not right/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/invalid login credentials/i)).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('navigates to / on successful sign-in (FR-AUTH-020)', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('AC-CLI-012: returns to the page the guard sent the user from (the OAuth consent screen) after sign-in', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    renderLogin('/oauth/consent?authorization_id=abc123');
    await signInWithPassword();
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith('/oauth/consent?authorization_id=abc123', { replace: true }),
    );
  });

  it.each([
    ['protocol-relative', '//evil.example/steal'],
    ['backslash host', '/\\evil.example'],
    ['absolute URL', 'https://evil.example/'],
    ['not a string', { pathname: '/x' }],
    ['the login page itself', '/login'],
  ])('AC-CLI-012: an unsafe return target (%s) falls back to /', async (_label, from) => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    renderLogin(from);
    await signInWithPassword();
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('shows a check-your-email notice after requesting a magic link (FR-AUTH-022)', async () => {
    auth.signInWithOtp.mockResolvedValue({ error: null });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'engineer@acme.test');
    await userEvent.click(screen.getByRole('button', { name: /email me a magic link/i }));
    await waitFor(() =>
      expect(screen.getByText(/check your email/i)).toBeInTheDocument()
    );
  });

  // --- Design token / a11y assertions (reskin) ---

  it('renders the Sign In button as the primary action with role=button (AC-AUTH-RESKIN-001)', () => {
    renderLogin();
    const signInBtn = screen.getByRole('button', { name: /sign in/i });
    // Primary action: uses bg-primary token (class presence proves no legacy primary-NNN)
    expect(signInBtn.className).toMatch(/bg-primary/);
    // Must NOT carry legacy prototype classes
    expect(signInBtn.className).not.toMatch(/bg-primary-600/);
    expect(signInBtn.className).not.toMatch(/bg-gray-/);
  });

  it('magic-link is a tertiary action — never the primary (AC-AUTH-RESKIN-002)', () => {
    renderLogin();
    const mlBtn = screen.getByRole('button', { name: /email me a magic link/i });
    // outline variant uses border-input, NOT bg-primary
    expect(mlBtn.className).not.toMatch(/bg-primary[^-]/);
  });

  it('error state has role=alert for screen readers (AC-AUTH-RESKIN-003)', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Bad credentials' } });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'x@x.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'bad');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('magic-link sent confirmation has role=status (AC-AUTH-RESKIN-004)', async () => {
    auth.signInWithOtp.mockResolvedValue({ error: null });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'x@x.test');
    await userEvent.click(screen.getByRole('button', { name: /email me a magic link/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });

  it('shows loading spinner while submitting (AC-AUTH-RESKIN-005)', async () => {
    // Never resolves so spinner stays visible
    auth.signInWithPassword.mockReturnValue(new Promise(() => {}));
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'x@x.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'pw');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    // Button goes aria-busy during submission
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sign in/i })).toHaveAttribute('aria-busy', 'true')
    );
  });

  it('page wrapper carries no legacy dark: or gray- classes (AC-AUTH-RESKIN-006)', () => {
    const { container } = renderLogin();
    // Walk all elements checking for banned classes
    const allClasses = Array.from(container.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.classList));
    const banned = allClasses.filter(
      (c) =>
        c.startsWith('dark:') ||
        /^(bg|text|border)-gray-/.test(c) ||
        /^(bg|text|border)-primary-\d/.test(c)
    );
    expect(banned).toHaveLength(0);
  });

  it('email and password inputs have visible labels (AC-AUTH-RESKIN-007)', () => {
    renderLogin();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('demo panel: shows the demo password and admin fill button (VITE_DEMO_MODE)', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    renderLogin();
    // Password hint is visible
    expect(screen.getByText(/password: Passw0rd!dev/i)).toBeInTheDocument();
    // Admin persona button is present (matched by visible label) and fills admin@ credentials
    await userEvent.click(screen.getByRole('button', { name: /Admin/i }));
    expect(screen.getByLabelText(/email/i)).toHaveValue('admin@acme.test');
    expect(screen.getByLabelText(/password/i)).toHaveValue('Passw0rd!dev');
    vi.unstubAllEnvs();
  });

  it('demo panel is hidden on a real prod build (no DEV, no VITE_DEMO_MODE)', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DEMO_MODE', '');
    renderLogin();
    // None of the persona buttons should be present (checked by visible label)
    expect(screen.queryByRole('button', { name: /Executive/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Admin/i })).toBeNull();
    vi.unstubAllEnvs();
  });

  it('AC-DEMO-014: demo panel lists all five role personas with one-click fill', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    renderLogin();

    // All 5 persona fill buttons must be present — matched by visible label (WCAG 2.5.3)
    const personas = [
      { email: 'exec@acme.test',     label: /Executive/i },
      { email: 'pm@acme.test',       label: /Project Manager/i },
      { email: 'finance@acme.test',  label: /Finance/i },
      { email: 'engineer@acme.test', label: /Engineer/i },
      { email: 'admin@acme.test',    label: /Admin/i },
    ];

    for (const p of personas) {
      expect(screen.getByRole('button', { name: p.label })).toBeInTheDocument();
    }

    // Clicking Executive button fills exec@ credentials
    await userEvent.click(screen.getByRole('button', { name: /Executive/i }));
    expect(screen.getByLabelText(/email/i)).toHaveValue('exec@acme.test');
    expect(screen.getByLabelText(/password/i)).toHaveValue('Passw0rd!dev');

    // Clicking Engineer button switches credentials
    await userEvent.click(screen.getByRole('button', { name: /Engineer/i }));
    expect(screen.getByLabelText(/email/i)).toHaveValue('engineer@acme.test');
    expect(screen.getByLabelText(/password/i)).toHaveValue('Passw0rd!dev');

    vi.unstubAllEnvs();
  });

  it('AC-DEMO-014: demo panel does NOT render when VITE_DEMO_MODE is off (no DEV)', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DEMO_MODE', '');
    renderLogin();
    expect(screen.queryByRole('button', { name: /Executive/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Project Manager/i })).toBeNull();
    vi.unstubAllEnvs();
  });

  it('AC-PH-012: demo persona selection calls trackDemoPersonaSelected with role only, not email', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true');
    renderLogin();

    await userEvent.click(screen.getByRole('button', { name: /Executive/i }));

    expect(trackHelpers.trackDemoPersonaSelected).toHaveBeenCalledWith('Executive');
    // Verify no PII leaks through any of the tracking helpers
    const allCalls = [
      ...trackHelpers.trackDemoPersonaSelected.mock.calls,
      ...trackHelpers.trackAuthLoginSucceeded.mock.calls,
      ...trackHelpers.trackAuthLoginFailed.mock.calls,
    ];
    expect(JSON.stringify(allCalls)).not.toContain('exec@acme.test');
  });

  it('AC-PH-013: login failure calls trackAuthLoginFailed with safe args', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
    renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(trackHelpers.trackAuthLoginFailed).toHaveBeenCalledWith('password', 'invalid_credentials')
    );
    // No PII in any tracking call
    const allCalls = JSON.stringify([
      ...trackHelpers.trackAuthLoginFailed.mock.calls,
      ...trackHelpers.trackAuthLoginSucceeded.mock.calls,
    ]);
    expect(allCalls).not.toContain('pm@acme.test');
  });

  it('AC-PH-013: login success calls trackAuthLoginSucceeded with safe args', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: null });
    renderLogin();

    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(trackHelpers.trackAuthLoginSucceeded).toHaveBeenCalledWith('password')
    );
    // No PII in any tracking call
    const allCalls = JSON.stringify([
      ...trackHelpers.trackAuthLoginSucceeded.mock.calls,
      ...trackHelpers.trackAuthLoginFailed.mock.calls,
    ]);
    expect(allCalls).not.toContain('pm@acme.test');
  });

  // --- Microsoft (Entra ID) OAuth sign-in (AC-MSAUTH-001..003) ---

  it('AC-MSAUTH-001: Continue with Microsoft calls signInWithOAuth with provider azure and an origin-rooted redirectTo', async () => {
    auth.signInWithOAuth.mockResolvedValueOnce({ data: { provider: 'azure', url: 'https://x' }, error: null });
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /continue with microsoft/i }));
    await waitFor(() =>
      expect(auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'azure',
        options: {
          scopes: 'openid profile email',
          redirectTo: window.location.origin,
        },
      })
    );
    // Success path: the browser is being redirected to Microsoft — no error banner, no navigate().
    expect(screen.queryByRole('alert')).toBeNull();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('AC-MSAUTH-002: a signInWithOAuth error renders the alert banner and tracks auth_login_failed(microsoft)', async () => {
    auth.signInWithOAuth.mockResolvedValueOnce({
      data: { provider: 'azure', url: null },
      error: { message: 'Provider is not enabled' },
    });
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: /continue with microsoft/i }));
    // C4: the provider's own wording is not the sentence a person gets; the app names the remedy.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Microsoft sign-in is not set up/i));
    expect(screen.getByRole('alert').textContent ?? '').not.toMatch(/provider is not enabled/i);
    expect(trackHelpers.trackAuthLoginFailed).toHaveBeenCalledWith('microsoft', 'auth_error');
    // Recoverable: the form is usable again after the failure.
    expect(screen.getByRole('button', { name: /continue with microsoft/i })).toBeEnabled();
  });

  it('AC-MSAUTH-003: Microsoft button is a secondary (outline) action, enabled without an email', () => {
    renderLogin();
    const msBtn = screen.getByRole('button', { name: /continue with microsoft/i });
    // Secondary action: outline variant, NOT bg-primary (Sign in stays the single primary)
    expect(msBtn.className).not.toMatch(/bg-primary[^-]/);
    // Unlike the magic-link button, it needs no email typed first
    expect(msBtn).toBeEnabled();
  });

  it('AC-LEG-021: footer has Terms, Privacy, and Help links', () => {
    renderLogin();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: /^terms$/i })).toHaveAttribute('href', '/terms');
    expect(within(footer).getByRole('link', { name: /^privacy$/i })).toHaveAttribute('href', '/privacy');
    const help = within(footer).getByRole('link', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('href', 'https://wa.me/6281234567890');
    expect(help).toHaveAttribute('target', '_blank');
    expect(help).toHaveAttribute('rel', 'noopener noreferrer');
  });

  // --- Email-confirmation handling (auth-floor Slice 4) ---

  it('AC-AUTHF-025: a "email not confirmed" error renders the confirm-required state, not the generic banner', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/confirm your email/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /resend confirmation/i })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // NOT the generic error banner
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('AC-AUTHF-026: Resend calls resend({ type: signup, email, options: { emailRedirectTo: origin } })', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    auth.resend.mockResolvedValueOnce({ error: null });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /resend confirmation/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole('button', { name: /resend confirmation/i }));
    await waitFor(() =>
      expect(auth.resend).toHaveBeenCalledWith({
        type: 'signup',
        email: 'pm@acme.test',
        options: { emailRedirectTo: window.location.origin },
      })
    );
  });

  it('AC-AUTHF-027: resend success shows a status notice', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    auth.resend.mockResolvedValueOnce({ error: null });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await userEvent.click(await screen.findByRole('button', { name: /resend confirmation/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/confirmation sent/i));
  });

  it('AC-AUTHF-027: resend rate-limit shows a rate-limit message and disables the action', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    auth.resend.mockResolvedValueOnce({
      error: { message: 'For security purposes, you can only request this once every 60 seconds' },
    });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await userEvent.click(await screen.findByRole('button', { name: /resend confirmation/i }));
    await waitFor(() => expect(screen.getByText(/too many|rate limit|try again/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /resend confirmation/i })).toBeDisabled();
  });
});

describe('LoginPage — rate-limit recovery (resend cooldown and way back)', () => {
  async function reachRateLimitedResend(setup: ReturnType<typeof userEvent.setup>) {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    auth.resend.mockResolvedValueOnce({
      error: { message: 'For security purposes, you can only request this once every 60 seconds' },
    });
    const view = renderLogin();
    await setup.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await setup.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await setup.click(screen.getByRole('button', { name: /sign in/i }));
    await setup.click(await screen.findByRole('button', { name: /resend confirmation/i }));
    await waitFor(() => expect(screen.getByText(/too many|rate limit|try again/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /resend confirmation/i })).toBeDisabled();
    return view;
  }

  it('re-enables the resend action once the retry interval has elapsed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const setup = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      await reachRateLimitedResend(setup);
      // The cooldown is the server's documented 60-second retry interval.
      act(() => vi.advanceTimersByTime(60_000));
      expect(screen.getByRole('button', { name: /resend confirmation/i })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans up the cooldown timer on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const setup = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    try {
      const view = await reachRateLimitedResend(setup);
      const withCooldown = vi.getTimerCount();
      expect(withCooldown).toBeGreaterThan(0);
      view.unmount();
      expect(vi.getTimerCount()).toBeLessThan(withCooldown);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers a way back to the sign-in form from the confirm-required state', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    renderLogin();
    const setup = userEvent.setup();
    await setup.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await setup.type(screen.getByLabelText(/password/i), 'Passw0rd!dev');
    await setup.click(screen.getByRole('button', { name: /sign in/i }));
    await screen.findByRole('button', { name: /resend confirmation/i });
    await setup.click(screen.getByRole('button', { name: /back to sign in/i }));
    // The ordinary sign-in form is back.
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resend confirmation/i })).not.toBeInTheDocument();
  });
});

describe('C4: the sign-in page reads in Indonesian, and a service message is re-worded', () => {
  async function renderLocalized(locale: 'en' | 'id') {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: false,
      defaultNS: 'auth',
      resources: { en: { auth: authEn }, id: { auth: authId } },
    });
    return render(
      <I18nextProvider i18n={i18n}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/login']}>
            <LoginPage />
          </MemoryRouter>
        </AuthProvider>
      </I18nextProvider>,
    );
  }

  it('every visible word on the page comes from the auth catalogue', async () => {
    await renderLocalized('id');
    expect(screen.getByRole('heading', { level: 1, name: 'Masuk ke akun Anda' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Lanjutkan dengan Microsoft/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Kata sandi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Masuk' })).toBeInTheDocument();
    expect(screen.getByText('Masukkan email di atas untuk memakai tautan masuk.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ketentuan' })).toHaveAttribute('href', '/terms');
    // The English source must not leak beside the Indonesian copy.
    expect(screen.queryByText(/Sign in to your account/)).toBeNull();
    expect(screen.queryByText(/Continue with Microsoft/)).toBeNull();
    expect(screen.queryByText(/Enter an email above to request a sign-in link/)).toBeNull();
  });

  it('a raw GoTrue message is replaced by a sentence a person can act on, in their language', async () => {
    auth.signInWithPassword.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
    await renderLocalized('id');
    await userEvent.type(screen.getByLabelText('Email'), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText('Kata sandi'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Masuk' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Email atau kata sandi tidak cocok. Periksa keduanya lalu coba lagi.');
    expect(alert.textContent ?? '').not.toMatch(/Invalid login credentials/);
  });
});
