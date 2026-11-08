import type { TFunction } from 'i18next';
import { projectReference } from '@/src/lib/m365/reference';
import { isMicrosoftFolder } from './documentUtils';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import type { RowMenuItem } from '@/src/components/ui';

export interface DocumentRowMenuDeps {
  t: TFunction;
  openPreview: (doc: ProjectDocumentRow) => void;
  handleDownload: (doc: ProjectDocumentRow) => void;
  canEditDoc: (doc: ProjectDocumentRow) => boolean;
  canWriteDocs: boolean;
  canDelete: boolean;
  canCreateMicrosoftReference: boolean;
  documentLinkPermissions: { projectEdit: (authorId: string | null, status: string) => boolean };
  statusActions: (doc: ProjectDocumentRow) => RowMenuItem[];
  startLatestRevision: (doc: ProjectDocumentRow) => void;
  copyDocumentLink: (doc: ProjectDocumentRow) => void;
  setFormTarget: (value: { doc: ProjectDocumentRow }) => void;
  setMicrosoftEntry: (value: { kind: 'link'; doc: ProjectDocumentRow } | { kind: 'create' }) => void;
  setUnlinkTarget: (doc: ProjectDocumentRow) => void;
  setRevisionParent: (doc: ProjectDocumentRow) => void;
  setDeleteTarget: (doc: ProjectDocumentRow) => void;
}

/** The register's per-row action menu — verbatim from the tab, as a builder over its gates. */
export function buildDocumentRowMenu(deps: DocumentRowMenuDeps) {
  const {
    t, openPreview, handleDownload, canEditDoc, canWriteDocs, canDelete, canCreateMicrosoftReference,
    documentLinkPermissions, statusActions, startLatestRevision, copyDocumentLink,
    setFormTarget, setMicrosoftEntry, setUnlinkTarget, setRevisionParent, setDeleteTarget,
  } = deps;
  return (d: ProjectDocumentRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    const reference = projectReference(d);
    if (d.file_path || reference?.web_url) {
      items.push({ label: t('projectDetail.documents.action.preview', 'Preview'), onClick: () => openPreview(d) });
    }
    if (d.file_path) {
      items.push({ label: t('projectDetail.documents.action.download', 'Download'), onClick: () => void handleDownload(d) });
    }
    // Edit metadata while not yet terminal (Draft/Issued/Rejected can still be corrected) AND
    // only for the AUTHOR (or Admin break-glass) — A-7 author rule (rbac-visibility §H).
    if (canEditDoc(d) && d.status !== 'Closed' && d.status !== 'Superseded') {
      items.push({ label: t('projectDetail.documents.action.edit', 'Edit'), onClick: () => setFormTarget({ doc: d }) });
    }
    // Link / unlink a Microsoft reference: Draft rows only, same author-or-Admin gate as Edit.
    const canLink = documentLinkPermissions.projectEdit(d.author_id, d.status);
    if (canLink && !d.file_path && d.source !== 'onedrive') {
      items.push({ label: t('m365Documents.link', 'Link from Microsoft 365'), onClick: () => setMicrosoftEntry({ kind: 'link', doc: d }) });
    }
    if (canLink && d.source === 'onedrive') {
      items.push({ label: t('m365Documents.unlink', 'Unlink Microsoft item'), onClick: () => setUnlinkTarget(d) });
    }
    // SUB-E: "New revision" is a row-menu item, not a column of its own on every row. A folder is
    // reference-only and has no revision; a changed Microsoft file offers the latest-update variant.
    if ((d.status === 'Issued' || d.status === 'Approved') && canWriteDocs && !isMicrosoftFolder(d)) {
      items.push({ label: t('projectDetail.documents.newRevision', 'New revision'), onClick: () => setRevisionParent(d) });
      if (d.source === 'onedrive' && d.ms_drift_state === 'drifted' && canCreateMicrosoftReference) {
        items.push({ label: t('m365Documents.newRevisionFromLatest', 'New revision from updated file'), onClick: () => void startLatestRevision(d) });
      }
    }
    items.push(...statusActions(d));
    items.push({ label: t('projectDetail.documents.action.copyLink', 'Copy link'), onClick: () => void copyDocumentLink(d) });
    if (canDelete) items.push({ label: t('projectDetail.documents.action.delete', 'Delete'), onClick: () => setDeleteTarget(d), danger: true });
    return items;
  };
}
