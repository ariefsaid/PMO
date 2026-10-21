import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, GateNotice, Icon } from '@/src/components/ui';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useRecordFolder } from '@/src/hooks/useRecordFolder';
import { initiateM365Connect } from '@/src/lib/m365/connectClient';
import { recordFolderText } from '@/src/lib/m365/recordFolderCopy';
import type { RecordFolderTarget } from '@/src/lib/m365/recordFolders';

export interface RecordFolderActionProps {
  target: RecordFolderTarget;
  /** True when the register already holds any SharePoint/OneDrive folder reference for the record. */
  hasFolder: boolean;
  /** Opens the existing Microsoft picker (offered after an ambiguous match). Omit to hide the option. */
  onChooseExisting?: () => void;
}

function isHttps(url: string): boolean {
  try { return new URL(url).protocol === 'https:'; } catch { return false; }
}

/**
 * The register's single "Create folder in SharePoint" action (AC-M365DOC-071) plus the persistent
 * outcome for the record's folder step. Hidden by an existing folder reference (no connection or
 * default needed to open it), by a non-writer role and by view-only impersonation. The saved record
 * is never affected by what happens here; only this action is disabled while it works.
 */
export function RecordFolderAction({ target, hasFolder, onChooseExisting }: RecordFolderActionProps) {
  const { t } = useTranslation('recordFolders');
  const may = usePermission();
  const roles = useEffectiveRole();
  const { pending, settledCopy, ensure } = useRecordFolder(target);
  const [reconnectFailed, setReconnectFailed] = useState(false);

  // Explicit view-only gate: `usePermission` binds the REAL role but does not itself refuse impersonation.
  const allowed = roles.realRole === roles.effectiveRole
    && may('create', target.kind === 'project' ? 'document' : 'procDoc');
  if (!allowed) return null;

  async function reconnect() {
    setReconnectFailed(false);
    try {
      const { authorizeUrl } = await initiateM365Connect();
      if (!isHttps(authorizeUrl)) throw new Error('unsafe');
      window.location.assign(authorizeUrl);
    } catch {
      setReconnectFailed(true);
    }
  }

  const failed = settledCopy && !settledCopy.ok ? settledCopy : null;
  const linkedMessage = settledCopy?.ok ? recordFolderText(t, settledCopy.key) : null;

  return (
    <div className="min-w-0 space-y-2" data-testid="record-folder-action">
      {/* Polite, always-mounted live region: progress and success survive the register refetch. */}
      <p role="status" className={pending || linkedMessage ? 'text-[12.5px] text-muted-foreground' : 'sr-only'}>
        {pending ? t('status.pending', 'Creating folder…') : (linkedMessage ?? '')}
      </p>
      {!hasFolder && failed && (
        <GateNotice variant="blocked" role="status" data-testid="record-folder-failure">
          <div className="min-w-0 break-words">
            <b className="font-semibold">{t('status.savedNotLinked', 'Record saved. Folder not linked.')}</b>{' '}
            {recordFolderText(t, failed.key)}
          </div>
        </GateNotice>
      )}
      {!hasFolder && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" loading={pending} disabled={pending} onClick={ensure}>
            <Icon name="folder" />
            {t('action.create', 'Create folder in SharePoint')}
          </Button>
          {failed?.remedy === 'chooseExisting' && onChooseExisting && (
            <Button variant="outline" size="sm" onClick={onChooseExisting}>
              {t('action.choose', 'Choose existing folder')}
            </Button>
          )}
          {failed?.remedy === 'reconnect' && (
            <Button variant="outline" size="sm" onClick={() => { void reconnect(); }}>
              {t('action.reconnect', 'Reconnect Microsoft')}
            </Button>
          )}
        </div>
      )}
      {reconnectFailed && (
        <p role="alert" className="text-[12.5px] text-destructive-text">
          {t('error.generic', 'Microsoft could not create or link this folder. Please try again.')}
        </p>
      )}
    </div>
  );
}
