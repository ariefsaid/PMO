import { useTranslation } from 'react-i18next';
import { ApprovedVersionHistory } from '@/src/components/m365/LinkedDocumentVersions';
import { DocumentDriftBadge } from '@/src/components/m365/DocumentDriftBadge';
import { APPROVED_STATUSES, type MicrosoftReference, type ReferenceOwner } from '@/src/lib/m365/reference';

export type ProjectOwner = Extract<ReferenceOwner, { kind: 'project' }>;

/**
 * FR-012 / ADR-0071: a controlled document (Issued or later) keeps its revision identity, status and drift
 * state beside the preview, and the existing approved-version recovery stays one click away. This renders
 * only what the row already holds; opening the viewer writes nothing.
 */
export function ControlledExtra({ reference, owner }: { reference: MicrosoftReference; owner: ProjectOwner }) {
  const { t } = useTranslation();
  const approved = APPROVED_STATUSES.has(owner.status);
  const version = owner.version_id_at_issue;
  return (
    <div className="flex min-w-0 flex-col gap-2 border-t border-border pt-3">
      {version && (
        <span className="break-words text-support text-muted-foreground">
          {approved
            ? t('m365Documents.cell.approvedVersion', 'Approved version {{version}}', { version })
            : t('m365Documents.cell.issuedVersion', 'Issued version {{version}}', { version })}
        </span>
      )}
      <DocumentDriftBadge status={owner.status} driftState={owner.drift_state} lastVerifiedAt={owner.last_verified_at} />
      {approved && <ApprovedVersionHistory reference={reference} pinnedVersionId={version} />}
    </div>
  );
}
