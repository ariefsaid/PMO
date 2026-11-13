import React from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './useAuth';
import { Button } from '../components/ui/Button';
import { Card, CardPad } from '../components/ui/Card';
import { ListState } from '../components/ui/ListState';
import { returnToState } from './returnTo';

// -----------------------------------------------------------------------
// RequireAuth — DESIGN.md token-pure reskin (IA-3 / RIS identity)
// No gray-* / dark: / primary-NNN utilities.
// Loading → page-shaped skeleton on tinted ground (never a bare spinner).
// profileErrorKind='load_error' → tinted destructive banner with retry (unchanged).
// profileErrorKind='not_provisioned' → calm "not set up yet" card + Sign out
// (Retry can't help — there's no profiles row for a Retry to find). AC-MSAUTH-010/011.
// -----------------------------------------------------------------------

/** Full-page loading state — the shape of an app page while the session resolves. */
const AuthLoading: React.FC = () => (
  <div
    className="min-h-[100dvh] bg-secondary/35"
  >
    <ListState
      variant="loading"
      shape="detail"
      rows={4}
      loadingLabel="Authenticating…"
      loadingRole="status"
      loadingAriaLabel="Authenticating…"
      className="mx-auto w-full max-w-3xl px-4 py-10"
    />
  </div>
);

/**
 * Full-page profile error — retry the failed profile read through the shared auth context.
 *
 * The body is FIXED recovery copy, never the raw read error: `TypeError: Failed to fetch` told a
 * user nothing they could act on, and it leaked the failure's English internals into both locales.
 * The technical message is logged where the read fails (`AuthProvider`), not rendered.
 */
const ProfileErrorPage: React.FC<{ onRetry: () => void }> = ({ onRetry }) => {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-secondary/35 px-4">
      <ListState
        variant="error"
        title="Unable to load your profile."
        sub={t('auth:profileLoadError.body', 'Check your connection and try again.')}
        retryLabel={t('ui.listState.retry', 'Retry')}
        onRetry={onRetry}
        className="w-full max-w-sm"
      />
    </div>
  );
};

/** Full-page not-provisioned state — the session is valid but no profiles row exists yet. */
const NotProvisionedPage: React.FC = () => {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-secondary/35 px-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardPad className="space-y-3">
            <h1 className="text-[15px] font-semibold text-foreground">
              You&apos;re signed in, but your account isn&apos;t set up for this workspace yet.
            </h1>
            <p className="text-[13px] text-muted-foreground">
              Ask your administrator to invite you, then sign in again.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          </CardPad>
        </Card>
      </div>
    </div>
  );
};

export const RequireAuth: React.FC = () => {
  const { session, loading, profileError, profileErrorKind, refreshCurrentUser } = useAuth();
  const location = useLocation();

  if (loading) return <AuthLoading />;
  // AC-CLI-012: carry the page being visited so sign-in can return to it (router state, not URL).
  if (!session) return <Navigate to="/login" replace state={returnToState(location)} />;
  if (profileErrorKind === 'not_provisioned') return <NotProvisionedPage />;
  if (profileError) return <ProfileErrorPage onRetry={() => { void refreshCurrentUser(); }} />;

  return <Outlet />;
};
