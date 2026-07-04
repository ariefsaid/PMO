import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
}));

const trackHelpers = vi.hoisted(() => ({
  trackDemoPersonaSelected: vi.fn(),
  trackAuthLoginSucceeded: vi.fn(),
  trackAuthLoginFailed: vi.fn(),
}));

const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('@/src/lib/analytics', () => ({
  trackDemoPersonaSelected: trackHelpers.trackDemoPersonaSelected,
  trackAuthLoginSucceeded: trackHelpers.trackAuthLoginSucceeded,
  trackAuthLoginFailed: trackHelpers.trackAuthLoginFailed,
}));

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
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
    })),
  },
}));

import { AuthProvider } from './AuthProvider';
import LoginPage from './LoginPage';

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </AuthProvider>
  );
}

beforeEach(() => {
  auth.signInWithPassword.mockReset();
  auth.signInWithOtp.mockReset();
  trackHelpers.trackDemoPersonaSelected.mockReset();
  trackHelpers.trackAuthLoginSucceeded.mockReset();
  trackHelpers.trackAuthLoginFailed.mockReset();
  navigateSpy.mockReset();
  vi.unstubAllEnvs();
});

describe('LoginPage', () => {
  it('shows an inline error on invalid credentials (AC-AUTH-004)', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'pm@acme.test');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() =>
      expect(screen.getByText(/invalid login credentials/i)).toBeInTheDocument()
    );
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

  it('shows a check-your-email notice after requesting a magic link (FR-AUTH-022)', async () => {
    auth.signInWithOtp.mockResolvedValue({ error: null });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/email/i), 'engineer@acme.test');
    await userEvent.click(screen.getByRole('button', { name: /send magic link/i }));
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

  it('renders magic-link button as outline/secondary — not primary (AC-AUTH-RESKIN-002)', () => {
    renderLogin();
    const mlBtn = screen.getByRole('button', { name: /send magic link/i });
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
    await userEvent.click(screen.getByRole('button', { name: /send magic link/i }));
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
});
