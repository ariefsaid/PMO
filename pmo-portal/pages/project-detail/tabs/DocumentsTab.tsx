import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Toolbar,
  SearchMini,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  Drawer,
  EntityFormModal,
  type SubmitError,
  TextField,
  SelectField,
  FormSection,
  FormGrid,
  GateNotice,
  useEntityForm,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useDocuments, useDocumentMutations } from '@/src/hooks/useDocuments';
import { useFileUpload } from '@/src/hooks/useFileUpload';
import { useRevision } from '@/src/hooks/useRevision';
import { RecordFolderAction } from '@/src/components/m365/RecordFolderAction';
import { FileCell } from '@/src/components/FileCell';
import { LinkedDocumentCell } from '@/src/components/m365/LinkedDocumentCell';
import { MicrosoftDocumentPicker } from '@/src/components/m365/MicrosoftDocumentPicker';
import { useDocumentLinkPermissions } from '@/src/components/m365/DocumentLinkPermissions';
import { M365BrowseNotice } from '@/src/components/m365/M365BrowseNotice';
import { useMicrosoftDocuments } from '@/src/hooks/useMicrosoftDocuments';
import { getItem } from '@/src/lib/m365/graphClient';
import { projectOwner, projectReference, type MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import { NewRevisionModal } from '@/src/components/NewRevisionModal';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { CATEGORY_OPTIONS } from '@/src/lib/documentCategories';
import { validateFile } from '@/src/lib/validateFile';
import { FILE_INPUT_ACCEPT } from '@/src/lib/fileConstants';
import { repositories } from '@/src/lib/repositories';
import type {
  ProjectDocumentRow,
  ProjectDocumentInput,
  DocStatus,
} from '@/src/lib/db/documents';
import { workflowVariant } from '@/src/lib/status/statusVariants';

export interface DocumentsTabProps {
  projectId: string;
  /** The PROJECT's code (loaded by the parent), used to suggest convention folders in the picker. */
  projectCode?: string | null;
}

/** True for a register row that references a Microsoft folder (reference-only: never issued/approved). */
const isMicrosoftFolder = (d: ProjectDocumentRow) => d.source === 'onedrive' && d.ms_item_kind === 'folder';

/** The Microsoft entry point in flight: a new document seeded from a reference, or linking an existing Draft. */
type MicrosoftEntryTarget = { kind: 'create' } | { kind: 'link'; doc: ProjectDocumentRow };

/**
 * Per-project DOCUMENT REGISTER (metadata only — Storage is disabled, so there is no file
 * upload; "file attachments arrive with Storage" is signposted by the register subtitle copy,
 * NOT by a dead/disabled control — D13 removed the placeholder "Attach file" button, OD-W2-5).
 * Replaces the deferred placeholder with a real CRUD + status-workflow register, applying
 * crud-components §9.9 / rbac-visibility §H + the Companies slice template.
 *
 * Status workflow: Draft → Issued → Approved / Rejected → Closed. The Approve/Reject step is
 * SoD-gated (approver ≠ author): the document's author can never approve their own document.
 * Gating reads the REAL JWT role + the current user id; RLS is the enforcement authority.
 */

// Doc-status pill comes from the single status registry (`workflowVariant`):
// Draft = `draft`; Issued = neutral grey `progress` (in-review — NOT the action-blue,
// per the Freed-Blue Status Rule); Approved = green `won`; Rejected = red `lost`;
// Closed = neutral; Superseded = `superseded`. The distinct LABEL carries identity.

interface FormValues {
  title: string;
  code: string;
  category: string;
  revision: string;
  doc_date: string;
}

const validate = (v: FormValues, t: TFunction, isFolder = false): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.title.trim())
    errors.title = t('projectDetail.documents.form.errors.titleRequired', 'Title is required.');
  if (!isFolder && !v.category.trim())
    errors.category = t(
      'projectDetail.documents.form.errors.categoryRequired',
      'Category is required.',
    );
  return errors;
};

/**
 * The bare action word for a transition, used as the confirm-dialog title verb.
 * Derived from the target STATUS (a stable enum) rather than by stripping an English
 * " document" suffix off the translated verb, which only ever worked in English.
 */
function transitionActionLabel(to: DocStatus, t: TFunction): string {
  switch (to) {
    case 'Issued':
      return t('projectDetail.documents.action.issue', 'Issue');
    case 'Approved':
      return t('projectDetail.documents.action.approve', 'Approve');
    case 'Rejected':
      return t('projectDetail.documents.action.reject', 'Reject');
    case 'Draft':
      return t('projectDetail.documents.action.reopen', 'Reopen for revision');
    default:
      return t('projectDetail.documents.action.close', 'Close');
  }
}

/** A pending status transition launched from a row. */
interface PendingTransition {
  doc: ProjectDocumentRow;
  to: DocStatus;
  /** Confirm button verb, e.g. "Issue document". */
  verb: string;
}

