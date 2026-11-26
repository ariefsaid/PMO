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
  compact?: boolean;
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
 * The folder step's state and its outcome region, shared by the inline RecordFolderAction button and by any
 * register that offers the same step from its own create menu. `allowed` false = offer nothing.
 */
export function useRecordFolderAction({ target, hasFolder, onChooseExisting }: RecordFolderActionProps) {
  const { t } = useTranslation('recordFolders');
  const may = usePermission();
  const roles = useEffectiveRole();
  const { pending, settledCopy, ensure } = useRecordFolder(target);
  const m365 = useFeature('m365_integration');
  const [reconnectFailed, setReconnectFailed] = useState(false);

  // Explicit view-only gate: `usePermission` binds the REAL role but does not itself refuse impersonation.
  const allowed = m365 && roles.realRole === roles.effectiveRole
    && (target.kind === 'procurement'
      ? may('create', 'procDoc')
      : may('create', 'document', target.kind === 'work_order' ? { record: { work_order_id: target.id } } : undefined));

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

  /** The live outcome of the folder step: progress, success, the reason it failed and its remedy. */
  const outcome = (
    <>
      {/* Polite, always-mounted live region: progress and success survive the register refetch. */}
      <p role="status" className={pending || linkedMessage ? 'text-control text-muted-foreground' : 'sr-only'}>
        {pending ? t('status.pending', 'Creating folder…') : (linkedMessage ?? '')}
      </p>
      {!hasFolder && failed && (
        <div
          role="status"
          data-testid="record-folder-failure"
          className="flex items-start gap-2.5 rounded-lg border border-border bg-muted px-3.5 py-3 text-control text-foreground"
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
    </>
  );

  /** Remedies the failure offers (choose an existing folder, reconnect); empty when there is none. */
  const remedies = !hasFolder && (failed?.remedy === 'chooseExisting' && onChooseExisting || failed?.remedy === 'reconnect') ? (
    <>
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
    </>
  ) : null;

  const reconnectError = reconnectFailed ? (
    <p role="alert" className="text-control text-destructive-text">
      {t('error.generic', 'Microsoft could not create or link this folder. Please try again.')}
    </p>
  ) : null;

  return {
    allowed,
    /** Something about the folder step is worth showing (progress, success, failure). */
    hasNotice: Boolean(pending || linkedMessage || (!hasFolder && failed) || reconnectFailed),
    /** The step can be started now: allowed, no folder yet, nothing in flight, and a retry can help. */
    canStart: allowed && !hasFolder && !pending && !retryUseless,
    pending,
    start: ensure,
    label: t('action.create', 'Create folder in SharePoint'),
    outcome,
    remedies,
    reconnectError,
  };
}

