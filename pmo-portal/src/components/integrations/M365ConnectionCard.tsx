import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Icon } from '@/src/components/ui';
import { ConfirmDialog } from '@/src/components/ui/ConfirmDialog';
import { useFeature } from '@/src/auth/useFeature';
import { initiateM365Connect, disconnectM365 } from '@/src/lib/m365/connectClient';

/**
 * M365ConnectionCard — the org-Admin ACTIVATION surface for the Microsoft 365 integration.
 *
 * Phase-1 wiring (this file): the card now drives the live token-custody edge function
 * (FR-M365-101 / FR-M365-150; ADR-0060). Click Connect → POST `initiate_connect` → top-level
 * redirect to Microsoft's authorize URL (the consent page MUST be user-visible — not a fetch).
 * Microsoft → edge fn callback → 302 back to `/admin/integrations?m365_connected=true` (success)
 * or `?m365_error=<msg>` (failure). On return the card shows the connected/failed state and
 * cleans the param so a refresh doesn't re-trigger the banner. Disconnect opens a destructive
 * `ConfirmDialog`, then POSTs `disconnect` (best-effort Microsoft revoke + local delete + audit,
 * all server-side).
 *
 * The two-switch gate (entitlement `useFeature('m365_integration')` + real-JWT-role `isAdmin`)
 * is UNCHANGED from Phase 0 (AC-M365-012, ADR-0058 two-switch model, ADR-0016 FE-authz-UX-only —
 * RLS + the edge fn's own Admin/entitlement assertion are the enforcement authority). The FE
 * may be stricter; never looser.
 *
 * CONNECTION-STATUS GAP (reported to Director, NOT worked around here): `ms_graph_connections`
 * is RLS-forced with ZERO client policies and the edge fn exposes NO status-read action, so the
 * client CANNOT read connection status. Per the lockdown, the card therefore surfaces state ONLY
 * from the callback return — it does NOT invent a client-readable surface that would weaken the
 * table's forced-RLS lockdown. Net effect: the card shows "Connected" after a successful callback
 * return in THIS session; a fresh page load with no callback param shows "Not connected" (the
 * honest default, since status is unreadable). A persistent status read is a separate backend
 * decision (a `connection_status` action or a read RPC) — out of scope for FE wiring.
 *
 * NFR-M365-101/108 (binding — no secret leakage): the edge fn returns only `{ authorizeUrl,
 * state }` / `{ success }`. The `state` is a server-bound CSRF token (not secret) and is NOT
 * rendered; the card navigates to `authorizeUrl` only. Error responses are mapped by their stable
 * M365ErrorCode to reviewed human copy in `connectClient` — a raw server message, oid, or token
 * never reaches the DOM (AC-M365-021).
 */
type Phase = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'error';

export const M365ConnectionCard: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const entitled = useFeature('m365_integration');
  const [searchParams, setSearchParams] = useSearchParams();

  const [phase, setPhase] = useState<Phase>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // The in-flight guard for Connect. The Button's `loading` prop disables it on re-render, but a
  // second synchronous click can land before React flushes — this ref is the hard gate (AC-M365-016).
  const initiatingRef = useRef(false);

  // One-shot: consume the callback return (?m365_connected=true | ?m365_error=<msg>) and clean the
  // param so a refresh doesn't re-trigger the banner. Runs once on mount — intentionally NOT
  // reactive to searchParams (a param arriving mid-session would re-fire a stale banner).
  useEffect(() => {
    const connected = searchParams.get('m365_connected');
    const m365Error = searchParams.get('m365_error');
    if (connected === 'true') {
      setPhase('connected');
      setErrorText(null);
    } else if (m365Error) {
      setPhase('error');
      setErrorText(decodeURIComponent(m365Error));
    }
    if (connected === 'true' || m365Error) {
      const next = new URLSearchParams(searchParams);
      next.delete('m365_connected');
      next.delete('m365_error');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    } catch (err) {
      // Stay connected so the user can retry; surface the mapped human message.
      setPhase('connected');
      setErrorText(err instanceof Error && err.message ? err.message : 'Could not disconnect Microsoft 365.');
    } finally {
      setConfirmOpen(false);
    }
  }, []);

  // Two-switch gate — unchanged (AC-M365-012). Hooks above run unconditionally (rules-of-hooks).
  if (!entitled || !isAdmin) return null;

  const isConnected = phase === 'connected' || phase === 'disconnecting';
  const showBanner = phase === 'error' && errorText;

  return (
    <Card className="mb-3.5 p-4" data-testid="m365-connection-card">
      <div className="flex items-center gap-2">
        <Icon name="plug" />
        <h3 className="text-[15px] text-foreground font-semibold">Microsoft 365</h3>
      </div>

      {isConnected ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="m365-connected-msg">
          <Icon name="check" className="size-3.5 shrink-0 text-success-text" aria-hidden="true" />
          <span>Connected. You can disconnect any time.</span>
        </p>
      ) : showBanner ? (
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
        {!isConnected && (
          <Button
            variant="outline"
            onClick={onConnect}
            loading={phase === 'connecting'}
            data-testid="m365-connect-btn"
          >
            Connect Microsoft 365
          </Button>
        )}
        {isConnected && (
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
