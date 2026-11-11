import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, GateNotice } from '@/src/components/ui';
import { MicrosoftDocumentPicker } from '@/src/components/m365/MicrosoftDocumentPicker';
import { M365BrowseNotice } from '@/src/components/m365/M365BrowseNotice';
import { useMicrosoftDocuments } from '@/src/hooks/useMicrosoftDocuments';
import type { MicrosoftReferenceInput } from '@/src/lib/m365/reference';

// ── Microsoft 365 entry: connection gate + picker ────────────────────────────

interface MicrosoftEntryProps {
  code: string | null;
  onClose: () => void;
  onSelect: (reference: MicrosoftReferenceInput) => Promise<void>;
}

/**
 * The caller's connection decides ONLY whether browsing is offered. Mounted on demand, so the
 * status read happens for a mutation browse entry and never for committed rows: those render and
 * open with no connection at all. Pending/error never guess "active"; every non-active state is a
 * secondary notice (setup link, reconnect, retry) and no picker request is made.
 */
export const MicrosoftEntry: React.FC<MicrosoftEntryProps> = ({ code, onClose, onSelect }) => {
  const { t } = useTranslation('project');
  const { connection, isPending, refetch } = useMicrosoftDocuments();
  const canBrowse = connection?.connected === true && connection.status === 'active';

  if (canBrowse) {
    return <MicrosoftDocumentPicker open context={{ kind: 'project', code }} onClose={onClose} onSelect={onSelect} />;
  }

  let notice: React.ReactNode;
  if (!connection && isPending) {
    notice = (
      <p role="status" className="text-[13px] text-muted-foreground">
        {t('m365Documents.checkingConnection', 'Checking your Microsoft 365 connection…')}
      </p>
    );
  } else if (!connection) {
    // Unknown (status read failed): never assume active; offer an explicit retry next to the action.
    notice = <M365BrowseNotice code="external-unreachable" onRetry={() => void refetch()} />;
  } else if (!connection.connected) {
    // The personal connection page (/integrations) is open to every role; the Admin area is not.
    notice = (
      <div className="min-w-0 space-y-2">
        <GateNotice variant="blocked">
          {t('m365Documents.docsTab.notConnected', 'Connect Microsoft 365 first to browse documents.')}
        </GateNotice>
        <Link
          to="/integrations"
          className="touch-target inline-flex h-8 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent"
        >
          {t('m365Documents.docsTab.myIntegrations', 'My integrations')}
        </Link>
      </div>
    );
  } else {
    notice = <M365BrowseNotice connection={connection} code={connection.status === 'revoked' ? 'CONNECTION_REVOKED' : 'CONNECTION_STALE'} />;
  }

  return (
    <div className="mb-3.5 space-y-2" data-testid="m365-connection-gate">
      {notice}
      <Button variant="ghost" size="sm" onClick={onClose}>
        {t('projectDetail.documents.dismiss', 'Dismiss')}
      </Button>
    </div>
  );
};
