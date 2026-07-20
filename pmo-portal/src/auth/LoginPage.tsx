import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { Button } from '../components/ui/Button';
import { Card, CardPad } from '../components/ui/Card';
import { SuccessNotice, ErrorBanner, AuthInput } from './authFormPrimitives';
import {
  trackDemoPersonaSelected,
  trackAuthLoginSucceeded,
  trackAuthLoginFailed,
} from '../lib/analytics';
import { HELP_URL } from '../lib/legalConfig';
import { AppVersion } from '../components/AppVersion';

// -----------------------------------------------------------------------
// LoginPage — DESIGN.md token-pure reskin (IA-3 / RIS identity)
// No gray-* / dark: / primary-NNN / raw-hex / shadow / rounded-xl utilities.
// "Calm control surface": card on tinted ground, one blue, borders-not-shadows.
// Auth-form primitives (SuccessNotice / ErrorBanner / AuthInput) live in
// ./authFormPrimitives.tsx and are shared with /reset-password + /update-password.
// -----------------------------------------------------------------------

// Demo credentials surfaced on the login page in local dev OR a demo build
// (VITE_DEMO_MODE=true) — never on a real prod build. All 5 personas are provisioned
// in the local seed and the cloud demo. See docs/environments.md.
const DEMO_PASSWORD = 'Passw0rd!dev';

const DEMO_PERSONAS = [
  { label: 'Executive',       email: 'exec@acme.test' },
  { label: 'Project Manager', email: 'pm@acme.test' },
  { label: 'Finance',         email: 'finance@acme.test' },
  { label: 'Engineer',        email: 'engineer@acme.test' },
  { label: 'Admin',           email: 'admin@acme.test' },
] as const;

const authReasonCode = (message: string): 'invalid_credentials' | 'auth_error' => {
  return message.toLowerCase().includes('invalid') ? 'invalid_credentials' : 'auth_error';
};

// FR-AUTHF-043: classification is driven SOLELY by the GoTrue error string, not a build flag —
// the confirm-required state is unreachable in dev by construction (enable_confirmations=false).
const isEmailNotConfirmed = (message: string) => /email not confirmed/i.test(message);
const isRateLimited = (message: string) => /for security purposes|rate limit|once every/i.test(message);

