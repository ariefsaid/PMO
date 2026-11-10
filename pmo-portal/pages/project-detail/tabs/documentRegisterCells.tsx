import React from 'react';
import type { TFunction } from 'i18next';
import { Avatar, Tooltip, StatusPill } from '@/src/components/ui';
import { formatDateOnly } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { projectReference, validMicrosoftBrowserUrl } from '@/src/lib/m365/reference';
import { isMicrosoftFolder } from './documentUtils';
import type { ProjectDocumentRow, DocStatus } from '@/src/lib/db/documents';

export interface DocumentRegisterCellDeps {
  t: TFunction;
  /** Profile id → display name, for the owner column. */
  profileNames: Map<string, string>;
  currentUserId: string | null;
  /** The local-file cell from useDocumentFiles (download/preview affordances). */
  fileCell: (doc: ProjectDocumentRow) => React.ReactNode;
}

/**
 * The register's cell renderers (source, owner, status, date), built once per
 * render from the tab's reads — the exact closures the tab used inline, moved beside the columns.
 */
export function createDocumentRegisterCells(deps: DocumentRegisterCellDeps) {
  const { t, profileNames, currentUserId, fileCell } = deps;

  /** The owner's name, "You", or '' when the name isn't visible — C4: an unknown is left blank, never "Name unavailable". */
  const ownerLabel = (doc: ProjectDocumentRow) => {
    const ownerId = doc.author_id ?? doc.ms_linked_by;
    const name = ownerId ? profileNames.get(ownerId)?.trim() : '';
    return name || (ownerId && ownerId === currentUserId ? t('project:projectDetail.documents.owner.you', 'You') : '');
  };
  const sourceName = (doc: ProjectDocumentRow) =>
    doc.source === 'onedrive'
      ? t('project:projectDetail.documents.source.sharePoint', 'SharePoint')
      : t('project:projectDetail.documents.source.upload', 'Upload');
  const sourceCell = (doc: ProjectDocumentRow) => (
    <Tooltip
      title={t('project:projectDetail.documents.tooltip.sourceTitle', 'Source')}
      content={doc.source === 'onedrive'
        ? t('project:projectDetail.documents.tooltip.sourceSharePoint', 'Linked from Microsoft 365. The link opens the stored SharePoint item.')
        : t('project:projectDetail.documents.tooltip.sourceUpload', 'File source recorded in the project document register.')}
    >
      <span tabIndex={0} className="inline-flex min-w-0 max-w-full items-center text-[13px] text-muted-foreground" aria-label={sourceName(doc)}>
        {sourceName(doc)}
      </span>
    </Tooltip>
  );
  const ownerCell = (doc: ProjectDocumentRow) => {
    const label = ownerLabel(doc);
    if (!label) return null;
    return (
      <Tooltip
        title={t('project:projectDetail.documents.tooltip.ownerTitle', 'Owner')}
        content={t('project:projectDetail.documents.tooltip.owner', 'Document author from the organization profile.')}
      >
        <span tabIndex={0} className="inline-flex min-w-0 max-w-full items-center gap-2 text-[13px] text-foreground" aria-label={label}>
          <Avatar name={label} decorative />
          <span className="truncate">{label}</span>
        </span>
      </Tooltip>
    );
  };
  const statusCell = (doc: ProjectDocumentRow) => isMicrosoftFolder(doc)
    ? <span className="text-muted-foreground">{'—'}</span>
    : (
      <Tooltip
        title={t('project:projectDetail.documents.tooltip.statusTitle', 'Status')}
        content={t('project:projectDetail.documents.tooltip.status', 'Current status from the document review workflow.')}
      >
        <span tabIndex={0} className="inline-flex"><StatusPill variant={workflowVariant(doc.status)}>{doc.status}</StatusPill></span>
      </Tooltip>
    );
  const documentDateCell = (doc: ProjectDocumentRow) => (
    <span className="whitespace-nowrap tabular text-muted-foreground">
      {doc.doc_date ? formatDateOnly(doc.doc_date) : '—'}
    </span>
  );
  const documentHasFile = (doc: ProjectDocumentRow) => {
    const webUrl = projectReference(doc)?.web_url;
    return Boolean(doc.file_path || (!isMicrosoftFolder(doc) && webUrl && validMicrosoftBrowserUrl(webUrl)));
  };
  const statusLabels: Record<DocStatus, string> = {
    Draft: t('project:projectDetail.documents.action.reopen', 'Reopen for revision'),
    Issued: t('project:projectDetail.documents.action.issue', 'Issue'),
    Approved: t('project:projectDetail.documents.action.approve', 'Approve'),
    Rejected: t('project:projectDetail.documents.action.reject', 'Reject'),
    Closed: t('project:projectDetail.documents.action.close', 'Close'),
    Superseded: t('project:projectDetail.documents.action.close', 'Close'),
  };

  return { ownerLabel, sourceName, sourceCell, ownerCell, statusCell, documentDateCell, documentHasFile, statusLabels, fileCell };
}
