import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from './useAuth';
import { useServiceMessageText } from './useServiceMessageText';
import { Button } from '../components/ui/Button';
import { Card, CardPad } from '../components/ui/Card';
import { ErrorBanner, SuccessNotice, AuthInput } from './authFormPrimitives';

// -----------------------------------------------------------------------
// ResetPasswordPage — /reset-password (FR-AUTHF-010..015). Public route,
// outside <RequireAuth>. Request half of the password-reset flow: enter an
// email, call requestPasswordReset (origin-rooted redirectTo), show an
// identical "check your email" notice regardless of account existence
// (D-AUTHF-7, no user enumeration).
// -----------------------------------------------------------------------

const ResetPasswordPage: React.FC = () => {
  const { t } = useTranslation('auth');
  const serviceText = useServiceMessageText();
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error } = await requestPasswordReset(email); // origin + '/update-password' (FR-AUTHF-015/050)
      if (error) {
        setError(error);
        setBusy(false);
        return;
      }
      setSent(true); // FR-AUTHF-012 — stay on page; do NOT navigate.
      setBusy(false);
    } catch (err) {
      // FR-AUTHF-014 — the fallback is the app's own sentence, never the raw service text.
      setError(err instanceof Error ? err.message : 'unknown');
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-secondary/35 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-5 text-center">
          <p className="text-[11px] font-semibold text-muted-foreground">
            PMO Portal
          </p>
          <h1 className="mt-1 text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-foreground">
            {t('reset.title', 'Reset your password')}
          </h1>
        </div>
        <Card>
          <CardPad className="space-y-4">
            {error && (
              <ErrorBanner
                message={serviceText(error, t('reset.failed', 'We could not send the reset link. Check the address and try again.'))}
              />
            )}
            {/* FR-AUTHF-012/013: identical notice whether or not the email exists (D-AUTHF-7). */}
            {sent && (
              <SuccessNotice>
                {t('reset.sent', 'Check your email. If an account exists for that address, a reset link is on its way.')}
              </SuccessNotice>
            )}
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <AuthInput
                id="email"
                label={t('reset.email', 'Email')}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={setEmail}
                disabled={busy}
              />
              <Button type="submit" variant="primary" loading={busy} disabled={busy} className="w-full">
                {t('reset.send', 'Send reset link')}
              </Button>
            </form>
            <Link
              to="/login"
              className="block text-center text-[12.5px] font-semibold text-primary-text hover:underline"
            >
              {t('reset.back', 'Back to sign in')}
            </Link>
          </CardPad>
        </Card>
      </div>
    </main>
  );
};

export default ResetPasswordPage;
