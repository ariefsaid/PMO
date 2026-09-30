import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { Card, CardPad } from '../components/ui/Card';
import { ErrorBanner } from './authFormPrimitives';
import { decideConsent, getConsentDetails, type ConsentRequest } from './oauthConsent';
import { isLoopbackRedirect } from './loopbackRedirect';

// -----------------------------------------------------------------------
// OAuthConsentPage — /oauth/consent (#728, DD-API-2, AC-CLI-006).
// Supabase Auth's OAuth 2.1 server sends the browser here when an outside client (the PMO CLI)
// asks to act as the signed-in user. Mounted INSIDE <RequireAuth>, so a signed-out visit goes to
// /login and comes back here (AC-CLI-012). Shows who is asking (the registered client name) and as
// whom (the signed-in account); Allow / Deny is relayed to Supabase, and the browser follows the
// redirect Supabase returns. Layout mirrors LoginPage (tinted ground, centered card).
// -----------------------------------------------------------------------

type View =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'loadError' }
  | { kind: 'consent'; request: Extract<ConsentRequest, { kind: 'consent' }> }
  | { kind: 'leaving' };

const OAuthConsentPage: React.FC = () => {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const authorizationId = params.get('authorization_id');
  const [view, setView] = useState<View>(authorizationId ? { kind: 'loading' } : { kind: 'invalid' });
  const [busy, setBusy] = useState(false);
  const [decideError, setDecideError] = useState(false);
  // Read each request ONCE: for an already-approved client the read itself issues the code, and a
  // second read is refused. StrictMode runs this effect twice, so the second run reuses the first
  // run's promise instead of reading again.
  const pending = useRef<{ id: string; promise: Promise<ConsentRequest> } | null>(null);

  useEffect(() => {
    if (!authorizationId) {
      setView({ kind: 'invalid' });
      return;
    }
    let active = true;
    setView({ kind: 'loading' });
    if (pending.current?.id !== authorizationId) {
      pending.current = { id: authorizationId, promise: getConsentDetails(authorizationId) };
    }
    pending.current.promise.then(
      (request) => {
        if (!active) return;
        if (request.kind === 'redirect') {
          setView({ kind: 'leaving' });
          window.location.assign(request.redirectUrl);
        } else {
          setView({ kind: 'consent', request });
        }
      },
      () => {
        if (active) setView({ kind: 'loadError' });
      },
    );
    return () => {
      active = false;
    };
  }, [authorizationId]);

  const decide = async (decision: 'approve' | 'deny') => {
    if (view.kind !== 'consent' || busy) return;
    setBusy(true);
    setDecideError(false);
    try {
      const redirectUrl = await decideConsent(view.request.authorizationId, decision);
      setView({ kind: 'leaving' });
      window.location.assign(redirectUrl);
    } catch {
      setDecideError(true);
      setBusy(false);
    }
  };

  const restartHint = (
    <p className="text-[13px] text-muted-foreground">
      {t('oauthConsent.restart', 'Start the sign-in again from the application that sent you here.')}
    </p>
  );

  let body: React.ReactNode;
  switch (view.kind) {
    case 'loading':
    case 'leaving':
      body = (
        <p role="status" aria-live="polite" className="text-[13.5px] text-muted-foreground">
          {view.kind === 'loading'
            ? t('oauthConsent.loading', 'Loading the sign-in request…')
            : t('oauthConsent.returning', 'Returning you to the application…')}
        </p>
      );
      break;
    case 'invalid':
      body = (
        <div className="space-y-3">
          <ErrorBanner message={t('oauthConsent.missingRequest', 'This sign-in request is incomplete.')} />
          {restartHint}
        </div>
      );
      break;
    case 'loadError':
      body = (
        <div className="space-y-3">
          <ErrorBanner message={t('oauthConsent.loadError', 'This sign-in request could not be loaded.')} />
          {restartHint}
        </div>
      );
      break;
    case 'consent': {
      const { clientName, userEmail, redirectUri } = view.request;
      body = (
        <div className="space-y-4">
          <h1 className="text-[20px] font-bold leading-[1.2] tracking-[-0.02em] text-foreground">
            {t('oauthConsent.title', 'Allow {{client}} to access your PMO account?', { client: clientName })}
          </h1>
          <p className="text-[13px] font-medium text-foreground">
            {t('oauthConsent.signedInAs', 'Signed in as {{email}}', { email: userEmail })}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {t(
              'oauthConsent.explain',
              '{{client}} will be able to read and change PMO records as you, with exactly your permissions. It can do nothing you cannot do yourself.',
              { client: clientName },
            )}
          </p>
          {isLoopbackRedirect(redirectUri) && (
            <p className="text-[13px] text-muted-foreground">
              {t('oauthConsent.loopback', 'After you answer, you return to a program on this computer.')}
            </p>
          )}
          {decideError && (
            <ErrorBanner message={t('oauthConsent.decideError', 'Your answer could not be sent.')} />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={busy} onClick={() => void decide('deny')}>
              {t('oauthConsent.deny', 'Deny')}
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={busy}
              disabled={busy}
              onClick={() => void decide('approve')}
            >
              {t('oauthConsent.allow', 'Allow')}
            </Button>
          </div>
        </div>
      );
      break;
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-secondary/35 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-md bg-primary text-[15px] font-bold text-primary-foreground"
            >
              P
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
              {t('oauthConsent.brand', 'PMO Portal')}
            </span>
          </div>
        </div>
        <Card>
          <CardPad>{body}</CardPad>
        </Card>
      </div>
    </div>
  );
};

export default OAuthConsentPage;
