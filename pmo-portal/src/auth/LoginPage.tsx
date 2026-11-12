import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from './useAuth';
import { useServiceMessageText } from './useServiceMessageText';
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
import { returnPathFrom } from './returnTo';

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

// Translation keys, not labels: the panel appears in a demo build a prospective client sees, so its
// words go through the catalogues like any other visible text. `label` is only the English fallback
// and the ANALYTICS value (DemoPersonaLabel), so it stays the stable role name, not the display copy.
const DEMO_PERSONAS = [
  { labelKey: 'login.demo.executive',       label: 'Executive',       email: 'exec@acme.test' },
  { labelKey: 'login.demo.projectManager',  label: 'Project Manager', email: 'pm@acme.test' },
  { labelKey: 'login.demo.finance',         label: 'Finance',         email: 'finance@acme.test' },
  { labelKey: 'login.demo.engineer',        label: 'Engineer',        email: 'engineer@acme.test' },
  { labelKey: 'login.demo.admin',           label: 'Admin',           email: 'admin@acme.test' },
] as const;

const authReasonCode = (message: string): 'invalid_credentials' | 'auth_error' => {
  return message.toLowerCase().includes('invalid') ? 'invalid_credentials' : 'auth_error';
};

// FR-AUTHF-043: classification is driven SOLELY by the GoTrue error string, not a build flag —
// the confirm-required state is unreachable in dev by construction (enable_confirmations=false).
const isEmailNotConfirmed = (message: string) => /email not confirmed/i.test(message);
const isRateLimited = (message: string) => /for security purposes|rate limit|once every/i.test(message);

/** The resend retry interval the rate-limit copy names ("once every 60 seconds"). */
const RATE_LIMIT_RETRY_MS = 60_000;

/**
 * The Microsoft logo mark — the four brand-colour squares. Inline so it ships with the bundle
 * (no network fetch, CSP-safe) and scales with the button text. The colours are Microsoft's fixed
 * brand palette, not app tokens: a recoloured Microsoft logo is an off-brand logo. Decorative — the
 * button text is the accessible name, so the SVG is aria-hidden.
 */
const MicrosoftLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 21 21" className={className} aria-hidden="true" focusable="false">
    <rect x="1" y="1" width="9" height="9" fill="#F25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
    <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
  </svg>
);

