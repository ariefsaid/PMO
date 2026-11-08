import React from 'react';
import type { TFunction } from 'i18next';
import { Tooltip, StatusPill } from '@/src/components/ui';
import { formatDateOnly } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { projectOwner, projectReference, validMicrosoftBrowserUrl } from '@/src/lib/m365/reference';
import { LinkedDocumentCell } from '@/src/components/m365/LinkedDocumentCell';
import { isMicrosoftFolder } from './documentUtils';
import type { ProjectDocumentRow, DocStatus } from '@/src/lib/db/documents';

export interface DocumentRegisterCellDeps {
  t: TFunction;
  /** Profile id → display name, for the owner column. */
  profileNames: Map<string, string>;
  currentUserId: string | null;
  /** Documents whose live verification has been checked in the shared display batch. */
  verificationIds: Set<string>;
  verificationChecking: boolean;
  verificationFailed: boolean;
  retryVerification: (docs?: ProjectDocumentRow[]) => void;
  isError: boolean;
  /** The local-file cell from useDocumentFiles (download/preview affordances). */
  fileCell: (doc: ProjectDocumentRow) => React.ReactNode;
}

/**
 * The register's cell renderers (source, owner, status, date, Microsoft reference), built once per
 * render from the tab's reads — the exact closures the tab used inline, moved beside the columns.
 */
export function createDocumentRegisterCells(deps: DocumentRegisterCellDeps) {
  const { t, profileNames, currentUserId, verificationIds, verificationChecking, verificationFailed, retryVerification, isError, fileCell } = deps;

  /** The owner's name, "You", or '' when the name isn't visible — C4: an unknown is left blank, never "Name unavailable". */
  const ownerLabel = (doc: ProjectDocumentRow) => {
    const ownerId = doc.author_id ?? doc.ms_linked_by;
    const name = ownerId ? profileNames.get(ownerId)?.trim() : '';
    return name || (ownerId && ownerId === currentUserId ? t('projectDetail.documents.owner.you', 'You') : '');
  };
  const ownerInitials = (label: string) => {
    const words = label.split(/\s+/).filter(Boolean);
    return words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase() : (words[0]?.slice(0, 2) ?? '?').toUpperCase();
  };
  const sourceName = (doc: ProjectDocumentRow) =>
    doc.source === 'onedrive'
      ? t('projectDetail.documents.source.sharePoint', 'SharePoint')
      : t('projectDetail.documents.source.upload', 'Upload');
  const sourceCell = (doc: ProjectDocumentRow) => (
    <Tooltip
      title={t('projectDetail.documents.tooltip.sourceTitle', 'Source')}
      content={doc.source === 'onedrive'
        ? t('projectDetail.documents.tooltip.sourceSharePoint', 'Linked from Microsoft 365. The link opens the stored SharePoint item.')
        : t('projectDetail.documents.tooltip.sourceUpload', 'File source recorded in the project document register.')}
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
        title={t('projectDetail.documents.tooltip.ownerTitle', 'Owner')}
        content={t('projectDetail.documents.tooltip.owner', 'Document author from the organization profile.')}
      >
        <span tabIndex={0} className="inline-flex min-w-0 max-w-full items-center gap-2 text-[13px] text-foreground" aria-label={label}>
          <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground">
            {ownerInitials(label)}
          </span>
          <span className="truncate">{label}</span>
        </span>
      </Tooltip>
    );
  };
  const statusCell = (doc: ProjectDocumentRow) => isMicrosoftFolder(doc)
    ? <span className="text-muted-foreground">{'—'}</span>
    : (
      <Tooltip
        title={t('projectDetail.documents.tooltip.statusTitle', 'Status')}
        content={t('projectDetail.documents.tooltip.status', 'Current status from the document review workflow.')}
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
  // A complete Microsoft reference renders through the shared linked-document details in the
  // preview; a row with an incomplete reference remains an ordinary upload/source row.
  const microsoftCell = (d: ProjectDocumentRow, compact = false): React.ReactNode => {
    const reference = projectReference(d);
    return reference ? (
      <LinkedDocumentCell
        reference={reference}
        title={d.title}
        owner={projectOwner(d)}
        compact={compact}
        verification={verificationIds.has(d.id) ? {
          checking: verificationChecking,
          failed: verificationFailed,
          retry: () => retryVerification(isError ? [d] : undefined),
        } : undefined}
      />
    ) : null;
  };
  const statusLabels: Record<DocStatus, string> = {
    Draft: t('projectDetail.documents.action.reopen', 'Reopen for revision'),
    Issued: t('projectDetail.documents.action.issue', 'Issue'),
    Approved: t('projectDetail.documents.action.approve', 'Approve'),
    Rejected: t('projectDetail.documents.action.reject', 'Reject'),
    Closed: t('projectDetail.documents.action.close', 'Close'),
    Superseded: t('projectDetail.documents.action.close', 'Close'),
  };

  return { ownerLabel, ownerInitials, sourceName, sourceCell, ownerCell, statusCell, documentDateCell, documentHasFile, microsoftCell, statusLabels, fileCell };
}
