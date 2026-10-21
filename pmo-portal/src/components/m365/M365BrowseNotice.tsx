import { Button, GateNotice } from '@/src/components/ui';
import { describeM365Error } from '@/src/lib/m365/connectClient';

export function M365BrowseNotice({ code, onRetry, onReconnect }: { code?: string; onRetry?: () => void; onReconnect?: () => void }) {
  const message = code === 'CONNECTION_STALE' || code === 'CONNECTION_REVOKED'
    ? 'The Microsoft 365 connection expired. Reconnect to link more documents.'
    : code === 'SCOPE_INSUFFICIENT'
      ? 'The connection needs additional permissions. Reconnect to grant them.'
      : code === 'NOT_CONNECTED'
        ? 'Connect Microsoft 365 first to browse documents.'
        : code && ['NOT_ENTITLED', 'ORG_APPROVAL_REQUIRED', 'DISABLED_MEMBER', 'BANNED_MEMBER', 'FORBIDDEN'].includes(code) ? describeM365Error(code) : 'Microsoft could not load this location. Check access and SharePoint availability with your Microsoft admin, or retry.';
  return <div className="space-y-2"><GateNotice variant="blocked">{message}</GateNotice>
    <div className="flex gap-2">{onRetry && <Button variant="outline" onClick={onRetry}>Retry</Button>}{onReconnect && <Button variant="ghost" onClick={onReconnect}>Reconnect Microsoft 365</Button>}</div>
  </div>;
}
