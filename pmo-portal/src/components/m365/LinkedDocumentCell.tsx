import { useState } from 'react';
import { Button, Icon } from '@/src/components/ui';
import { microsoftProvenance, validMicrosoftBrowserUrl, type MicrosoftReference, type ReferenceOwner } from '@/src/lib/m365/reference';
import { APPROVED_STATUSES, DocumentDriftBadge } from './DocumentDriftBadge';
import { ApprovedVersionHistory, LinkedDocumentVersionsModal } from './LinkedDocumentVersions';

export interface LinkedDocumentCellProps {
  reference: MicrosoftReference;
  /** The PMO title. It is never changed by a Microsoft rename; a differing Microsoft name is shown as secondary text. */
  title?: string;
  owner: ReferenceOwner;
}

/**
 * Read-only display of a Microsoft file/folder reference on any parent (AC-M365DOC-058/065/064).
 * Opening the stored URL is a plain `window.open` of an already-validated https URL: it needs no
 * connection, no permission and no Graph call, so a viewer without a PMO connection can open it.
 * Everything that DOES read Microsoft (versions, approved history) is a separate, explicit action
 * and never replaces or disables "open".
 */
export function LinkedDocumentCell({ reference, title, owner }: LinkedDocumentCellProps) {
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [openRefused, setOpenRefused] = useState(false);
  const provenance = microsoftProvenance(reference.web_url);
  const isFolder = reference.item_kind === 'folder';
  const noun = isFolder ? 'folder' : 'file';
  const project = owner.kind === 'project' ? owner : null;
  const controlled = !!project && !isFolder && project.status !== 'Draft';
  const approved = controlled && APPROVED_STATUSES.has(project.status);
  const pinnedLabel = controlled && project.version_id_at_issue
    ? `${approved ? 'Approved' : 'Issued'} version ${project.version_id_at_issue}`
    : null;
  const label = title ?? reference.name;
  const openText = isFolder ? `Open folder in ${provenance}` : approved ? `Open latest in ${provenance}` : `Open in ${provenance}`;

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
        <span className="min-w-0 break-words">{`${provenance} ${noun}`}</span>
      </span>
      {reference.name !== title && <span className="break-words text-[12px] text-muted-foreground">{reference.name}</span>}
      {project && isFolder && <span className="text-[12px] text-muted-foreground">Reference only</span>}
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" className="min-w-0" aria-label={`${openText}: ${label}`} onClick={openReference}>
          <Icon name="eye" />
          {openText}
        </Button>
        {!isFolder && (
          <Button variant="ghost" size="sm" aria-label={`Versions of ${label}`} onClick={() => setVersionsOpen(true)}>
            Versions
          </Button>
        )}
      </div>
      {openRefused && <p role="alert" className="text-[12px] text-destructive-text">This Microsoft link cannot be opened.</p>}
      <span className="break-words text-[12px] text-muted-foreground">
        {`Opens in Microsoft. Access depends on your Microsoft permissions on this ${noun}.`}
      </span>
      {pinnedLabel && <span className="break-words text-[12px] text-muted-foreground">{pinnedLabel}</span>}
      {controlled && <DocumentDriftBadge status={project.status} driftState={project.drift_state} lastVerifiedAt={project.last_verified_at} />}
      {approved && <ApprovedVersionHistory reference={reference} pinnedVersionId={project.version_id_at_issue} />}
      {versionsOpen && (
        <LinkedDocumentVersionsModal
          reference={reference}
          pinned={pinnedLabel && project?.version_id_at_issue ? { id: project.version_id_at_issue, label: approved ? 'Approved version' : 'Issued version' } : null}
          onClose={() => setVersionsOpen(false)}
        />
      )}
    </div>
  );
}