const DocumentsTab: React.FC<DocumentsTabProps> = ({ projectId, projectCode = null }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const documentLinkPermissions = useDocumentLinkPermissions();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useDocuments(projectId);
  const { create, update, transition, remove, link, unlink } = useDocumentMutations(projectId);
  const { upload, replace, progress, uploadErrors, cancelUpload, clearUploadError } = useFileUpload(projectId);
  const { createRevision } = useRevision(projectId);

  const [search, setSearch] = useState('');

  // Modal: null = closed; { doc: null } = create; { doc } = edit.
  const [formTarget, setFormTarget] = useState<{ doc: ProjectDocumentRow | null; reference?: MicrosoftReferenceInput } | null>(null);
  // At most one Microsoft entry (picker or its gate notice) is mounted; closing it precedes any next modal.
  const [microsoftEntry, setMicrosoftEntry] = useState<MicrosoftEntryTarget | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<ProjectDocumentRow | null>(null);
  // Latest-file revision: the metadata is re-read BEFORE the form opens so the child references
  // what Microsoft holds now, never a copied baseline.
  const [latestRevision, setLatestRevision] = useState<{ parent: ProjectDocumentRow; reference: MicrosoftReferenceInput } | null>(null);
  const [latestBusy, setLatestBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTransition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectDocumentRow | null>(null);
  // The author who tried to act on their own Issued document (SoD block) — drives the
  // inline GateNotice that explains why Approve/Reject is unavailable.
  const [sodBlocked, setSodBlocked] = useState<ProjectDocumentRow | null>(null);
  // D12: the document shown in the read-first quick-view Drawer (the in-hand row;
  // no extra fetch). Row activation opens it; the status section + footer reuse
  // the existing statusActions gating + setPending/setFormTarget/setDeleteTarget.
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeFileDoc, setActiveFileDoc] = useState<{ docId: string; mode: 'upload' | 'replace' } | null>(null);
  const [clientUploadErrors, setClientUploadErrors] = useState<Record<string, string>>({});
  const [revisionParent, setRevisionParent] = useState<ProjectDocumentRow | null>(null);

  const currentUserId = currentUser?.id ?? null;
  const canCreate = may('create', 'document');
  const canCreateMicrosoftReference = documentLinkPermissions.projectCreate();
  // General document write-role (Admin·Exec·PM·Finance) — gates the non-author status moves
  // (Issue Draft→Issued, Close Approved→Closed). A-7: the metadata "Edit" action is additionally
  // AUTHOR-scoped (only the author, or Admin break-glass) — computed per row via canEditDoc().
  const canWriteDocs = may('create', 'document');
  const canDelete = may('delete', 'document');
  const canApprove = may('transition', 'documentStatus');

  // A-7 (rbac-visibility §H): Edit a document = ◆ author. The policy predicate is record-scoped,
  // so pass the row's author_id + the current user. Admin is break-glass (edit is not an SoD
  // axis). RLS/RPC stays the authority; this is FE clarity.
  const canEditDoc = (d: ProjectDocumentRow) =>
    may('edit', 'document', { currentUserId, record: { author_id: d.author_id } });

  // Used as a row-menu label AND as the identity the drawer filters that row out by.
  const reviewUnavailableLabel = t(
    'projectDetail.documents.action.whyUnavailable',
    'Why is review unavailable?',
  );

  const all = useMemo(() => (data ?? []) as ProjectDocumentRow[], [data]);
  const hasAnyFile = all.some((doc) =>
    Boolean(doc.file_path) || (doc.source === 'onedrive' && doc.ms_item_kind === 'file'),
  );

  const documentsById = useMemo(() => {
    const map = new Map<string, ProjectDocumentRow>();
    all.forEach((doc) => map.set(doc.id, doc));
    return map;
  }, [all]);

  const childDocumentsByParentId = useMemo(() => {
    const map = new Map<string, ProjectDocumentRow>();
    all.forEach((doc) => {
      if (doc.parent_document_id) {
        map.set(doc.parent_document_id, doc);
      }
    });
    return map;
  }, [all]);

  // The Drawer resolves its row against the refreshed register, never a stale copy, so a link,
  // unlink or check landing while it is open is reflected without losing focus or state.
  const drawerDoc = drawerId ? (documentsById.get(drawerId) ?? null) : null;
  const setDrawerDoc = useCallback((doc: ProjectDocumentRow | null) => setDrawerId(doc?.id ?? null), []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.code ?? '').toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q),
    );
  }, [all, search]);

  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  // approver ≠ author (Document approval SoD): the author can never approve/reject their own doc.
  const isOwnDocument = (d: ProjectDocumentRow) =>
    !!currentUserId && d.author_id === currentUserId;

  // A Microsoft reference renders through the shared read-only cell (table AND Drawer); a row whose
  // reference is incomplete is never mistaken for one and keeps the ordinary File cell.
  const microsoftCell = (d: ProjectDocumentRow, compact = false): React.ReactNode => {
    const reference = projectReference(d);
    return reference ? <LinkedDocumentCell compact={compact} reference={reference} title={d.title} owner={projectOwner(d)} /> : null;
  };

  const columns: Column<ProjectDocumentRow>[] = [
    {
      // D12: Document (title) leads the row so the DataTable's first-cell
      // activation <button> (rowLabel) wraps the row's natural identity — the
      // keyboard/SR doorway into the quick-view drawer. (Was Code-first; Code
      // can be null and is hidden below `sm`, so it's the wrong activation cell.)
      key: 'title',
      header: t('projectDetail.documents.column.document', 'Document'),
      cell: (d) => (
        <DocumentTitleCell
          doc={d}
          parentDoc={d.parent_document_id ? (documentsById.get(d.parent_document_id) ?? null) : null}
          childDoc={childDocumentsByParentId.get(d.id) ?? null}
          onViewDocument={setDrawerDoc}
        />
      ),
    },
    {
      key: 'code',
      header: t('projectDetail.documents.column.code', 'Code'),
      size: 96, minSize: 96, maxSize: 96,
      colClassName: 'hidden sm:table-cell w-[96px]',
      cell: (d) =>
        d.code ? (
          <span className="font-mono text-[12.5px] text-muted-foreground" title={d.code}>
            {d.code}
          </span>
        ) : (
          <span className="text-muted-foreground">{'—'}</span>
        ),
    },
    {
      key: 'file_path',
      header: t('projectDetail.documents.column.file', 'File'),
      size: 176, minSize: 176, maxSize: 176,
      colClassName: 'hidden md:table-cell w-[176px]',
      cell: (d) => microsoftCell(d, true) ?? (
        <FileCell
          status={d.status}
          filePath={d.file_path}
          title={d.title}
          uploadProgress={progress[d.id]}
          uploadError={clientUploadErrors[d.id] ?? uploadErrors[d.id]?.message ?? null}
          onUpload={d.status === 'Draft' && canWriteDocs ? () => handleUploadClick(d.id) : undefined}
          onReplace={d.status === 'Draft' && d.file_path && canWriteDocs ? () => handleReplaceClick(d.id) : undefined}
          onCancelUpload={() => cancelUpload(d.id)}
          onRemoveError={() => clearAnyUploadError(d.id)}
          onDownload={d.file_path ? () => void handleDownload(d) : undefined}
          onPreview={d.file_path ? () => void handlePreview(d) : undefined}
        />
      ),
    },
    {
      key: 'category',
      header: t('projectDetail.documents.column.category', 'Category'),
      size: 112, minSize: 112, maxSize: 112,
      colClassName: 'hidden md:table-cell w-[112px]',
      cell: (d) => isMicrosoftFolder(d)
        ? <span className="text-muted-foreground">{'—'}</span>
        : <span className="text-[13px] text-muted-foreground">{d.category}</span>,
    },
    {
      key: 'doc_date',
      header: t('projectDetail.documents.column.date', 'Date'),
      size: 108, minSize: 108, maxSize: 108,
      colClassName: 'hidden lg:table-cell w-[108px]',
      cell: (d) =>
        d.doc_date ? (
          <span className="tabular whitespace-nowrap text-[13px] text-muted-foreground">{d.doc_date}</span>
        ) : (
          <span className="text-muted-foreground">{'—'}</span>
        ),
    },
    {
      key: 'status',
      header: t('projectDetail.documents.column.status', 'Status'),
      size: 112, minSize: 112, maxSize: 112,
      colClassName: 'w-[112px] min-w-[112px]',
      // A folder is never issued or approved, so it carries no issue status.
      cell: (d) => isMicrosoftFolder(d)
        ? <span className="text-muted-foreground">{'—'}</span>
        : <StatusPill variant={workflowVariant(d.status)}>{d.status}</StatusPill>,
    },
  ];
  const visibleColumns = hasAnyFile ? columns : columns.filter((column) => column.key !== 'file_path');

  /** The status actions available on a row, per the workflow + SoD + role gates. */
  const statusActions = (d: ProjectDocumentRow): RowMenuItem[] => {
    // A Microsoft folder is a reference only: it is never issued, approved or closed.
    if (isMicrosoftFolder(d)) return [];
    const items: RowMenuItem[] = [];
    // Draft → Issued (a non-approval move: any document write-role).
    if (d.status === 'Draft' && canWriteDocs) {
      items.push({ label: t('projectDetail.documents.action.issue', 'Issue'), onClick: () => setPending({ doc: d, to: 'Issued', verb: t('projectDetail.documents.verb.issue', 'Issue document') }) });
    }
    // Issued → Approved / Rejected (the SoD step: approver must NOT be the author).
    if (d.status === 'Issued' && canApprove) {
      if (isOwnDocument(d)) {
        // Author of their own document: the approve/reject path is hidden; expose the reason.
        items.push({ label: reviewUnavailableLabel, onClick: () => setSodBlocked(d) });
      } else {
        items.push({ label: t('projectDetail.documents.action.approve', 'Approve'), onClick: () => setPending({ doc: d, to: 'Approved', verb: t('projectDetail.documents.verb.approve', 'Approve document') }) });
        items.push({ label: t('projectDetail.documents.action.reject', 'Reject'), onClick: () => setPending({ doc: d, to: 'Rejected', verb: t('projectDetail.documents.verb.reject', 'Reject document') }), danger: true });
      }
    }
    // Approved → Closed (terminal close-out: any document write-role).
    if (d.status === 'Approved' && canWriteDocs) {
      items.push({ label: t('projectDetail.documents.action.close', 'Close'), onClick: () => setPending({ doc: d, to: 'Closed', verb: t('projectDetail.documents.verb.close', 'Close document') }) });
    }
    // Rejected → Draft (rework path) / Rejected → Closed (abandon path). AC-W3-B2.
    // These are non-approval moves (same gate as Draft→Issued / Approved→Closed: canWriteDocs).
    // The SoD approver≠author rule applies only to the Issued→Approved/Rejected step; not here.
    if (d.status === 'Rejected' && canWriteDocs) {
      items.push({ label: t('projectDetail.documents.action.reopen', 'Reopen for revision'), onClick: () => setPending({ doc: d, to: 'Draft', verb: t('projectDetail.documents.verb.reopen', 'Reopen for revision') }) });
      items.push({ label: t('projectDetail.documents.action.close', 'Close'), onClick: () => setPending({ doc: d, to: 'Closed', verb: t('projectDetail.documents.verb.close', 'Close document') }) });
    }
    return items;
  };

  const rowMenu = (d: ProjectDocumentRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
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
        items.push({ label: t('m365Documents.newRevisionFromLatest', 'Make new revision from latest file update'), onClick: () => void startLatestRevision(d) });
      }
    }
    items.push(...statusActions(d));
    if (canDelete) items.push({ label: t('projectDetail.documents.action.delete', 'Delete'), onClick: () => setDeleteTarget(d), danger: true });
    return items;
  };

  const anyRowWrite = canWriteDocs || canDelete || canApprove;

  const onTransitionConfirm = async () => {
    if (!pending) return;
    const { doc, to } = pending;
    try {
      await transition.mutateAsync({ id: doc.id, status: to });
      // ⚑ `to` is a raw DB status folded into an English sentence. The shell is
      // translatable; the status word itself still arrives in English (see handover).
      toast(
        `${t('projectDetail.documents.toast.transitioned', 'Document')} ${to.toLowerCase()}`,
        doc.title,
        'success',
      );
      setPending(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setPending(null);
    }
  };

  const onDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await remove.mutateAsync(target.id);
      toast(t('projectDetail.documents.toast.deleted', 'Document deleted'), target.title, 'success');
      setDeleteTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  const removeClientUploadError = (docId: string) => {
    setClientUploadErrors((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  };

  const clearAnyUploadError = (docId: string) => {
    removeClientUploadError(docId);
    clearUploadError(docId);
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeFileDoc) return;

    clearAnyUploadError(activeFileDoc.docId);
    const validation = validateFile(file);
    if (!validation.ok) {
      setClientUploadErrors((prev) => ({
        ...prev,
        [activeFileDoc.docId]:
          validation.message ??
          t('projectDetail.documents.fileValidationFailed', 'File validation failed'),
      }));
      if (fileInputRef.current) fileInputRef.current.value = '';
      setActiveFileDoc(null);
      return;
    }

    if (activeFileDoc.mode === 'upload') {
      upload.mutate({ docId: activeFileDoc.docId, file });
    } else {
      replace.mutate({ docId: activeFileDoc.docId, file });
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
    setActiveFileDoc(null);
  };

  const handleUploadClick = (docId: string) => {
    clearAnyUploadError(docId);
    setActiveFileDoc({ docId, mode: 'upload' });
    fileInputRef.current?.click();
  };

  const handleReplaceClick = (docId: string) => {
    clearAnyUploadError(docId);
    setActiveFileDoc({ docId, mode: 'replace' });
    fileInputRef.current?.click();
  };

  const handleDownload = async (doc: ProjectDocumentRow) => {
    if (!doc.file_path) return;
    try {
      const url = await repositories.document.getSignedUrl(doc.file_path, { download: true });
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_path.split('/').pop() || 'file';
      a.click();
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const handlePreview = async (doc: ProjectDocumentRow) => {
    if (!doc.file_path) return;
    try {
      const url = await repositories.document.getSignedUrl(doc.file_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  // Re-read the file's CURRENT identity from Microsoft before offering the revision form. Failure
  // never creates anything and never discloses a raw Microsoft body (generic reviewed copy only).
  const startLatestRevision = async (parent: ProjectDocumentRow) => {
    const current = projectReference(parent);
    if (!current || latestBusy || !documentLinkPermissions.projectCreate()) return;
    setLatestBusy(parent.id);
    try {
      const item = await getItem(current);
      if (item.item_kind !== 'file') throw new Error('not-a-file');
      setLatestRevision({
        parent,
        reference: { drive_id: item.drive_id, item_id: item.item_id, web_url: item.web_url, name: item.name, item_kind: 'file' },
      });
    } catch {
      toast(
        t('m365Documents.latestFailedTitle', 'Could not read the latest file'),
        t('m365Documents.latestFailed', 'Microsoft could not load this file. Check access and SharePoint availability with your Microsoft admin, or retry.'),
        'warning',
      );
    } finally {
      setLatestBusy(null);
    }
  };

  const onUnlinkConfirm = async () => {
    if (!unlinkTarget || !documentLinkPermissions.projectEdit(unlinkTarget.author_id, unlinkTarget.status)) return;
    const target = unlinkTarget;
    try {
      await unlink.mutateAsync(target.id);
      toast(t('m365Documents.unlinked', 'Reference removed'), target.title, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
    setUnlinkTarget(null);
  };

  const handleCreateRevision = (data: { title: string; code: string; category: string; revision: string; doc_date: string; microsoft?: MicrosoftReferenceInput }) => {
    const parent = latestRevision?.parent ?? revisionParent;
    if (!parent || (data.microsoft && !documentLinkPermissions.projectCreate())) return;
    createRevision.mutate(
      { parentId: parent.id, ...data },
      {
        onSuccess: () => {
          toast(
            t('projectDetail.documents.toast.revisionCreated', 'Revision created'),
            `${parent.title} ${t('projectDetail.documents.revLabel', 'Rev')} ${data.revision}`,
            'success',
          );
          setRevisionParent(null);
          setLatestRevision(null);
        },
        onError: (err) => {
          const { headline, detail } = classifyMutationError(err);
          toast(headline, detail, 'warning');
        },
      },
    );
  };

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold tracking-[-0.01em]">
            {t('projectDetail.documents.heading', 'Document register')}
          </h2>
        </div>
        {/* D13 (OD-W2-5 honest-affordance): the dead disabled "Attach file (coming soon)"
            button was removed — file upload is signposted by the register subtitle copy
            ("file attachments arrive with Storage"), not a fake disabled control. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {canCreate && (
            <Button variant="outline" size="sm" onClick={() => setFormTarget({ doc: null })}>
              <Icon name="plus" />
              {t('projectDetail.documents.addDocument', 'Add document')}
            </Button>
          )}
          {canCreateMicrosoftReference && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto min-h-0 px-0 py-0 text-xs text-primary-text underline-offset-4 hover:bg-transparent hover:underline"
              onClick={() => setMicrosoftEntry({ kind: 'create' })}
            >
              {t('m365Documents.link', 'Link from Microsoft 365')}
            </Button>
          )}
        </div>
      </div>

      {/* Below the header, so a folder notice never pushes the primary actions down or off-screen (empty for non-writers). */}
      <div className="mb-3.5 empty:hidden">
        <RecordFolderAction
          target={{ kind: 'project', id: projectId }}
          hasFolder={all.some((d) => d.source === 'onedrive' && d.ms_item_kind === 'folder')}
          onChooseExisting={() => { if (canCreateMicrosoftReference) setMicrosoftEntry({ kind: 'create' }); }}
        />
      </div>

      {microsoftEntry && (
        <MicrosoftEntry
          code={projectCode}
          onClose={() => setMicrosoftEntry(null)}
          onSelect={async (reference) => {
            if (microsoftEntry.kind === 'link') {
              if (!documentLinkPermissions.projectEdit(microsoftEntry.doc.author_id, microsoftEntry.doc.status)) return;
              // A failure propagates: the picker keeps the selection and shows its own persistent alert.
              await link.mutateAsync({ id: microsoftEntry.doc.id, reference });
              toast(t('m365Documents.linked', 'Microsoft item linked'), microsoftEntry.doc.title, 'success');
              setMicrosoftEntry(null);
            } else {
              if (!documentLinkPermissions.projectCreate()) return;
              // Close the picker FIRST, then open the ordinary form seeded with the reference.
              setMicrosoftEntry(null);
              setFormTarget({ doc: null, reference });
            }
          }}
        />
      )}

      {/* SoD block (approver = author): persistent inline reason for a hidden Approve/Reject. */}
      {sodBlocked && (
        <GateNotice variant="blocked" className="mb-3.5" data-testid="document-sod-gate">
          <div>
            {t('projectDetail.documents.sod.ownDocument', "You can't approve your own document")}{' '}
            (<b className="font-semibold">{sodBlocked.title}</b>).{' '}
            {t(
              'projectDetail.documents.sod.explanation',
              'Approving a document is a segregation-of-duties step, so a different reviewer must approve or reject it.',
            )}
            <div className="mt-2.5">
              <Button variant="ghost" size="sm" onClick={() => setSodBlocked(null)}>
                {t('projectDetail.documents.dismiss', 'Dismiss')}
              </Button>
            </div>
          </div>
        </GateNotice>
      )}

      {state !== 'loading' && all.length > 10 && (
        <Toolbar standalone>
          <SearchMini
            placeholder={t('projectDetail.documents.searchPlaceholder', 'Search documents…')}
            aria-label={t('projectDetail.documents.searchAriaLabel', 'Search documents')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        </Toolbar>
      )}

      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={5} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('projectDetail.documents.errorTitle', "Couldn't load documents")}
          sub={t(
            'projectDetail.documents.errorSub',
            'The request failed. Check your connection and try again.',
          )}
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="doc"
          title={t('projectDetail.documents.emptyTitle', 'No documents yet')}
          sub={t(
            'projectDetail.documents.emptySub',
            "Add a drawing, specification, or transmittal to start the project's document register.",
          )}
        />
      )}

      {state === undefined && (
        <DataTable<ProjectDocumentRow>
          rows={filtered}
          columns={visibleColumns}
          rowKey={(d) => d.id}
          onActivate={(d) => setDrawerDoc(d)}
          rowMenu={anyRowWrite ? rowMenu : undefined}
          selectedKey={drawerDoc?.id}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle={t('projectDetail.documents.noSearchMatch', 'No documents match your search')}
          emptySub={t(
            'projectDetail.documents.noSearchMatchSub',
            'Try a different title, code, or category.',
          )}
          className="!overflow-visible !rounded-none !border-0 !bg-transparent"
        tableId="project-detail-tabs-documentstab-table" />
      )}

      {/* D12: read-first quick-view drawer with the status workflow promoted out
          of the ⋯ menu (the in-hand row — no extra fetch). The status section and
          footer reuse the EXISTING statusActions gating + setPending/setFormTarget/
          setDeleteTarget setters; SoD + confirm flow are unchanged. */}
      {drawerDoc && (
        <DocumentDrawer
          doc={drawerDoc}
          parentDoc={drawerDoc.parent_document_id ? (documentsById.get(drawerDoc.parent_document_id) ?? null) : null}
          childDoc={childDocumentsByParentId.get(drawerDoc.id) ?? null}
          // The transitions, already role- + SoD-gated by statusActions(d).
          transitions={statusActions(drawerDoc).filter((a) => a.label !== reviewUnavailableLabel)}
          // SoD: author of their own Issued doc → no Approve/Reject; show the reason inline.
          sodBlocked={drawerDoc.status === 'Issued' && canApprove && isOwnDocument(drawerDoc)}
          canEdit={canEditDoc(drawerDoc) && drawerDoc.status !== 'Closed' && drawerDoc.status !== 'Superseded'}
          canDelete={canDelete}
          // A status transition opens the ConfirmDialog on top of the drawer; make
          // the panel inert so the confirm owns focus + AT (no two live traps).
          nestedOpen={!!pending}
          onClose={() => setDrawerDoc(null)}
          onEdit={() => {
            // Close the drawer first, THEN open the form modal — never two focus-traps.
            const d = drawerDoc;
            setDrawerDoc(null);
            setFormTarget({ doc: d });
          }}
          onDelete={() => {
            const d = drawerDoc;
            setDrawerDoc(null);
            setDeleteTarget(d);
          }}
          onViewDocument={setDrawerDoc}
          onDownload={handleDownload}
          microsoftFile={microsoftCell(drawerDoc)}
        />
      )}

      {/* Create / edit metadata modal */}
      {formTarget && (
        <DocumentFormModal
          doc={formTarget.doc}
          reference={formTarget.reference}
          readOnly={!!formTarget.reference && !canCreateMicrosoftReference}
          onChangeReference={canCreateMicrosoftReference ? () => { setFormTarget(null); setMicrosoftEntry({ kind: 'create' }); } : undefined}
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            if (formTarget.reference && !documentLinkPermissions.projectCreate()) {
              throw Object.assign(new Error('View-only session'), { code: '42501' });
            }
            // One INSERT carries the reference (no empty intermediate row).
            await create.mutateAsync(formTarget.reference ? { ...input, source: 'onedrive', microsoft: formTarget.reference } : input);
            toast(t('projectDetail.documents.toast.added', 'Document added'), input.title, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast(t('projectDetail.documents.toast.updated', 'Document updated'), input.title, 'success');
            setFormTarget(null);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_INPUT_ACCEPT}
        aria-label={t('projectDetail.documents.uploadAriaLabel', 'Upload a document')}
        className="hidden"
        onChange={handleFileSelected}
        data-testid="file-input"
      />

      {(latestRevision ?? (revisionParent ? { parent: revisionParent, reference: null } : null)) && (
        <NewRevisionModal
          parent={(latestRevision?.parent ?? revisionParent) as ProjectDocumentRow}
          microsoft={latestRevision?.reference ?? null}
          readOnly={!!latestRevision && !canCreateMicrosoftReference}
          onSubmit={handleCreateRevision}
          onClose={() => { setRevisionParent(null); setLatestRevision(null); }}
          loading={createRevision.isPending}
        />
      )}

      {/* Unlink confirm: removes only PMO's reference, never anything in Microsoft. */}
      {unlinkTarget && (
        <ConfirmDialog
          open
          tone="default"
          title={t('m365Documents.unlinkTitle', 'Unlink {{title}}?', { title: unlinkTarget.title })}
          description={t('m365Documents.unlinkBody', 'Only the PMO reference is removed. The Microsoft item is unchanged.')}
          confirmLabel={t('m365Documents.unlinkConfirm', 'Unlink')}
          loading={unlink.isPending}
          onConfirm={onUnlinkConfirm}
          onCancel={() => setUnlinkTarget(null)}
        />
      )}

      {/* Status transition confirm (default tone; Reject reads as destructive). */}
      <ConfirmDialog
        open={!!pending}
        tone={pending?.to === 'Rejected' ? 'destructive' : 'default'}
        title={
          pending
            ? `${transitionActionLabel(pending.to, t)} ${pending.doc.title}?`
            : t('projectDetail.documents.transitionConfirm.titleFallback', 'Update status?')
        }
        description={
          pending?.to === 'Approved'
            ? t(
                'projectDetail.documents.transitionConfirm.approved',
                'Approving records you as the reviewer. This is a segregation-of-duties step and is recorded.',
              )
            : pending?.to === 'Rejected'
              ? t(
                  'projectDetail.documents.transitionConfirm.rejected',
                  'Rejecting returns the document for revision. This is recorded.',
                )
              : pending?.to === 'Issued'
                ? t(
                    'projectDetail.documents.transitionConfirm.issued',
                    'Issuing moves the document into review so a reviewer can approve or reject it.',
                  )
                : t(
                    'projectDetail.documents.transitionConfirm.closed',
                    'Closing finalises the document. This is a terminal status.',
                  )
        }
        confirmLabel={
          pending?.verb ?? t('projectDetail.documents.transitionConfirm.confirmFallback', 'Update status')
        }
        loading={transition.isPending}
        onConfirm={onTransitionConfirm}
        onCancel={() => setPending(null)}
      />

      {/* Delete confirm (destructive tone; Admin only). */}
      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={
          deleteTarget
            ? `${t('projectDetail.documents.action.delete', 'Delete')} ${deleteTarget.title}?`
            : t('projectDetail.documents.deleteConfirm.titleFallback', 'Delete document?')
        }
        description={t(
          'projectDetail.documents.deleteConfirm.body',
          "This permanently removes the document register entry. This can't be undone.",
        )}
        confirmLabel={t('projectDetail.documents.deleteConfirm.confirm', 'Delete document')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

// ── D12: read-first quick-view drawer + inline status workflow ────────────────

interface LineageButtonProps {
  revision: string;
  title: string;
  direction: 'back' | 'forward';
  onClick: () => void;
}

const LineageButton: React.FC<LineageButtonProps> = ({ revision, title, direction, onClick }) => {
  const { t } = useTranslation();
  return (
  <button
    type="button"
    className="w-fit text-[11px] text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    aria-label={`${t('projectDetail.documents.viewRevision', 'View revision')} ${revision} ${t(
      'projectDetail.documents.ofWord',
      'of',
    )} ${title}`}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
  >
    {direction === 'back' ? '←' : '→'}{' '}
    {`${t('projectDetail.documents.revLabel', 'Rev')} ${revision}`}
  </button>
  );
};

const DocumentTitleCell: React.FC<{
  doc: ProjectDocumentRow;
  parentDoc: ProjectDocumentRow | null;
  childDoc: ProjectDocumentRow | null;
  onViewDocument: (doc: ProjectDocumentRow) => void;
}> = ({ doc, parentDoc, childDoc, onViewDocument }) => {
  const { t } = useTranslation();
  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-label={`${t('projectDetail.documents.viewDocument', 'View')} ${doc.title}`}
        onClick={() => onViewDocument(doc)}
        className="block w-full rounded-sm text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="block whitespace-normal break-words font-semibold" title={doc.title}>
          {doc.title}
        </span>
        {doc.revision && (
          <span className="text-[12px] text-muted-foreground">
            {`${t('projectDetail.documents.revLabel', 'Rev')} ${doc.revision}`}
          </span>
        )}
      </button>
      {parentDoc?.revision && (
        <div className="mt-1">
          <LineageButton
            revision={parentDoc.revision}
            title={doc.title}
            direction="back"
            onClick={() => onViewDocument(parentDoc)}
          />
        </div>
      )}
      {childDoc?.revision && (
        <div className="mt-1 flex flex-col gap-1">
          <LineageButton
            revision={childDoc.revision}
            title={doc.title}
            direction="forward"
            onClick={() => onViewDocument(childDoc)}
          />
          {doc.status === 'Superseded' && (
            <span className="text-[11px] text-muted-foreground">
              {`${t(
                'projectDetail.documents.supersededNotice',
                'Read-only — continue on Rev',
              )} ${childDoc.revision}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

interface DocumentDrawerProps {
  /** The in-hand ProjectDocumentRow (no extra fetch). */
  doc: ProjectDocumentRow;
  parentDoc: ProjectDocumentRow | null;
  childDoc: ProjectDocumentRow | null;
  /** Available transitions from statusActions(d) (the "Why…?" item filtered out). */
  transitions: RowMenuItem[];
  /** Author of their own Issued doc → no Approve/Reject; show the reason inline. */
  sodBlocked: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** A nested ConfirmDialog (status transition) is up → inert the panel. */
  nestedOpen: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onViewDocument: (doc: ProjectDocumentRow) => void;
  onDownload: (doc: ProjectDocumentRow) => Promise<void>;
  /** The shared Microsoft reference cell for this row (same projection as the table), or null. */
  microsoftFile: React.ReactNode;
}

/** Definition-list row — label (overline voice) + value. */
const DocField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-1">
    <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      {label}
    </dt>
    <dd className="text-[14px] text-foreground">{children}</dd>
  </div>
);

const DocumentDrawer: React.FC<DocumentDrawerProps> = ({
  doc,
  parentDoc,
  childDoc,
  transitions,
  sodBlocked,
  canEdit,
  canDelete,
  nestedOpen,
  onClose,
  onEdit,
  onDelete,
  onViewDocument,
  onDownload,
  microsoftFile,
}) => {
  const { t } = useTranslation();
  const hasFooter = canEdit || canDelete;
  const isFolder = isMicrosoftFolder(doc);
  // The primary transition (Issue / Approve) reads as One-Blue; Reject reads as
  // destructive (danger flag from statusActions); the rest are quiet outlines.
  // ⚑ Compared through the SAME keys statusActions builds the labels from -- RowMenuItem
  // carries no id, so the label IS the identity. Translate one side only and this breaks.
  const isPrimary = (label: string) =>
    label === t('projectDetail.documents.action.issue', 'Issue') ||
    label === t('projectDetail.documents.action.approve', 'Approve');

  return (
    <Drawer
      open
      title={doc.title}
      subtitle={isFolder ? undefined : <StatusPill variant={workflowVariant(doc.status)}>{doc.status}</StatusPill>}
      nestedOpen={nestedOpen}
      onClose={onClose}
      footer={
        hasFooter ? (
          <>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                {t('projectDetail.documents.action.edit', 'Edit')}
              </Button>
            )}
            {canDelete && (
              <Button variant="destructive" size="sm" className="ml-auto" onClick={onDelete}>
                {t('projectDetail.documents.action.delete', 'Delete')}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <dl className="flex flex-col gap-4">
        {!isFolder && doc.revision && (
          <DocField label={t('projectDetail.documents.field.revision', 'Revision')}>
            {`${t('projectDetail.documents.revLabel', 'Rev')} ${doc.revision}`}
          </DocField>
        )}
        {!isFolder && (
          <>
            <DocField label={t('projectDetail.documents.field.code', 'Code')}>
              {doc.code ? (
                <span className="font-mono text-[13px]">{doc.code}</span>
              ) : (
                <span className="text-muted-foreground">{'—'}</span>
              )}
            </DocField>
            <DocField label={t('projectDetail.documents.field.category', 'Category')}>{doc.category}</DocField>
            <DocField label={t('projectDetail.documents.field.docDate', 'Document date')}>
              {doc.doc_date ? (
                <span className="tabular">{doc.doc_date}</span>
              ) : (
                <span className="text-muted-foreground">{'—'}</span>
              )}
            </DocField>
          </>
        )}
        {parentDoc?.revision && (
          <DocField label={t('projectDetail.documents.field.lineage', 'Revision lineage')}>
            <LineageButton
              revision={parentDoc.revision}
              title={doc.title}
              direction="back"
              onClick={() => onViewDocument(parentDoc)}
            />
          </DocField>
        )}
        {doc.status === 'Superseded' && childDoc?.revision && (
          <DocField label={t('projectDetail.documents.field.supersededBy', 'Superseded by')}>
            <LineageButton
              revision={childDoc.revision}
              title={doc.title}
              direction="forward"
              onClick={() => onViewDocument(childDoc)}
            />
          </DocField>
        )}
        {microsoftFile ? (
          <DocField label={t('projectDetail.documents.field.file', 'File')}>
            {microsoftFile}
          </DocField>
        ) : doc.file_path && (
          <DocField label={t('projectDetail.documents.field.file', 'File')}>
            <button
              type="button"
              onClick={() => void onDownload(doc)}
              className="touch-target inline-flex rounded-sm text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label={`${t('projectDetail.documents.download', 'Download')} ${
                doc.file_path.split('/').pop() || 'file'
              }`}
            >
              {doc.file_path.split('/').pop()}
            </button>
          </DocField>
        )}
        {!isFolder && (
          <DocField label={t('projectDetail.documents.field.status', 'Status')}>
            <StatusPill variant={workflowVariant(doc.status)}>{doc.status}</StatusPill>
          </DocField>
        )}
      </dl>

      {/* Status workflow — promoted out of the ⋯ menu. Buttons reuse the EXACT
          statusActions gating; consequential moves still route through the
          ConfirmDialog (the onClick set on each item). */}
      {(transitions.length > 0 || sodBlocked) && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {t('projectDetail.documents.updateStatus', 'Update status')}
          </h3>
          {sodBlocked ? (
            // SoD preserved: author can't approve/reject their own Issued doc.
            // Honest-disabled done right — the reason is shown, not a dead button.
            <GateNotice variant="blocked" data-testid="drawer-sod-gate">
              <div>
                {t(
                  'projectDetail.documents.sod.drawerNotice',
                  "You can't approve your own document. Approving is a segregation-of-duties step, so a different reviewer must approve or reject it.",
                )}
              </div>
            </GateNotice>
          ) : (
            <div className="flex flex-wrap gap-2">
              {transitions.map((t) => (
                <Button
                  key={t.label}
                  size="sm"
                  variant={t.danger ? 'destructive' : isPrimary(t.label) ? 'primary' : 'outline'}
                  onClick={t.onClick}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
};

// ── Create / edit metadata form modal ────────────────────────────────────────

/** A file's title starts from its name without the extension; a folder keeps its whole name. Still editable. */
const seedTitle = (reference: MicrosoftReferenceInput): string =>
  reference.item_kind === 'folder' ? reference.name : reference.name.replace(/\.[A-Za-z0-9]{1,5}$/, '');

interface DocumentFormModalProps {
  doc: ProjectDocumentRow | null;
  /** A Microsoft reference chosen first; the title is seeded from its name but stays editable. */
  reference?: MicrosoftReferenceInput;
  /** Reopens the Microsoft picker so the chosen item can be swapped before saving. */
  onChangeReference?: () => void;
  readOnly?: boolean;
  onClose: () => void;
  onCreate: (input: ProjectDocumentInput) => Promise<void>;
  onUpdate: (id: string, input: ProjectDocumentInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const DocumentFormModal: React.FC<DocumentFormModalProps> = ({
  doc,
  reference,
  onChangeReference,
  readOnly = false,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const { t } = useTranslation();
  const { t: tf } = useTranslation('recordFolders');
  const isEdit = !!doc;
  // A folder is a reference, not a register document: it has no category, revision, code or date.
  const isFolder = reference ? reference.item_kind === 'folder' : !!doc && isMicrosoftFolder(doc);
  // Memoised on `t` so the validator identity is stable between renders.
  const validateWithT = useCallback((v: FormValues) => validate(v, t, isFolder), [t, isFolder]);
  const form = useEntityForm<FormValues>({
    initialValues: {
      title: doc?.title ?? (reference ? seedTitle(reference) : ''),
      code: doc?.code ?? '',
      category: doc?.category ?? (isFolder ? 'Reference' : 'Drawing'),
      revision: doc?.revision ?? '',
      doc_date: doc?.doc_date ?? '',
    },
    validate: validateWithT,
    idPrefix: 'document-form',
    module: 'projects',
    // F8 (AC-IXD-FORM-F8): submit stays disabled until the required title + category
    // are present (category defaults to a value, so the title is the live gate).
    requiredFields: isFolder ? ['title'] : ['title', 'category'],
  });

  const titleField = form.fieldProps('title');
  const codeField = form.fieldProps('code');
  const categoryField = form.fieldProps('category');
  const revisionField = form.fieldProps('revision');
  const dateField = form.fieldProps('doc_date');

  const errorSummary = [
    form.errors.title ? { fieldId: titleField.id, message: form.errors.title } : null,
    form.errors.category ? { fieldId: categoryField.id, message: form.errors.category } : null,
  ].filter(Boolean) as { fieldId: string; message: string }[];

  // #559 / AC-ERR-001: a rejected save must leave PERSISTENT evidence in the dialog. The toast
  // auto-dismisses after 4s, ~700px from where the user is looking, after which the modal is
  // indistinguishable from a pristine form with data in it — so the save looks like it worked.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: ProjectDocumentInput = {
        title: values.title.trim(),
        code: values.code.trim(),
        category: values.category,
        revision: values.revision.trim(),
        doc_date: values.doc_date,
      };
      try {
        if (isEdit && doc) await onUpdate(doc.id, input);
        else await onCreate(input);
      } catch (err) {
        // `suppressCapture` only: the page's own `onError` classifies this same rejection for the
        // toast and owns the single `save_failed` event (ADR-0067).
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={
        isEdit
          ? t('projectDetail.documents.form.editTitle', 'Edit document')
          : t('projectDetail.documents.addDocument', 'Add document')
      }
      subtitle={
        isEdit
          ? t('projectDetail.documents.form.editSubtitle', 'Update this register entry')
          : reference
            ? isFolder
              ? tf('folderFiles.linkedFolderSubtitle', 'Link this folder to the project. Its files stay in Microsoft 365.')
              : t('m365Documents.docsTab.linkedSubtitle', 'Record a drawing, specification, or transmittal. Its file stays in Microsoft 365.')
            : t(
                'projectDetail.documents.form.newSubtitle',
                'Record a drawing, specification, or transmittal. Upload a file once the Draft row is created.',
              )
      }
      submitLabel={
        isEdit
          ? t('projectDetail.documents.form.save', 'Save document')
          : t('projectDetail.documents.addDocument', 'Add document')
      }
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty || !!reference}
      submitDisabled={readOnly || !form.isComplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      {reference && (
        <div data-testid="document-linked-item" className="mb-3 flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px]">
          <Icon name={reference.item_kind === 'folder' ? 'folder' : 'doc'} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 break-words font-medium text-foreground" title={reference.name}>{reference.name}</span>
          {onChangeReference && (
            <Button type="button" variant="ghost" size="sm" onClick={onChangeReference}>
              {t('m365Documents.docsTab.change', 'Change')}
            </Button>
          )}
        </div>
      )}
      <FormSection legend={t('projectDetail.documents.form.legend', 'Document')}>
        <FormGrid>
          <TextField
            id={titleField.id}
            label={t('projectDetail.documents.form.title', 'Title')}
            required
            value={titleField.value}
            onChange={titleField.onChange}
            onBlur={titleField.onBlur}
            error={titleField.error}
            placeholder={t('projectDetail.documents.form.titlePlaceholder', 'e.g. Foundation general arrangement')}
            fullWidth
          />
          {!isFolder && (
            <>
            <TextField
              id={codeField.id}
              label={t('projectDetail.documents.form.code', 'Code')}
              mono
              value={codeField.value}
              onChange={codeField.onChange}
              onBlur={codeField.onBlur}
              placeholder={t('projectDetail.documents.form.codePlaceholder', 'e.g. DWG-001')}
              helper={t(
                'projectDetail.documents.form.codeHelper',
                'Optional document number or drawing code.',
              )}
            />
            <SelectField
              id={categoryField.id}
              label={t('projectDetail.documents.form.category', 'Category')}
              required
              value={categoryField.value}
              onChange={categoryField.onChange}
              onBlur={categoryField.onBlur}
              error={categoryField.error}
              options={CATEGORY_OPTIONS}
            />
            <TextField
              id={revisionField.id}
              label={t('projectDetail.documents.form.revision', 'Revision')}
              value={revisionField.value}
              onChange={revisionField.onChange}
              onBlur={revisionField.onBlur}
              placeholder={t('projectDetail.documents.form.revisionPlaceholder', 'e.g. A')}
            />
            <TextField
              id={dateField.id}
              label={t('projectDetail.documents.form.docDate', 'Document date')}
              type="date"
              value={dateField.value}
              onChange={dateField.onChange}
              onBlur={dateField.onBlur}
            />
            </>
          )}
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

// ── Microsoft 365 entry: connection gate + picker ────────────────────────────

interface MicrosoftEntryProps {
  code: string | null;
  onClose: () => void;
  onSelect: (reference: MicrosoftReferenceInput) => Promise<void>;
}

/**
 * The caller's connection decides ONLY whether browsing is offered. Mounted on demand, so the
 * status read happens for a mutation browse entry and never for committed rows: those render and
 * open with no connection at all. Pending/error never guess "active"; every non-active state is a
 * secondary notice (setup link, reconnect, retry) and no picker request is made.
 */
const MicrosoftEntry: React.FC<MicrosoftEntryProps> = ({ code, onClose, onSelect }) => {
  const { t } = useTranslation();
  const { connection, isPending, refetch } = useMicrosoftDocuments();
  const canBrowse = connection?.connected === true && connection.status === 'active';

  if (canBrowse) {
    return <MicrosoftDocumentPicker open context={{ kind: 'project', code }} onClose={onClose} onSelect={onSelect} />;
  }

  let notice: React.ReactNode;
  if (!connection && isPending) {
    notice = (
      <p role="status" className="text-[13px] text-muted-foreground">
        {t('m365Documents.checkingConnection', 'Checking your Microsoft 365 connection…')}
      </p>
    );
  } else if (!connection) {
    // Unknown (status read failed): never assume active; offer an explicit retry next to the action.
    notice = <M365BrowseNotice code="external-unreachable" onRetry={() => void refetch()} />;
  } else if (!connection.connected) {
    // The personal connection page (/integrations) is open to every role; the Admin area is not.
    notice = (
      <div className="min-w-0 space-y-2">
        <GateNotice variant="blocked">
          {t('m365Documents.docsTab.notConnected', 'Connect Microsoft 365 first to browse documents.')}
        </GateNotice>
        <Link
          to="/integrations"
          className="touch-target inline-flex h-8 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent"
        >
          {t('m365Documents.docsTab.myIntegrations', 'My integrations')}
        </Link>
      </div>
    );
  } else {
    notice = <M365BrowseNotice connection={connection} code={connection.status === 'revoked' ? 'CONNECTION_REVOKED' : 'CONNECTION_STALE'} />;
  }

  return (
    <div className="mb-3.5 space-y-2" data-testid="m365-connection-gate">
      {notice}
      <Button variant="ghost" size="sm" onClick={onClose}>
        {t('projectDetail.documents.dismiss', 'Dismiss')}
      </Button>
    </div>
  );
};

export default DocumentsTab;
