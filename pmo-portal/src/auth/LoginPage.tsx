import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { Button } from '../components/ui/Button';
import { Card, CardPad } from '../components/ui/Card';
import { cn } from '../components/ui/cn';
import { Icon } from '../components/ui/icons';

// -----------------------------------------------------------------------
// LoginPage — DESIGN.md token-pure reskin (IA-3 / RIS identity)
// No gray-* / dark: / primary-NNN / raw-hex / shadow / rounded-xl utilities.
// "Calm control surface": card on tinted ground, one blue, borders-not-shadows.
// -----------------------------------------------------------------------

/** Tinted success notice (magic-link sent) */
const SuccessNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    role="status"
    aria-live="polite"
    className="flex items-start gap-2 rounded-md border border-success/30 bg-success/[0.07] px-3 py-2.5 text-[13px]"
  >
    <Icon name="check" className="mt-px size-4 shrink-0 text-success" aria-hidden="true" />
    <span style={{ color: 'hsl(142 60% 30%)' }}>{children}</span>
  </div>
);

/** Tinted error banner (credential/network error) */
const ErrorBanner: React.FC<{ message: string }> = ({ message }) => (
  <div
    role="alert"
    aria-live="assertive"
    className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3 py-2.5 text-[13px]"
  >
    <Icon name="alert" className="mt-px size-4 shrink-0 text-destructive" aria-hidden="true" />
    <span style={{ color: 'hsl(0 72% 42%)' }}>{message}</span>
  </div>
);

/** Single labeled input block — label above, error below. */
const InputBlock: React.FC<{
  id: string;
  label: string;
  type: React.HTMLInputTypeAttribute;
  autoComplete?: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  errorId?: string;
  disabled?: boolean;
}> = ({ id, label, type, autoComplete, required, value, onChange, errorId, disabled }) => (
  <div className="flex flex-col gap-1.5">
    <label
      htmlFor={id}
      className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
    >
      {label}
    </label>
    <input
      id={id}
      type={type}
      autoComplete={autoComplete}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-describedby={errorId}
      className={cn(
        'h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13.5px] text-foreground',
        'placeholder:text-muted-foreground',
        'transition-[border-color,box-shadow] duration-100',
        'disabled:cursor-not-allowed disabled:opacity-45',
        // Focus ring delegated to global *:focus-visible (--ring, DESIGN.md §a11y)
      )}
    />
  </div>
);

// -----------------------------------------------------------------------

const LoginPage: React.FC = () => {
  const { signInWithPassword, signInWithMagicLink } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } = await signInWithPassword(email, password);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    navigate('/', { replace: true });
  };

  const onMagicLink = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error } = await signInWithMagicLink(email);
    setBusy(false);
    if (error) {
      setError(error);
      return;
    }
    setNotice('Check your email for a sign-in link.');
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

            {/* Magic-link sent confirmation */}
            {notice && <SuccessNotice>{notice}</SuccessNotice>}

            <form onSubmit={onSignIn} className="space-y-4" noValidate>
              <InputBlock
                id="email"
                label="Email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={setEmail}
                disabled={busy}
              />

              <InputBlock
                id="password"
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
                disabled={busy}
              />

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

            {/* Dev-seed hint (kept from prototype; muted-foreground, mono font) */}
            {import.meta.env.DEV && (
              <p className="text-center text-[11.5px] text-muted-foreground">
                Dev seed:{' '}
                <span className="font-mono text-[11px]">pm@acme.test / Passw0rd!dev</span>
              </p>
            )}
          </CardPad>
        </Card>
      </div>
    </div>
  );
};

export default LoginPage;
