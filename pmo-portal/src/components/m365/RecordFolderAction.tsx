import { Button, Icon } from '@/src/components/ui';
import { useRecordFolderAction, type RecordFolderActionProps } from './useRecordFolderAction';

export type { RecordFolderActionProps };

/**
 * The register's single "Create folder in SharePoint" action (AC-M365DOC-071) plus the persistent
 * outcome for the record's folder step. Hidden by an existing folder reference (no connection or
 * default needed to open it), by a non-writer role and by view-only impersonation. The saved record
 * is never affected by what happens here; only this action is disabled while it works.
 */
export function RecordFolderAction(props: RecordFolderActionProps) {
  const { allowed, pending, start, label, outcome, remedies, reconnectError, canStart } = useRecordFolderAction(props);
  if (!allowed) return null;
  return (
    <div className="min-w-0 space-y-2" data-testid="record-folder-action">
      {outcome}
      {!props.hasFolder && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" loading={pending} disabled={!canStart} onClick={start}>
            <Icon name="folder" />
            {label}
          </Button>
          {remedies}
        </div>
      )}
      {reconnectError}
    </div>
  );
}