const LoginPage: React.FC = () => {
  // C4: every visible string on this page comes from the `auth` catalogue. The service's own message
  // is classified and re-worded (`useServiceMessageText`), never printed verbatim.
  const { t } = useTranslation('auth');
  const serviceText = useServiceMessageText();
  // Show the demo-login panel in local dev OR a demo build (VITE_DEMO_MODE=true); never real prod.
  const showDemoLogin =
    import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true';
  const { signInWithPassword, signInWithMagicLink, signInWithMicrosoft, resendEmailConfirmation } =
    useAuth();
  const navigate = useNavigate();
  // AC-CLI-012: where RequireAuth was sending the user (e.g. the OAuth consent screen), if safe.
  const returnPath = returnPathFrom(useLocation().state);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // FR-AUTHF-040..043: confirm-required state + Resend action.
  const [confirmRequired, setConfirmRequired] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  // A rate-limited resend cools down for the server's retry interval, then the action re-enables.
  // The timer is cleared on unmount and whenever the state it drives is left, so no stale
  // callback flips `rateLimited` for a state nobody is looking at.
  const rateLimitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (rateLimitTimer.current) clearTimeout(rateLimitTimer.current);
  }, []);
  const beginRateLimitCooldown = () => {
    setRateLimited(true);
    if (rateLimitTimer.current) clearTimeout(rateLimitTimer.current);
    rateLimitTimer.current = setTimeout(() => {
      rateLimitTimer.current = null;
      setRateLimited(false);
    }, RATE_LIMIT_RETRY_MS);
  };
  const onBackToSignIn = () => {
    if (rateLimitTimer.current) {
      clearTimeout(rateLimitTimer.current);
      rateLimitTimer.current = null;
    }
    setRateLimited(false);
    setConfirmRequired(false);
  };

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
    navigate(returnPath ?? '/', { replace: true });
  };

  const onResend = async () => {
    setError(null);
    setNotice(null);
    setResendBusy(true);
    const { error } = await resendEmailConfirmation(email); // FR-AUTHF-041 — origin redirect
    setResendBusy(false);
    if (error) {
      if (isRateLimited(error)) {
        beginRateLimitCooldown(); // FR-AUTHF-042 — disable until the retry interval elapses
        return;
      }
      setError(error);
      return;
    }
    setNotice(t('login.confirmationSent', 'Confirmation sent. Check your email.')); // FR-AUTHF-042 — role=status (SuccessNotice)
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
    setNotice(t('login.magicLinkSent', 'Check your email for a sign-in link.'));
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
        {/* Brand lockup — mark + wordmark, then heading + subtext. A subtitle reads more
            considered than a bare heading and sets expectation before the form. */}
        <div className="mb-6 text-center">
          <div className="mb-4 inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-md bg-primary text-[15px] font-bold text-primary-foreground"
            >
              P
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
              PMO Portal
            </span>
          </div>
          <h1 className="text-[24px] font-bold leading-[1.15] tracking-[-0.02em] text-foreground">
            {t('login.title', 'Sign in to your account')}
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {t('login.subtitle', 'Welcome back. Use your work account or email to continue.')}
          </p>
        </div>

        {/* Card: border + white surface, no rest shadow (Flat-By-Default Rule) */}
        <Card>
          <CardPad className="space-y-4">
            {/* Error banner (network / credential failure) */}
            {error && <ErrorBanner message={serviceText(error)} />}

            {/* Magic-link sent / resend-confirmation-sent confirmation */}
            {notice && <SuccessNotice>{notice}</SuccessNotice>}

            {/* FR-AUTHF-040..043: confirm-required state replaces the form when GoTrue rejects
                sign-in with "email not confirmed" (prod only — unreachable in dev by construction). */}
            {confirmRequired ? (
              <div className="space-y-4">
                <p className="text-[13.5px] text-foreground">
                  {t('login.confirmRequired', 'Confirm your email to finish signing in. We can resend the confirmation link.')}
                </p>
                {rateLimited && (
                  <p className="text-[12.5px] text-muted-foreground">
                    {t('login.rateLimited', 'Too many requests. Try again in a minute.')}
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
                  {t('login.resend', 'Resend confirmation')}
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={onBackToSignIn}>
                  {t('login.backToSignIn', 'Back to sign in')}
                </Button>
              </div>
            ) : (
              <>
            {/* SSO FIRST — the target audience already lives in Microsoft 365, so the work-account
                path leads (the enterprise convention: Slack/Notion/Linear all place SSO above the
                email form). The brand mark makes it read instantly as a real SSO button, not a
                link. Needs no email typed. */}
            <Button
              type="button"
              variant="outline"
              onClick={onMicrosoft}
              disabled={busy}
              className="w-full justify-center gap-2.5"
            >
              <MicrosoftLogo className="size-[18px] shrink-0" />
              {t('login.microsoft', 'Continue with Microsoft')}
            </Button>

            {/* Divider — names the alternative rather than a bare "or" */}
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              <span className="text-[11px] font-semibold text-muted-foreground">
                {t('login.orEmail', 'or continue with email')}
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
            </div>

            <form onSubmit={onSignIn} className="space-y-4" noValidate>
              <AuthInput
                id="email"
                label={t('login.email', 'Email')}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={setEmail}
                disabled={busy}
              />

              <div className="space-y-1.5">
                <AuthInput
                  id="password"
                  label={t('login.password', 'Password')}
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
                    {t('login.forgot', 'Forgot password?')}
                  </Link>
                </div>
              </div>

              {/* PRIMARY action — bg-primary, full-width */}
              <Button
                type="submit"
                variant="primary"
                loading={busy}
                disabled={busy}
                className="w-full"
              >
                {t('login.signIn', 'Sign in')}
              </Button>
            </form>

            {/* TERTIARY — passwordless magic link. A quiet text button under the form, not a
                third full-width bar competing with the two real actions above. */}
            <p className="text-center text-[12.5px] text-muted-foreground">
              {t('login.noPassword', 'No password?')}{' '}
              <button
                type="button"
                onClick={onMagicLink}
                disabled={busy || !email}
                className="font-semibold text-primary-text hover:underline disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t('login.magicLink', 'Email me a magic link')}
              </button>
            </p>

            {/* Demo-login panel — local dev OR a demo build (VITE_DEMO_MODE=true); never real prod.
                Lists all 5 role personas; click any to one-click fill credentials. */}
            {showDemoLogin && (
              <div className="space-y-2 rounded-md border border-border bg-secondary/40 px-3 py-2.5">
                <p className="text-center text-[11px] font-semibold text-muted-foreground">
                  {t('login.demo.label', 'Demo login')}
                </p>
                <p className="text-center font-mono text-[11px] text-muted-foreground">
                  {t('login.demo.password', 'password: {{password}}', { password: DEMO_PASSWORD })}
                </p>
                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
                  {DEMO_PERSONAS.map(({ labelKey, label, email }) => (
                    <button
                      key={email}
                      type="button"
                      aria-label={t('login.demo.persona', '{{label}}, {{email}}', { label: t(labelKey, label), email })}
                      onClick={() => {
                        trackDemoPersonaSelected(label);
                        setEmail(email);
                        setPassword(DEMO_PASSWORD);
                        setError(null);
                      }}
                      disabled={busy}
                      className="min-h-8 py-2 text-[11.5px] font-semibold text-primary-text hover:underline disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {t(labelKey, label)}
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
            {t('login.footer.terms', 'Terms')}
          </Link>
          <span aria-hidden>·</span>
          <Link to="/privacy" className="font-medium text-primary-text hover:underline">
            {t('login.footer.privacy', 'Privacy')}
          </Link>
          {HELP_URL && (
            <>
              <span aria-hidden>·</span>
              <a
                href={HELP_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('login.footer.helpAria', 'Contact support via WhatsApp')}
                className="font-medium text-primary-text hover:underline"
              >
                {t('login.footer.help', 'Help')}
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
