import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, Card, Icon } from '@/src/components/ui';
import { ConfirmDialog } from '@/src/components/ui/ConfirmDialog';
import { useFeature } from '@/src/auth/useFeature';
import { formatDate } from '@/src/lib/format';
import {
  initiateM365Connect,
  disconnectM365,
  getM365ConnectionStatus,
  type ConnectionStatus,
} from '@/src/lib/m365/connectClient';

/**
 * M365ConnectionCard — the PERSONAL connect surface for the Microsoft 365 integration.
 * Connection-model amendment (2026-07-30, ADR-0063 §3 / spec m365-operator-client-separation): any
 * ACTIVE MEMBER of an entitled org may connect their own Microsoft account and browse through it
 * (FR-M365SEP-011/016), irrespective of PMO role — what a caller sees is bounded by their own
 * Microsoft permissions, which Microsoft enforces. The card's only FE gate is the entitlement; the
 * edge fn's data-access gate (`authorizeMemberEntitled`) is the enforcement authority (ADR-0016 —
 * FE authz is UX-only). The Entra app registration still lives in the VENDOR tenant (ADR-0064).
 *
 * Phase-1 wiring (FR-M365-101 / FR-M365-150; ADR-0060). The card drives the live token-custody
 * edge function:
 *   - Connect → POST `initiate_connect` → top-level redirect to Microsoft's authorize URL (the
 *     consent page MUST be user-visible — not a fetch). Microsoft → edge fn callback → 302 back to
 *     `/integrations?m365_connected=true` (success), `?m365_org_approved=true` (organisation
 *     approval), or `?m365_error=<msg>` (failure).
 *   - On mount (fresh page load, no callback param) the card POSTs `connection_status` and renders
 *     the REAL state — Connected / Needs reconnect (stale) / Revoked / Not connected (AC-M365-022).
 *     A failed status fetch renders an honest UNKNOWN state — NEVER a false "Connected" (AC-M365-023).
 *   - Disconnect opens a destructive `ConfirmDialog`, then POSTs `disconnect` (best-effort Microsoft
 *     revoke + local delete + audit, all server-side). A successful disconnect closes the dialog and
 *     returns the card to not connected; a FAILED disconnect KEEPS the last confirmed connected
 *     state and the dialog open, shows a localized recovery alert inside the dialog (originating-
 *     dialog error rule, DESIGN.md), and leaves the confirm action available to retry.
 *
 * Source-of-truth split: the callback query-param (?m365_connected=true | ?m365_org_approved=true |
 * ?m365_error=<msg>) is the
 * immediate post-redirect signal (shown first, for the redirect-return UX, and the URL is cleaned);
 * the fetched status is the source of truth ON LOAD (a fresh page load with no param). When a
 * callback param drove the immediate state, the status fetch is SKIPPED for that mount — the
 * redirect is already a server-side signal (the callback endpoint set the param after storing the
 * row); the next page load will fetch.
 *
 * The FE gate is the entitlement alone (`useFeature('m365_integration')`) — AC-M365SEP-016. PMO
 * role is no longer a gate (FR-M365SEP-011). ADR-0016 (FE authz is UX-only): RLS + the edge fn's
 * data-access gate (`authorizeMemberEntitled`) are the enforcement authority. The FE may be
 * stricter; never looser. The status fetch is guarded by the entitlement gate and never fires
 * when the card is hidden.
 *
 * NFR-M365-101/108 (binding — no secret leakage): the edge fn returns only `{ authorizeUrl, state }`
 * / `{ success }` / `{ connected, status, connected_at, last_refresh_at, scopes }`. The `state` is a
 * server-bound CSRF token (not secret) and is NOT rendered; the card navigates to `authorizeUrl`
 * only. Error responses are mapped by their stable M365ErrorCode to reviewed human copy in
 * `connectClient` — a raw server message, oid, or token never reaches the DOM (AC-M365-021).
 */
