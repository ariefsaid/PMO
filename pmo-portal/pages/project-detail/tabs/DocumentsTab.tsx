import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { FileCell } from '@/src/components/FileCell';
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
}

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

const validate = (v: FormValues, t: TFunction): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.title.trim())
    errors.title = t('projectDetail.documents.form.errors.titleRequired', 'Title is required.');
  if (!v.category.trim())
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

const DocumentsTab: React.FC<DocumentsTabProps> = ({ projectId }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useDocuments(projectId);
  const { create, update, transition, remove } = useDocumentMutations(projectId);
  const { upload, replace, progress, uploadErrors, cancelUpload, clearUploadError } = useFileUpload(projectId);
  const { createRevision } = useRevision(projectId);

  const [search, setSearch] = useState('');

  // Modal: null = closed; { doc: null } = create; { doc } = edit.
  const [formTarget, setFormTarget] = useState<{ doc: ProjectDocumentRow | null } | null>(null);
  const [pending, setPending] = useState<PendingTransition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectDocumentRow | null>(null);
  // The author who tried to act on their own Issued document (SoD block) — drives the
  // inline GateNotice that explains why Approve/Reject is unavailable.
  const [sodBlocked, setSodBlocked] = useState<ProjectDocumentRow | null>(null);
  // D12: the document shown in the read-first quick-view Drawer (the in-hand row;
  // no extra fetch). Row activation opens it; the status section + footer reuse
  // the existing statusActions gating + setPending/setFormTarget/setDeleteTarget.
  const [drawerDoc, setDrawerDoc] = useState<ProjectDocumentRow | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeFileDoc, setActiveFileDoc] = useState<{ docId: string; mode: 'upload' | 'replace' } | null>(null);
  const [clientUploadErrors, setClientUploadErrors] = useState<Record<string, string>>({});
  const [revisionParent, setRevisionParent] = useState<ProjectDocumentRow | null>(null);

  const currentUserId = currentUser?.id ?? null;
  const canCreate = may('create', 'document');
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
      colClassName: 'hidden md:table-cell w-[112px]',
      cell: (d) => (
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
      colClassName: 'hidden md:table-cell w-[112px]',
      cell: (d) => <span className="text-[13px] text-muted-foreground">{d.category}</span>,
    },
    {
      key: 'doc_date',
      header: t('projectDetail.documents.column.date', 'Date'),
      colClassName: 'hidden lg:table-cell w-[108px]',
      cell: (d) =>
        d.doc_date ? (
          <span className="tabular text-[13px] text-muted-foreground">{d.doc_date}</span>
        ) : (
          <span className="text-muted-foreground">{'—'}</span>
        ),
    },
    {
      key: 'status',
      header: t('projectDetail.documents.column.status', 'Status'),
      colClassName: 'w-[112px] min-w-[112px]',
      cell: (d) => <StatusPill variant={workflowVariant(d.status)}>{d.status}</StatusPill>,
    },
    {
      key: 'revision_action',
      header: '',
      align: 'center',
      colClassName: 'w-[96px]',
      cell: (d) =>
        (d.status === 'Issued' || d.status === 'Approved') && canWriteDocs ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRevisionParent(d)}
            aria-label={`${t(
              'projectDetail.documents.newRevisionFor',
              'Create new revision for',
            )} ${d.title}`}
          >
            {t('projectDetail.documents.newRevision', 'New revision')}
          </Button>
        ) : null,
    },
  ];

  /** The status actions available on a row, per the workflow + SoD + role gates. */
  const statusActions = (d: ProjectDocumentRow): RowMenuItem[] => {
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

  const handleCreateRevision = (data: { title: string; code: string; category: string; revision: string; doc_date: string }) => {
    if (!revisionParent) return;
    createRevision.mutate(
      { parentId: revisionParent.id, ...data },
      {
        onSuccess: () => {
          toast(
            t('projectDetail.documents.toast.revisionCreated', 'Revision created'),
            `${revisionParent.title} ${t('projectDetail.documents.revLabel', 'Rev')} ${data.revision}`,
            'success',
          );
          setRevisionParent(null);
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
          <p className="mt-0.5 max-w-[64ch] text-[13px] text-muted-foreground">
            {t(
              'projectDetail.documents.subheading',
              'Drawings, specifications, and transmittals for this project. Upload files on Draft rows.',
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* D13 (OD-W2-5 honest-affordance): the dead disabled "Attach file (coming soon)"
              button was removed — file upload is signposted by the register subtitle copy
              ("file attachments arrive with Storage"), not a fake disabled control. */}
          {canCreate && (
            <Button variant="outline" size="sm" onClick={() => setFormTarget({ doc: null })}>
              <Icon name="plus" />
              {t('projectDetail.documents.addDocument', 'Add document')}
            </Button>
          )}
        </div>
      </div>

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

      {state !== 'loading' && all.length > 0 && (
        <Toolbar standalone>
          {/* Left-aligned count anchors the toolbar (matches the Admin Users pattern,
              polish #6) so the bar no longer reads as dead space beside the search. */}
          {/* ⛔ NOT TRANSLATED — English plural selection is welded in and DD-I18N-1's
              `Intl.PluralRules` helper does not exist yet. See the note in ProjectGantt. */}
          <span data-testid="documents-count" className="text-[13px] font-semibold tabular">
            {all.length} {all.length === 1 ? 'document' : 'documents'}
          </span>
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
          action={
            canCreate
              ? {
                  label: t('projectDetail.documents.addDocument', 'Add document'),
                  onClick: () => setFormTarget({ doc: null }),
                }
              : undefined
          }
        />
      )}

      {state === undefined && (
        <DataTable<ProjectDocumentRow>
          rows={filtered}
          columns={columns}
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
        />
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
        />
      )}

      {/* Create / edit metadata modal */}
      {formTarget && (
        <DocumentFormModal
          doc={formTarget.doc}
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
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

      {revisionParent && (
        <NewRevisionModal
          parent={revisionParent}
          onSubmit={handleCreateRevision}
          onClose={() => setRevisionParent(null)}
          loading={createRevision.isPending}
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
        <span className="block truncate font-semibold" title={doc.title}>
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
}) => {
  const { t } = useTranslation();
  const hasFooter = canEdit || canDelete;
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
      subtitle={<StatusPill variant={workflowVariant(doc.status)}>{doc.status}</StatusPill>}
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
        {doc.revision && (
          <DocField label={t('projectDetail.documents.field.revision', 'Revision')}>
            {`${t('projectDetail.documents.revLabel', 'Rev')} ${doc.revision}`}
          </DocField>
        )}
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
        {doc.file_path && (
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
        <DocField label={t('projectDetail.documents.field.status', 'Status')}>
          <StatusPill variant={workflowVariant(doc.status)}>{doc.status}</StatusPill>
        </DocField>
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

interface DocumentFormModalProps {
  doc: ProjectDocumentRow | null;
  onClose: () => void;
  onCreate: (input: ProjectDocumentInput) => Promise<void>;
  onUpdate: (id: string, input: ProjectDocumentInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const DocumentFormModal: React.FC<DocumentFormModalProps> = ({
  doc,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const { t } = useTranslation();
  const isEdit = !!doc;
  // Memoised on `t` so the validator identity is stable between renders.
  const validateWithT = useCallback((v: FormValues) => validate(v, t), [t]);
  const form = useEntityForm<FormValues>({
    initialValues: {
      title: doc?.title ?? '',
      code: doc?.code ?? '',
      category: doc?.category ?? 'Drawing',
      revision: doc?.revision ?? '',
      doc_date: doc?.doc_date ?? '',
    },
    validate: validateWithT,
    idPrefix: 'document-form',
    module: 'projects',
    // F8 (AC-IXD-FORM-F8): submit stays disabled until the required title + category
    // are present (category defaults to a value, so the title is the live gate).
    requiredFields: ['title', 'category'],
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
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
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
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default DocumentsTab;
