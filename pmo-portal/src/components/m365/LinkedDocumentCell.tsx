import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/src/components/ui';
import { APPROVED_STATUSES, microsoftProvenance, validMicrosoftBrowserUrl, type MicrosoftReference, type ReferenceOwner } from '@/src/lib/m365/reference';
import { DocumentDriftBadge } from './DocumentDriftBadge';
import { ApprovedVersionHistory, LinkedDocumentVersionsModal } from './LinkedDocumentVersions';

export interface LinkedDocumentCellProps {
  reference: MicrosoftReference;
  /** The PMO title. It is never changed by a Microsoft rename; a differing Microsoft name is shown as secondary text. */
  title?: string;
  owner: ReferenceOwner;
  /**
   * Register rows: icon + file label, one status pill and one Open action. The access sentence,
   * versions and approved history live in the full (Drawer) cell, so they are not repeated per row.
   */
  compact?: boolean;
}

/**
 * Read-only display of a Microsoft file/folder reference on any parent (AC-M365DOC-058/065/064).
 * Opening the stored URL is a plain `window.open` of an already-validated https URL: it needs no
 * connection, no permission and no Graph call, so a viewer without a PMO connection can open it.
 * Everything that DOES read Microsoft (versions, approved history) is a separate, explicit action
 * and never replaces or disables "open".
 */
export function LinkedDocumentCell({ reference, title, owner, compact = false }: LinkedDocumentCellProps) {
  const { t } = useTranslation();
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [openRefused, setOpenRefused] = useState(false);
  const place = microsoftProvenance(reference.web_url);
  const isFolder = reference.item_kind === 'folder';
  const project = owner.kind === 'project' ? owner : null;
  const controlled = !!project && !isFolder && project.status !== 'Draft';
  const approved = controlled && APPROVED_STATUSES.has(project.status);
  const version = project?.version_id_at_issue ?? null;
  const pinnedLabel = controlled && version
    ? approved
      ? t('m365Documents.cell.approvedVersion', 'Approved version {{version}}', { version })
      : t('m365Documents.cell.issuedVersion', 'Issued version {{version}}', { version })
    : null;
  const label = title ?? reference.name;
  const openText = isFolder
    ? t('m365Documents.cell.openFolder', 'Open folder in {{place}}', { place })
    : approved
      ? t('m365Documents.cell.openLatest', 'Open latest in {{place}}', { place })
      : t('m365Documents.cell.open', 'Open in {{place}}', { place });

  function openReference() {
    // Re-validated at the moment of navigation, not trusted from storage.
    if (!validMicrosoftBrowserUrl(reference.web_url)) { setOpenRefused(true); return; }
    setOpenRefused(false);
    window.open(reference.web_url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-foreground">
        <Icon name={isFolder ? 'folder' : 'doc'} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 break-words">{isFolder ? t('m365Documents.cell.folder', '{{place}} folder', { place }) : t('m365Documents.cell.file', '{{place}} file', { place })}</span>
      </span>
      {!compact && reference.name !== title && <span className="break-words text-[12px] text-muted-foreground">{reference.name}</span>}
      {project && isFolder && <span data-folder-reference className="break-words text-[12px] text-muted-foreground">{t('m365Documents.referenceOnly', 'Folder reference — contents are not issued or approved')}</span>}
      {controlled && compact && <DocumentDriftBadge compact status={project.status} driftState={project.drift_state} lastVerifiedAt={project.last_verified_at} />}
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" className="min-w-0 whitespace-normal! text-left" aria-label={`${openText}: ${label}`} onClick={openReference}>
          <Icon name="eye" />
          {compact ? t('m365Documents.cell.openShort', 'Open') : openText}
        </Button>
        {!compact && !isFolder && (
          <Button variant="ghost" size="sm" aria-label={t('m365Documents.cell.versionsOf', 'Versions of {{name}}', { name: label })} onClick={() => setVersionsOpen(true)}>
            {t('m365Documents.cell.versions', 'Versions')}
          </Button>
        )}
      </div>
      {openRefused && <p role="alert" className="text-[12px] text-destructive-text">{t('m365Documents.cell.openRefused', 'This Microsoft link cannot be opened.')}</p>}
      {!compact && (
        <span className="break-words text-[12px] text-muted-foreground">
          {isFolder
            ? t('m365Documents.cell.accessFolder', 'Opens in Microsoft. Access depends on your Microsoft permissions on this folder.')
            : t('m365Documents.cell.accessFile', 'Opens in Microsoft. Access depends on your Microsoft permissions on this file.')}
        </span>
      )}
      {!compact && pinnedLabel && <span className="break-words text-[12px] text-muted-foreground">{pinnedLabel}</span>}
      {!compact && controlled && <DocumentDriftBadge status={project.status} driftState={project.drift_state} lastVerifiedAt={project.last_verified_at} />}
      {!compact && approved && <ApprovedVersionHistory reference={reference} pinnedVersionId={project.version_id_at_issue} />}
      {versionsOpen && (
        <LinkedDocumentVersionsModal
          reference={reference}
          pinned={pinnedLabel && version ? { id: version, label: approved ? t('m365Documents.cell.approvedVersionLabel', 'Approved version') : t('m365Documents.cell.issuedVersionLabel', 'Issued version') } : null}
          onClose={() => setVersionsOpen(false)}
        />
      )}
    </div>
  );
}