type Phase =
  // lifecycle / status states
  | 'loading' // initial status fetch in progress (no callback param)
  | 'idle' // known not-connected (status absent)
  | 'connected' // known active connection
  | 'org-approved' // the organisation approved the app; this user still needs to connect personally
  | 'reconnect' // known stale — needs reconnect
  | 'revoked' // known revoked
  | 'unknown' // status fetch failed — truth not confirmable (NEVER a false "Connected")
  // action states
  | 'connecting' // initiate_connect in flight
  | 'disconnecting' // disconnect in flight
  | 'error'; // action error banner (initiate failed, etc.)

/** Where a failure surfaced — decides the context-appropriate fallback when no stable code is known. */
type ErrorOrigin = 'status' | 'callback' | 'connect';

/** The reviewed error the card presents: only the stable code + origin are retained; the rendered
 *  copy is DERIVED on each render (via the current locale) so an in-place locale change also
 *  updates a visible error (FR-M365LOC-003). Never store a raw message to render. */
interface CardError {
  code?: string;
  origin: ErrorOrigin;
}

/** Read a structural string `code` off an unknown thrown value (mirrors `appError.readCode`). */
function readErrorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The reviewed localized reason for a known M365 `M365ErrorCode`, or `null` for an absent/
 * unrecognized code. LITERAL keys only (the i18n completeness gate scans `t('literal')` call sites
 * to prove a key is referenced; a computed key would read as an orphan). English defaults match
 * `describeM365Error`'s reviewed source.
 */
function knownCodeReason(t: TFunction, code: string | undefined): string | null {
  switch (code) {
    case 'NOT_ENTITLED':
      return t('integrations.personalM365.errors.notEntitled');
    case 'DISABLED_MEMBER':
      return t('integrations.personalM365.errors.disabledMember');
    case 'BANNED_MEMBER':
      return t('integrations.personalM365.errors.bannedMember');
    case 'ORG_APPROVAL_REQUIRED':
      return t('integrations.personalM365.errors.organizationApprovalRequired');
    case 'FORBIDDEN':
      return t('integrations.personalM365.errors.forbidden');
    case 'UNAUTHORIZED':
      return t('integrations.personalM365.errors.unauthorized');
    case 'CONNECTION_STALE':
      return t('integrations.personalM365.errors.connectionStale');
    case 'CONNECTION_REVOKED':
      return t('integrations.personalM365.errors.connectionRevoked');
    case 'NOT_CONNECTED':
      return t('integrations.personalM365.errors.notConnected');
    case 'TOKEN_EXCHANGE_FAILED':
      return t('integrations.personalM365.errors.tokenExchangeFailed');
    case 'INVALID_STATE':
      return t('integrations.personalM365.errors.invalidState');
    case 'SCOPE_INSUFFICIENT':
      return t('integrations.personalM365.errors.scopeInsufficient');
    case 'BAD_REQUEST':
      return t('integrations.personalM365.errors.badRequest');
    case 'GRAPH_ERROR':
      return t('integrations.personalM365.errors.graphError');
    case 'INTERNAL_ERROR':
      return t('integrations.personalM365.errors.internalError');
    default:
      return null;
  }
}

/**
 * The full localized sentence the card renders for a stored `code` at a given `origin`, derived at
 * render time so a locale change updates a visible error without re-running the action.
 *   - known code → that code's reviewed message;
 *   - unknown/absent code → `statusFallback` for a status fetch, `generic` for callback/connect;
 *   - disconnect context → the recovery outcome (`disconnectFailure`) + a known code's reason when one
 *     exists, so the user sees the outcome and the available action even when the response is ambiguous.
 */