const LoginPage: React.FC = () => {
  // Show the demo-login panel in local dev OR a demo build (VITE_DEMO_MODE=true); never real prod.
  const showDemoLogin =
    import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true';
  const { signInWithPassword, signInWithMagicLink, signInWithMicrosoft, resendEmailConfirmation } =
    useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // FR-AUTHF-040..043: confirm-required state + Resend action.
  const [confirmRequired, setConfirmRequired] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } = await signInWithPassword(email, password);
    setBusy(false);
    if (error) {
      if (isEmailNotConfirmed(error)) {
        trackAuthLoginFailed('password', 'email_not_confirmed'); // FR-AUTHF-061
        setConfirmRequired(true);
        return;
      }
      trackAuthLoginFailed('password', authReasonCode(error));
      setError(error);
      return;
    }
    trackAuthLoginSucceeded('password');
    navigate('/', { replace: true });
  };

  const onResend = async () => {
    setError(null);
    setNotice(null);
    setResendBusy(true);
    const { error } = await resendEmailConfirmation(email); // FR-AUTHF-041 — origin redirect
    setResendBusy(false);
    if (error) {
      if (isRateLimited(error)) {
        setRateLimited(true); // FR-AUTHF-042 — disable until retry
        return;
      }
      setError(error);
      return;
    }
    setNotice('Confirmation sent. Check your email.'); // FR-AUTHF-042 — role=status (SuccessNotice)
  };

  const onMagicLink = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } = await signInWithMagicLink(email);
    setBusy(false);
    if (error) {
      trackAuthLoginFailed('magic_link', authReasonCode(error));
      setError(error);
      return;
    }
    trackAuthLoginSucceeded('magic_link');
    setNotice('Check your email for a sign-in link.');
  };

  const onMicrosoft = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } = await signInWithMicrosoft();
    if (error) {
      setBusy(false);
      trackAuthLoginFailed('microsoft', authReasonCode(error));
      setError(error);
      return;
    }
    // Success = the browser is about to leave for Microsoft's login page; keep `busy` on so the
    // form stays inert during the redirect. Login success is observed post-redirect by the
    // session listener (AuthProvider onAuthStateChange), not here.
  };

  return (
    // Tinted ground (secondary/35%) — DESIGN.md neutral: "main scroll area uses secondary at 35%"
    <div className="flex min-h-[100dvh] items-center justify-center bg-secondary/35 px-4 py-8">
      <div className="w-full max-w-sm">
        {/* App wordmark — overline scale */}
        <div className="mb-5 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            PMO Portal
          </p>
          <h1 className="mt-1 text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-foreground">
            Sign in to your account
          </h1>
        </div>

        {/* Card: border + white surface, no rest shadow (Flat-By-Default Rule) */}
        <Card>
          <CardPad className="space-y-4">
            {/* Error banner (network / credential failure) */}
            {error && <ErrorBanner message={error} />}

            {/* Magic-link sent / resend-confirmation-sent confirmation */}
            {notice && <SuccessNotice>{notice}</SuccessNotice>}

            {/* FR-AUTHF-040..043: confirm-required state replaces the form when GoTrue rejects
                sign-in with "email not confirmed" (prod only — unreachable in dev by construction). */}
            {confirmRequired ? (
              <div className="space-y-4">
                <p className="text-[13.5px] text-foreground">
                  Confirm your email to finish signing in. We can resend the confirmation link.
                </p>
                {rateLimited && (
                  <p className="text-[12.5px] text-muted-foreground">
                    Too many requests — please try again in a minute.
                  </p>
                )}
                <Button
                  type="button"
                  variant="primary"
                  loading={resendBusy}
                  disabled={resendBusy || rateLimited}
                  className="w-full"
                  onClick={onResend}
                >
                  Resend confirmation
                </Button>
              </div>
            ) : (
              <>
            <form onSubmit={onSignIn} className="space-y-4" noValidate>
              <AuthInput
                id="email"
                label="Email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={setEmail}
                disabled={busy}
              />

              <AuthInput
                id="password"
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
                disabled={busy}
              />

              <div className="flex justify-end">
                <Link
                  to="/reset-password"
                  className="text-[12px] font-semibold text-primary-text hover:underline"
                >
                  Forgot password?
                </Link>
              </div>

              {/* PRIMARY action — bg-primary, full-width */}
              <Button
                type="submit"
                variant="primary"
                loading={busy}
                disabled={busy}
                className="w-full"
              >
                Sign in
              </Button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                or
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </div>

            {/* SECONDARY action — outline, not primary */}
            <Button
              type="button"
              variant="outline"
              onClick={onMagicLink}
              disabled={busy || !email}
              className="w-full"
            >
              Send magic link
            </Button>

            {/* SECONDARY action — Microsoft Entra ID (work/school) SSO; needs no email typed */}
            <Button
              type="button"
              variant="outline"
              onClick={onMicrosoft}
              disabled={busy}
              className="w-full"
            >
              Continue with Microsoft
            </Button>

            {/* Demo-login panel — local dev OR a demo build (VITE_DEMO_MODE=true); never real prod.
                Lists all 5 role personas; click any to one-click fill credentials. */}
            {showDemoLogin && (
              <div className="space-y-2 rounded-md border border-border bg-secondary/40 px-3 py-2.5">
                <p className="text-center text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                  Demo login
                </p>
                <p className="text-center font-mono text-[11px] text-muted-foreground">
                  password: {DEMO_PASSWORD}
                </p>
                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                  {DEMO_PERSONAS.map(({ label, email }) => (
                    <button
                      key={email}
                      type="button"
                      aria-label={`${label} — ${email}`}
                      onClick={() => {
                        trackDemoPersonaSelected(label);
                        setEmail(email);
                        setPassword(DEMO_PASSWORD);
                        setError(null);
                      }}
                      disabled={busy}
                      className="min-h-8 py-2 text-[11.5px] font-semibold text-primary-text hover:underline disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
              </>
            )}
          </CardPad>
        </Card>

        {/* Footer — Terms · Privacy · Help (FR-LEG-023, AC-LEG-021).
            Help opens the wa.me URL in a new tab; omitted entirely when HELP_WHATSAPP
            is unset so no broken link renders (FR-LEG-010). */}
        <footer className="mt-5 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
          <Link to="/terms" className="font-medium text-primary-text hover:underline">
            Terms
          </Link>
          <span aria-hidden>·</span>
          <Link to="/privacy" className="font-medium text-primary-text hover:underline">
            Privacy
          </Link>
          {HELP_URL && (
            <>
              <span aria-hidden>·</span>
              <a
                href={HELP_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Contact support via WhatsApp"
                className="font-medium text-primary-text hover:underline"
              >
                Help
              </a>
            </>
          )}
          <AppVersion />
        </footer>
      </div>
    </div>
  );
};

export default LoginPage;
