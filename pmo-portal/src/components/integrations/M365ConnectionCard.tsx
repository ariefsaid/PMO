import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
 * M365ConnectionCard — the OPERATOR activation surface for the Microsoft 365 integration.
 * ADR-0058 §3 amendment (2026-07-24): unlike ClickUp/ERPNext (client supplies the credential ⇒
 * org-Admin opts in), the Entra app registration lives in the VENDOR tenant (ADR-0059 Option C),
 * so connecting it is a platform action. An org-Admin who is not an Operator does not see this
 * card, and the edge fn rejects them independently — the UI gate is UX only (ADR-0016).
 *
 * Phase-1 wiring (FR-M365-101 / FR-M365-150; ADR-0060). The card drives the live token-custody
 * edge function:
 *   - Connect → POST `initiate_connect` → top-level redirect to Microsoft's authorize URL (the
 *     consent page MUST be user-visible — not a fetch). Microsoft → edge fn callback → 302 back to
 *     `/admin/integrations?m365_connected=true` (success) or `?m365_error=<msg>` (failure).
 *   - On mount (fresh page load, no callback param) the card POSTs `connection_status` and renders
 *     the REAL state — Connected / Needs reconnect (stale) / Revoked / Not connected (AC-M365-022).
 *     A failed status fetch renders an honest UNKNOWN state — NEVER a false "Connected" (AC-M365-023).
 *   - Disconnect opens a destructive `ConfirmDialog`, then POSTs `disconnect` (best-effort Microsoft
 *     revoke + local delete + audit, all server-side).
 *
 * Source-of-truth split: the callback query-param (?m365_connected=true | ?m365_error=<msg>) is the
 * immediate post-redirect signal (shown first, for the redirect-return UX, and the URL is cleaned);
 * the fetched status is the source of truth ON LOAD (a fresh page load with no param). When a
 * callback param drove the immediate state, the status fetch is SKIPPED for that mount — the
 * redirect is already a server-side signal (the callback endpoint set the param after storing the
 * row); the next page load will fetch.
 *
 * The two-switch gate (entitlement `useFeature('m365_integration')` + real-JWT-role `isAdmin`) is
 * UNCHANGED (AC-M365-012, ADR-0058 two-switch model, ADR-0016 FE-authz-UX-only — RLS + the edge
 * fn's own Admin/entitlement assertion are the enforcement authority). The FE may be stricter;
 * never looser. The status fetch is guarded by the same gate and never fires when the card is hidden.
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
  | 'reconnect' // known stale — needs reconnect
  | 'revoked' // known revoked
  | 'unknown' // status fetch failed — truth not confirmable (NEVER a false "Connected")
  // action states
  | 'connecting' // initiate_connect in flight
  | 'disconnecting' // disconnect in flight
  | 'error'; // action error banner (initiate failed, etc.)

export const M365ConnectionCard: React.FC<{ isOperator: boolean }> = ({ isOperator }) => {
  const entitled = useFeature('m365_integration');
  const [searchParams, setSearchParams] = useSearchParams();

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The in-flight guard for Connect. The Button's `loading` prop disables it on re-render, but a
  // second synchronous click can land before React flushes — this ref is the hard gate (AC-M365-016).
  const initiatingRef = useRef(false);
  // True when a callback query-param drove this mount's initial phase (the redirect is the signal
  // for this session). Suppresses the status fetch on that mount (next load will fetch).
  const optimisticFromCallback = useRef(false);
  // Ensures the status fetch fires at most once per mount (entitlement may load async, so the effect
  // depends on [entitled, isOperator] — this ref prevents a double-fetch if either toggles).
  const statusFetchedRef = useRef(false);

  // One-shot: consume the callback return (?m365_connected=true | ?m365_error=<msg>) and clean the
  // param so a refresh doesn't re-trigger the banner. Runs once on mount — intentionally NOT
  // reactive to searchParams (a param arriving mid-session would re-fire a stale banner).
  useEffect(() => {
    const connected = searchParams.get('m365_connected');
    const m365Error = searchParams.get('m365_error');
    if (connected === 'true') {
      setPhase('connected');
      setErrorText(null);
      optimisticFromCallback.current = true;
    } else if (m365Error) {
      setPhase('error');
      setErrorText(decodeURIComponent(m365Error));
      optimisticFromCallback.current = true;
    }
    if (connected === 'true' || m365Error) {
      const next = new URLSearchParams(searchParams);
      next.delete('m365_connected');
      next.delete('m365_error');
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
    if (!entitled || !isOperator) return;
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
        setErrorText(err instanceof Error && err.message ? err.message : null);
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
  }, [entitled, isOperator]);

  const applyStatus = useCallback((status: ConnectionStatus) => {
    if (!status.connected) {
      setPhase('idle');
      setErrorText(null);
      setConnectedAt(null);
      return;
    }
    setConnectedAt(status.connected_at ?? null);
    switch (status.status) {
      case 'active':
        setPhase('connected');
        setErrorText(null);
        break;
      case 'stale':
        setPhase('reconnect');
        setErrorText(null);
        break;
      case 'revoked':
        setPhase('revoked');
        setErrorText(null);
        break;
      default:
        // connected:true with an unrecognized/null status — the row exists, so surface connected
        // (the most common status); the backend never produces this today (connected:true ⇒ a
        // non-null active/stale/revoked status), but we do not invent a worse state.
        setPhase('connected');
        setErrorText(null);
        break;
    }
  }, []);

  const onConnect = useCallback(async () => {
    if (initiatingRef.current) return; // in-flight guard — no double initiate (AC-M365-016)
    initiatingRef.current = true;
    setPhase('connecting');
    setErrorText(null);
    try {
      const { authorizeUrl } = await initiateM365Connect();
      // Top-level redirect — Microsoft's consent page must be user-visible (FR-M365-101).
      window.location.assign(authorizeUrl);
      // Leave initiatingRef set: the browser is navigating away; a stray second click stays a no-op.
    } catch (err) {
      initiatingRef.current = false; // allow a retry after the failure surfaces
      setPhase('error');
      setErrorText(err instanceof Error && err.message ? err.message : 'Microsoft 365 could not be connected.');
    }
  }, []);

  const onDisconnectConfirm = useCallback(async () => {
    setPhase('disconnecting');
    try {
      await disconnectM365();
      setPhase('idle');
      setErrorText(null);
      setConnectedAt(null);
    } catch (err) {
      // Stay connected so the user can retry; surface the mapped human message.
      setPhase('connected');
      setErrorText(err instanceof Error && err.message ? err.message : 'Could not disconnect Microsoft 365.');
    } finally {
      setConfirmOpen(false);
    }
  }, []);

  // Two-switch gate — unchanged (AC-M365-012). Hooks above run unconditionally (rules-of-hooks).
  if (!entitled || !isOperator) return null;

  const isConnected = phase === 'connected' || phase === 'disconnecting';
  // Connect is offered whenever the user is NOT confirmed connected (idle / connecting / reconnect
  // / revoked / error). It is withheld while the truth is still loading or unknown — we do not offer
  // an action on an unconfirmed state.
  const showConnect =
    phase === 'idle' || phase === 'connecting' || phase === 'reconnect' || phase === 'revoked' || phase === 'error';
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
            Connected{connectedAt ? ` since ${formatDate(connectedAt)}` : ''}. You can disconnect any time.
          </span>
        </p>
      ) : phase === 'reconnect' ? (
        <p
          className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"
          data-testid="m365-reconnect-msg"
        >
          <Icon name="alert" className="size-3.5 shrink-0" aria-hidden="true" />
          <span>The Microsoft 365 connection expired. Please reconnect to continue.</span>
        </p>
      ) : phase === 'revoked' ? (
        <p
          className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"
          data-testid="m365-revoked-msg"
        >
          <Icon name="alert" className="size-3.5 shrink-0" aria-hidden="true" />
          <span>The Microsoft 365 connection was revoked. Connect again to continue.</span>
        </p>
      ) : phase === 'unknown' ? (
        <p
          className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"
          data-testid="m365-unknown-msg"
          role="alert"
        >
          <Icon name="alert" className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {errorText ||
              "We couldn't confirm your Microsoft 365 connection status. Refresh the page to try again."}
          </span>
        </p>
      ) : phase === 'loading' ? (
        <p className="mt-2 text-sm text-muted-foreground" data-testid="m365-loading-msg">
          Checking Microsoft 365 connection status…
        </p>
      ) : phase === 'error' && errorText ? (
        <p
          className="mt-2 flex items-center gap-1.5 text-sm text-destructive"
          data-testid="m365-error-msg"
          role="alert"
        >
          <Icon name="alert" className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{errorText}</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Not connected. Link your Microsoft 365 tenant to bring OneDrive documents, Teams, and
          calendar into your projects.
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
            {phase === 'reconnect' || phase === 'revoked' ? 'Reconnect Microsoft 365' : 'Connect Microsoft 365'}
          </Button>
        )}
        {showDisconnect && (
          <Button
            variant="outline"
            onClick={() => setConfirmOpen(true)}
            disabled={phase === 'disconnecting'}
            data-testid="m365-disconnect-btn"
          >
            Disconnect
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        tone="destructive"
        title="Disconnect Microsoft 365?"
        description="This removes the connection and stored permissions. OneDrive documents, Teams, and calendar data will no longer sync until you reconnect. You can reconnect any time."
        confirmLabel="Disconnect"
        loading={phase === 'disconnecting'}
        onConfirm={onDisconnectConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </Card>
  );
};

export default M365ConnectionCard;