function localizedError(t: TFunction, code: string | undefined, origin: ErrorOrigin | 'disconnect'): string {
  if (origin === 'disconnect') {
    const base = t('integrations.personalM365.errors.disconnectFailure');
    const reason = knownCodeReason(t, code);
    return reason ? `${base} ${reason}` : base;
  }
  if (origin === 'status') {
    return knownCodeReason(t, code) ?? t('integrations.personalM365.errors.statusFallback');
  }
  return knownCodeReason(t, code) ?? t('integrations.personalM365.errors.generic');
}

/**
 * The persisted localized recovery alert inside the destructive disconnect dialog. Mounts only
 * after a disconnect failure; moves focus to itself (originating-dialog error rule) so the user's
 * next Tab/action starts on the error, and stays focusable (tabIndex={-1}) for AT navigation. Copy
 * is derived by the parent each render, so a locale change re-renders it in the new language.
 */
function DisconnectErrorAlert({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <p
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="mt-3 rounded-md bg-destructive/10 px-2.5 py-2 text-sm leading-[1.45] text-destructive"
    >
      {text}
    </p>
  );
}

export const M365ConnectionCard: React.FC = () => {
  const entitled = useFeature('m365_integration');
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorState, setErrorState] = useState<CardError | null>(null);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Disconnect-failure recovery, shown in the originating dialog. Only the stable code is retained;
  // copy is derived during render so a locale change updates it in place (FR-M365LOC-003).
  const [disconnectError, setDisconnectError] = useState<{ code?: string } | null>(null);

  // The in-flight guard for Connect. The Button's `loading` prop disables it on re-render, but a
  // second synchronous click can land before React flushes — this ref is the hard gate (AC-M365-016).
  const initiatingRef = useRef(false);
  // True when a callback query-param drove this mount's initial phase (the redirect is the signal
  // for this session). Suppresses the status fetch on that mount (next load will fetch).
  const optimisticFromCallback = useRef(false);
  // Ensures the status fetch fires at most once per mount (entitlement may load async, so the effect
  // depends on [entitled] — this ref prevents a double-fetch if it toggles).
  const statusFetchedRef = useRef(false);

  // One-shot: consume the callback return (?m365_connected=true | ?m365_org_approved=true |
  // ?m365_error=<msg>) and clean the
  // param so a refresh doesn't re-trigger the banner. Runs once on mount — intentionally NOT
  // reactive to searchParams (a param arriving mid-session would re-fire a stale banner).
  useEffect(() => {
    const connected = searchParams.get('m365_connected');
    const orgApproved = searchParams.get('m365_org_approved');
    const m365Error = searchParams.get('m365_error');
    const m365ErrorCode = searchParams.get('m365_error_code');
    if (connected === 'true') {
      setPhase('connected');
      setErrorState(null);
      optimisticFromCallback.current = true;
    } else if (orgApproved === 'true') {
      setPhase('org-approved');
      setErrorState(null);
      optimisticFromCallback.current = true;
    } else if (m365Error || m365ErrorCode) {
      setPhase('error');
      // Always use the reviewed FE taxonomy. The callback's message is untrusted transport data
      // and must never reach the DOM, even for legacy redirects without a stable error code. Keep
      // only the stable code + origin; derive the localized text during render.
      setErrorState({ code: m365ErrorCode?.trim() || undefined, origin: 'callback' });
      optimisticFromCallback.current = true;
    }
    if (connected === 'true' || orgApproved === 'true' || m365Error || m365ErrorCode) {
      const next = new URLSearchParams(searchParams);
      next.delete('m365_connected');
      next.delete('m365_org_approved');
      next.delete('m365_error');
      next.delete('m365_error_code');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-shot status fetch — the source of truth on a fresh page load (AC-M365-022). Skipped when a
  // callback param already drove this mount's state (the redirect is the signal) or when the gate
  // is closed (the card is hidden — no fetch). A failed fetch → 'unknown' (AC-M365-023: NEVER a
  // false "Connected"). Re-runs if the gate opens later (async entitlement) but fires at most once.
  useEffect(() => {
    if (statusFetchedRef.current) return;
    if (optimisticFromCallback.current) return;
    if (!entitled) return;
    statusFetchedRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const status = await getM365ConnectionStatus();
        if (cancelled) return;
        applyStatus(status);
      } catch (err) {
        if (cancelled) return;
        // Honest unknown — a failed status fetch must NOT render a false "Connected" (AC-M365-023).
        setPhase('unknown');
        setErrorState({ code: readErrorCode(err), origin: 'status' });
        setConnectedAt(null);
      }
    })();
    return () => {
      cancelled = true;
      // Release the once-only guard on cleanup. `statusFetchedRef` survives a StrictMode
      // unmount/remount (React reuses the same instance and its refs), so WITHOUT this the
      // sequence is: mount 1 sets the ref and starts the fetch → cleanup sets cancelled →
      // mount 2 sees the ref and returns early, never fetching → fetch 1 resolves into
      // `if (cancelled) return`. Both guards fire, applyStatus never runs, and the card is
      // pinned on 'loading' forever. Observed live 2026-07-24 against prod Supabase: the edge
      // fn answered 200 every time while the card showed "Checking…" indefinitely.
      // Releasing it here costs at most one extra status GET on a genuine remount, and is what
      // lets the remounted effect fetch the state it needs.
      statusFetchedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entitled]);

  const applyStatus = useCallback((status: ConnectionStatus) => {
    if (!status.connected) {
      setPhase('idle');
      setErrorState(null);
      setConnectedAt(null);
      return;
    }
    setConnectedAt(status.connected_at ?? null);
    switch (status.status) {
      case 'active':
        setPhase('connected');
        setErrorState(null);
        break;
      case 'stale':
        setPhase('reconnect');
        setErrorState(null);
        break;
      case 'revoked':
        setPhase('revoked');
        setErrorState(null);
        break;
      default:
        // connected:true with an unrecognized/null status — the row exists, so surface connected
        // (the most common status); the backend never produces this today (connected:true ⇒ a
        // non-null active/stale/revoked status), but we do not invent a worse state.
        setPhase('connected');
        setErrorState(null);
        break;
    }
  }, []);

  const onConnect = useCallback(async () => {
    if (initiatingRef.current) return; // in-flight guard — no double initiate (AC-M365-016)
    initiatingRef.current = true;
    setPhase('connecting');
    setErrorState(null);
    try {
      const { authorizeUrl } = await initiateM365Connect();
      // Top-level redirect — Microsoft's consent page must be user-visible (FR-M365-101).
      window.location.assign(authorizeUrl);
      // Leave initiatingRef set: the browser is navigating away; a stray second click stays a no-op.
    } catch (err) {
      initiatingRef.current = false; // allow a retry after the failure surfaces
      setPhase('error');
      setErrorState({ code: readErrorCode(err), origin: 'connect' });
    }
  }, []);

  const onDisconnectConfirm = useCallback(async () => {
    setPhase('disconnecting');
    // Clear any prior dialog error before retrying (AC-M365LOC-005).
    setDisconnectError(null);
    try {
      await disconnectM365();
      setPhase('idle');
      setErrorState(null);
      setConnectedAt(null);
      setConfirmOpen(false);
    } catch (err) {
      // Keep the last confirmed connected state + keep the dialog open (originating-dialog error
      // rule). Surface the localized recovery outcome in the dialog and leave the confirm action
      // available to retry after the request settles. Close only on success or explicit cancel.
      setPhase('connected');
      setDisconnectError({ code: readErrorCode(err) });
    }
  }, []);

  const onDialogCancel = useCallback(() => {
    setConfirmOpen(false);
    setDisconnectError(null);
  }, []);

  // Entitlement gate — the only FE gate (AC-M365SEP-016). Hooks above run unconditionally
  // (rules-of-hooks). PMO role is no longer a gate (FR-M365SEP-011).
  if (!entitled) return null;

  const isConnected = phase === 'connected' || phase === 'disconnecting';
  // Connect is offered whenever the user is NOT confirmed connected (idle / connecting / reconnect
  // / revoked / error). It is withheld while the truth is still loading or unknown — we do not offer
  // an action on an unconfirmed state.
  const showConnect =
    phase === 'idle' || phase === 'connecting' || phase === 'org-approved' || phase === 'reconnect' || phase === 'revoked' || phase === 'error';
  const showDisconnect = isConnected;

  return (
    <Card className="mb-3.5 p-4" data-testid="m365-connection-card">
      <div className="flex items-center gap-2">
        <Icon name="plug" />
        <h3 className="text-[15px] text-foreground font-semibold">Microsoft 365</h3>
      </div>

      {isConnected ? (
        <p
          className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"
          data-testid="m365-connected-msg"
        >
          <Icon name="check" className="size-3.5 shrink-0 text-success-text" aria-hidden="true" />
          <span>
            {connectedAt
              ? t('integrations.personalM365.state.connectedSince', { date: formatDate(connectedAt) })
              : t('integrations.personalM365.state.connected')}
          </span>
        </p>
      ) : phase === 'org-approved' ? (
        <p
          className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"
          data-testid="m365-org-approved-msg"
          role="status"
        >
          <Icon name="check" className="size-3.5 shrink-0 text-success-text" aria-hidden="true" />
          <span>{t('integrations.personalM365.state.organizationApproved')}</span>
        </p>
      ) : phase === 'reconnect' ? (
        <p
          className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"
          data-testid="m365-reconnect-msg"
        >
          <Icon name="alert" className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('integrations.personalM365.state.reconnect')}</span>
        </p>
      ) : phase === 'revoked' ? (
        <p
          className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"
          data-testid="m365-revoked-msg"
        >
          <Icon name="alert" className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{t('integrations.personalM365.state.revoked')}</span>
        </p>
      ) : phase === 'unknown' ? (
        <p
          className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"
          data-testid="m365-unknown-msg"
          role="alert"
        >
          <Icon name="alert" className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {errorState
              ? localizedError(t, errorState.code, 'status')
              : t('integrations.personalM365.state.unknown')}
          </span>
        </p>
      ) : phase === 'loading' ? (
        <p className="mt-2 text-sm text-muted-foreground" data-testid="m365-loading-msg">
          {t('integrations.personalM365.state.loading')}
        </p>
      ) : phase === 'error' && errorState ? (
        <p
          className="mt-2 flex items-center gap-1.5 text-sm text-destructive"
          data-testid="m365-error-msg"
          role="alert"
        >
          <Icon name="alert" className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{localizedError(t, errorState.code, errorState.origin)}</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {t('integrations.personalM365.state.notConnected')}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {showConnect && !isConnected && (
          <Button
            variant="outline"
            onClick={onConnect}
            loading={phase === 'connecting'}
            data-testid="m365-connect-btn"
          >
            {phase === 'reconnect' || phase === 'revoked'
              ? t('integrations.personalM365.action.reconnect')
              : t('integrations.personalM365.action.connect')}
          </Button>
        )}
        {showDisconnect && (
          <Button
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            disabled={phase === 'disconnecting'}
            data-testid="m365-disconnect-btn"
          >
            {t('integrations.personalM365.action.disconnect')}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        tone="destructive"
        title={t('integrations.personalM365.confirm.title')}
        description={
          <>
            {t('integrations.personalM365.confirm.description')}
            {disconnectError && (
              <DisconnectErrorAlert text={localizedError(t, disconnectError.code, 'disconnect')} />
            )}
          </>
        }
        confirmLabel={t('integrations.personalM365.confirm.confirm')}
        cancelLabel={t('integrations.personalM365.confirm.cancel')}
        loading={phase === 'disconnecting'}
        onConfirm={onDisconnectConfirm}
        onCancel={onDialogCancel}
      />
    </Card>
  );
};

export default M365ConnectionCard;