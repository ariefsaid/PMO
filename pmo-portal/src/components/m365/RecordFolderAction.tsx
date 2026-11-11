import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Icon } from '@/src/components/ui';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useFeature } from '@/src/auth/useFeature';
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
  const m365 = useFeature('m365_integration');
  const [reconnectFailed, setReconnectFailed] = useState(false);

  // Explicit view-only gate: `usePermission` binds the REAL role but does not itself refuse impersonation.
  const allowed = m365 && roles.realRole === roles.effectiveRole
    && may('create', target.kind === 'project' ? 'document' : 'procDoc');
  if (!allowed) return null;

  async function reconnect(folders: boolean) {
    setReconnectFailed(false);
    try {
      // Incremental consent (RF-8): only the "needs the folder permission" case asks for it.
      const { authorizeUrl } = await initiateM365Connect(folders ? { folders: true } : {});
      if (!isHttps(authorizeUrl)) throw new Error('unsafe');
      window.location.assign(authorizeUrl);
    } catch {
      setReconnectFailed(true);
    }
  }

  const failed = settledCopy && !settledCopy.ok ? settledCopy : null;
  // A retry cannot succeed until an Admin picks the default library; it would only repeat the same notice.
  const retryUseless = failed?.key === 'error.defaultUnset';
  const linkedMessage = settledCopy?.ok ? recordFolderText(t, settledCopy.key) : null;

  return (
    <div className="min-w-0 space-y-2" data-testid="record-folder-action">
      {/* Polite, always-mounted live region: progress and success survive the register refetch. */}
      <p role="status" className={pending || linkedMessage ? 'text-[12.5px] text-muted-foreground' : 'sr-only'}>
        {pending ? t('status.pending', 'Creating folder…') : (linkedMessage ?? '')}
      </p>
      {!hasFolder && failed && (
        <div
          role="status"
          data-testid="record-folder-failure"
          className="flex items-start gap-2.5 rounded-lg border border-border bg-muted px-3.5 py-3 text-[13px] text-foreground"
        >
          <Icon name="info" className="mt-px size-[17px] shrink-0 text-muted-foreground" />
          <div className="min-w-0 break-words">
            <b className="font-semibold">{t('status.notLinked', 'Folder not linked.')}</b>{' '}
            {failed.key === 'error.missingIdentifier' && target.kind === 'project'
              ? t('error.missingProjectCode', 'Add a project code to create its folder.')
              : recordFolderText(t, failed.key)}
            {retryUseless && roles.realRole === 'Admin' && roles.effectiveRole === 'Admin' && (
              <>
                {' '}
                <Link to="/administration/integrations#m365-default-library" className="text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {t('action.chooseLibrary', 'Choose the default document library')}
                </Link>
              </>
            )}
          </div>
        </div>
      )}
      {!hasFolder && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" loading={pending} disabled={pending || retryUseless} onClick={ensure}>
            <Icon name="folder" />
            {t('action.create', 'Create folder in SharePoint')}
          </Button>
          {failed?.remedy === 'chooseExisting' && onChooseExisting && (
            <Button variant="outline" size="sm" onClick={onChooseExisting}>
              {t('action.choose', 'Choose existing folder')}
            </Button>
          )}
          {failed?.remedy === 'reconnect' && (
            <Button variant="outline" size="sm" onClick={() => { void reconnect(failed.key === 'error.additionalConsent'); }}>
              {failed.key === 'error.additionalConsent'
                ? t('action.allowFolders', 'Allow folder creation')
                : t('action.reconnect', 'Reconnect Microsoft')}
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
