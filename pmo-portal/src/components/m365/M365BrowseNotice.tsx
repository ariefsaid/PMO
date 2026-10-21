import { useState } from 'react';
import { Link } from 'react-router';
import { Button, GateNotice } from '@/src/components/ui';
import { describeM365Error, initiateM365Connect } from '@/src/lib/m365/connectClient';

const GENERIC_BROWSE = 'Microsoft could not load this location. Check access and SharePoint availability with your Microsoft admin, or retry.';
const NETWORK_BROWSE = 'Could not load Microsoft items. Retry; your selection and location are kept.';
const SAFE_RECONNECT_FAILURE = 'Could not start the Microsoft 365 reconnect. Try again.';

/** Codes whose remedy is a (re)connect: the only ones that may offer the Reconnect action. */
const RECONNECT_CODES = new Set(['CONNECTION_STALE', 'CONNECTION_REVOKED', 'SCOPE_INSUFFICIENT']);
/** Codes the shared taxonomy words precisely (entitlement/membership/approval); no retry or reconnect loop. */
const TAXONOMY_CODES = new Set(['NOT_ENTITLED', 'ORG_APPROVAL_REQUIRED', 'DISABLED_MEMBER', 'BANNED_MEMBER', 'FORBIDDEN', 'UNAUTHORIZED']);

function messageFor(code: string | undefined): string {
  switch (code) {
    case 'CONNECTION_STALE':
    case 'CONNECTION_REVOKED':
      return 'The Microsoft 365 connection expired. Reconnect to link more documents.';
    case 'SCOPE_INSUFFICIENT':
      return 'The connection needs additional permissions. Reconnect to grant them.';
    case 'NOT_CONNECTED':
      return 'Connect Microsoft 365 first to browse documents.';
    case 'external-unreachable':
      return NETWORK_BROWSE;
    default:
      return code && TAXONOMY_CODES.has(code) ? describeM365Error(code) : GENERIC_BROWSE;
  }
}

/** Only a reconnect that Microsoft's own authorize endpoint returned may be followed. */
function isHttps(url: string): boolean {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}

export interface M365BrowseNoticeProps {
  /** A stable M365 error code. Unknown/absent codes render the reviewed generic sentence, never the raw body. */
  code?: string;
  onRetry?: () => void;
  /** Overrides the default reconnect (existing `initiateM365Connect` + redirect to its returned authorize URL only). */
  onReconnect?: () => void;
}

/**
 * Reviewed recovery copy for browsing Microsoft locations (spec §3.8, AC-M365DOC-032/034/035).
 * Maps stable codes only; raw bodies, identifiers and scope strings never reach the DOM.
 * Reconnect is offered only where a connection is the remedy, never as a licence/access fix.
 */
export function M365BrowseNotice({ code, onRetry, onReconnect }: M365BrowseNoticeProps) {
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectFailed, setReconnectFailed] = useState(false);
  const canReconnect = !!code && RECONNECT_CODES.has(code);
  const canRetry = !!onRetry && code !== 'NOT_CONNECTED' && !(code && RECONNECT_CODES.has(code)) && !(code && TAXONOMY_CODES.has(code));

  async function reconnect() {
    if (onReconnect) { onReconnect(); return; }
    setReconnecting(true); setReconnectFailed(false);
    try {
      const { authorizeUrl } = await initiateM365Connect();
      if (!isHttps(authorizeUrl)) throw new Error('unsafe');
      window.location.assign(authorizeUrl);
    } catch {
      setReconnectFailed(true);
      setReconnecting(false);
    }
  }

  return (
    <div className="min-w-0 space-y-2">
      <GateNotice variant="blocked">{messageFor(code)}</GateNotice>
      {reconnectFailed && <p role="alert" className="text-[12.5px] text-destructive-text">{SAFE_RECONNECT_FAILURE}</p>}
      <div className="flex flex-wrap gap-2">
        {code === 'NOT_CONNECTED' && (
          <Link
            to="/administration/integrations"
            className="touch-target inline-flex h-8 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent"
          >
            Go to Microsoft 365 setup
          </Link>
        )}
        {canRetry && <Button variant="outline" onClick={onRetry}>Retry</Button>}
        {canReconnect && <Button variant="outline" loading={reconnecting} onClick={() => void reconnect()}>Reconnect Microsoft 365</Button>}
      </div>
    </div>
  );
}
