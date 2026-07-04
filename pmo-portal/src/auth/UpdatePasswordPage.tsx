import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/src/lib/supabase/client';
import { useAuth } from './useAuth';
import { Button } from '../components/ui/Button';
import { Card, CardPad } from '../components/ui/Card';
import { ErrorBanner, AuthInput } from './authFormPrimitives';
import { trackAuthLoginSucceeded, trackAuthLoginFailed } from '../lib/analytics';
import type { AuthFailureReason, AuthMethod } from '../lib/analytics';

// -----------------------------------------------------------------------
// UpdatePasswordPage — /update-password (FR-AUTHF-002/020..027/035). Public
// route, outside <RequireAuth>. Serves BOTH the password-reset "set" step
// and the invite-acceptance "set first password" step (D-AUTHF-4) — both
// end in supabase.auth.updateUser({ password }).
//
// Recovery/invite-session detection is in-page (M-4: AuthProvider discards
// the onAuthStateChange event type) and race-free: the URL carrying auth
// params gates the initial phase; whichever of the PASSWORD_RECOVERY event
// or getSession() resolving first lands the page in 'active' (design D1).
// -----------------------------------------------------------------------

const RECOVERY_PARAMS = [
  'type',
  'token',
  'refresh_token',
  'access_token',
  'code',
  'error',
  'error_code',
  'error_description',
];

const classifyUpdateError = (message: string): AuthFailureReason => {
  const m = message.toLowerCase();
  if (m.includes('weak') || m.includes('at least') || m.includes('password should')) {
    return 'weak_password';
  }
  if (m.includes('expired') || m.includes('token') || m.includes('invalid')) {
    return 'expired_token';
  }
  return 'auth_error';
};

const UpdatePasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const { session, updatePassword } = useAuth();

  // FR-AUTHF-020/021/027 + M-4: AuthProvider discards the event type, so detection is in-page.
  const hasRecoveryParams = useMemo(() => {
    const u = new URL(window.location.href);
    return (
      RECOVERY_PARAMS.some((k) => u.searchParams.has(k)) ||
      RECOVERY_PARAMS.some((k) => u.hash.includes(`${k}=`))
    );
  }, []);
  const [phase, setPhase] = useState<'verifying' | 'active' | 'expired'>(
    hasRecoveryParams ? 'verifying' : 'expired'
  );

  useEffect(() => {
    let settled = false;
    const activate = () => {
      if (settled) return;
      settled = true;
      setPhase('active');
      window.history.replaceState({}, '', '/update-password'); // FR-AUTHF-027
    };
    // RequireInviteAccepted redirects an already-signed-in invite_pending user to /update-password
    // via <Navigate>, which carries no recovery URL params. That session is still a valid trigger
    // for the set-password form, so it's checked alongside hasRecoveryParams (spec-conformance fix).
    const checkSession = ({ session }: { session: { user?: { user_metadata?: Record<string, unknown> } } | null }) => {
      if (session?.user?.user_metadata?.invite_pending === true) {
        activate();
        return true;
      }
      return false;
    };
    if (!hasRecoveryParams) {
      void supabase.auth.getSession().then(({ data }) => {
        if (!checkSession(data) && !settled) {
          settled = true;
          setPhase('expired');
        }
      });
      return;
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY' && s) activate();
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) activate();
      else if (!settled) {
        settled = true;
        setPhase('expired');
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [hasRecoveryParams]);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wasInvite = session?.user?.user_metadata?.invite_pending === true;
  const method: AuthMethod = wasInvite ? 'invite_accept' : 'password_reset';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm || !password) {
      setConfirmError('Passwords do not match'); // FR-AUTHF-022
      return;
    }
    setConfirmError(null);
    setBusy(true);
    const { error } = await updatePassword(password); // FR-AUTHF-035: clears invite_pending in the same call
    setBusy(false);
    if (error) {
      trackAuthLoginFailed(method, classifyUpdateError(error)); // FR-AUTHF-025
      setError(error);
      return;
    }
    trackAuthLoginSucceeded(method); // FR-AUTHF-061
    navigate('/', { replace: true }); // FR-AUTHF-024
  };

  if (phase === 'expired') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-secondary/35 px-4 py-8">
        <div className="w-full max-w-sm">
          <div className="mb-5 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              PMO Portal
            </p>
            <h1 className="mt-1 text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-foreground">
              Set your password
            </h1>
          </div>
          <Card>
            <CardPad className="space-y-4">
              <ErrorBanner message="This link is invalid or expired." />
              <Link to="/reset-password">
                <Button type="button" variant="primary" className="w-full">
                  Request a new link
                </Button>
              </Link>
              <Link
                to="/login"
                className="block text-center text-[12.5px] font-semibold text-primary-text hover:underline"
              >
                Back to sign in
              </Link>
            </CardPad>
          </Card>
        </div>
      </div>
    );
  }

  if (phase === 'verifying') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Verifying your link…"
        className="flex min-h-[100dvh] items-center justify-center bg-secondary/35"
      >
        <svg className="size-7 animate-spin text-primary" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <span className="sr-only">Verifying your link…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-secondary/35 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-5 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            PMO Portal
          </p>
          <h1 className="mt-1 text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-foreground">
            {wasInvite ? 'Set your password' : 'Set a new password'}
          </h1>
        </div>
        <Card>
          <CardPad className="space-y-4">
            {error && <ErrorBanner message={error} />}
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <AuthInput
                id="new-password"
                label="New password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={setPassword}
                disabled={busy}
              />
              <div>
                <AuthInput
                  id="confirm-password"
                  label="Confirm password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={setConfirm}
                  disabled={busy}
                  errorId="confirm-err"
                />
                {confirmError && (
                  <span
                    id="confirm-err"
                    role="alert"
                    className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium"
                    style={{ color: 'hsl(0 72% 45%)' }}
                  >
                    {confirmError}
                  </span>
                )}
              </div>
              <Button type="submit" variant="primary" loading={busy} disabled={busy} className="w-full">
                Set new password
              </Button>
            </form>
          </CardPad>
        </Card>
      </div>
    </div>
  );
};

export default UpdatePasswordPage;
