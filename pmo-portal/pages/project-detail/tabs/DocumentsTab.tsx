import { isMicrosoftFolder } from './documentUtils';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useDocumentWorkflow } from './useDocumentWorkflow';
import { useDocumentFiles } from './useDocumentFiles';
import { useDocumentMicrosoft } from './useDocumentMicrosoft';
import { DocumentDrawer } from './DocumentDrawer';
import {
  ListState,
  DataTable,
  GateNotice,
  Button,
  useToast,
  type DataTableSelection,
  type SortState,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useDocuments, useDocumentMutations } from '@/src/hooks/useDocuments';
import { useDocumentVerification } from '@/src/hooks/useDocumentVerification';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { useRevision } from '@/src/hooks/useRevision';
import { RecordFolderAction } from '@/src/components/m365/RecordFolderAction';
import { MicrosoftEntry } from './ProjectDocumentMicrosoft';
import { LinkedDocumentCell } from '@/src/components/m365/LinkedDocumentCell';
import { projectOwner } from '@/src/lib/m365/reference';
import { useDocumentLinkPermissions } from '@/src/components/m365/DocumentLinkPermissions';
import { projectReference, validMicrosoftBrowserUrl, type MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type {
  ProjectDocumentRow,
  DocStatus,
} from '@/src/lib/db/documents';
import { toCsv } from '@/src/lib/export/toCsv';
import { createDocumentRegisterCells } from './documentRegisterCells';
import { buildDocumentRegisterColumns } from './documentRegisterColumns';
import { buildDocumentRowMenu } from './documentRowMenu';
import DocumentsToolbar from './DocumentsToolbar';
import DocumentsBulkBar from './DocumentsBulkBar';
import DocumentsDialogs, { transitionActionLabel } from './DocumentsDialogs';

interface DocumentsTabProps {
  projectId: string;
  /** Reports the register row count (null while unavailable) so the parent chrome can badge it. */
  onCountChange?: (count: number | null) => void;
  /** The PROJECT's code (loaded by the parent), used to suggest convention folders in the picker. */
  projectCode?: string | null;
}

/**
 * Per-project DOCUMENT REGISTER with repository-backed metadata, local-file actions, and
 * Microsoft 365 references. List, filter, group, bulk actions and preview share one surface.
 *
 * Status workflow: Draft → Issued → Approved / Rejected → Closed. The Approve/Reject step is
 * SoD-gated (approver ≠ author): the document's author can never approve their own document.
 * Gating reads the REAL JWT role + the current user id; RLS is the enforcement authority.
 *
 * The focused pieces live beside this file: documentRegisterCells, documentRegisterColumns,
 * documentRowMenu, DocumentsToolbar, DocumentsBulkBar and DocumentsDialogs.
 */

// Status pills use the single workflow variant registry. Labels carry the exact state identity.

const DocumentsTab: React.FC<DocumentsTabProps> = ({ projectId, projectCode = null, onCountChange }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation('project');
  const may = usePermission();
  const documentLinkPermissions = useDocumentLinkPermissions();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useDocuments(projectId);
  useEffect(() => {
    onCountChange?.(isPending || isError || data == null ? null : data.length);
  }, [data, isError, isPending, onCountChange]);
  const { data: orgProfiles } = useAssignableProfiles();
  const { create, update, transition, remove, link, unlink } = useDocumentMutations(projectId);
  const { createRevision } = useRevision(projectId);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<DocStatus | ''>('');
  const [sourceFilter, setSourceFilter] = useState<'upload' | 'onedrive' | ''>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [sort, setSort] = useState<SortState>({ key: 'title', dir: 'asc' });
  const [bulkStatus, setBulkStatus] = useState<DocStatus | ''>('');
  const [pendingBulkStatus, setPendingBulkStatus] = useState<DocStatus | null>(null);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkFailure, setBulkFailure] = useState<{ succeeded: number; failures: Array<{ id: string; title: string; headline: string; detail: string }> } | null>(null);

  // Modal: null = closed; { doc: null } = create; { doc } = edit.
  const [formTarget, setFormTarget] = useState<{ doc: ProjectDocumentRow | null; reference?: MicrosoftReferenceInput } | null>(null);
  const { microsoftEntry, setMicrosoftEntry, unlinkTarget, setUnlinkTarget, latestRevision,
    setLatestRevision, startLatestRevision, onUnlinkConfirm, onSelectReference } = useDocumentMicrosoft(
    documentLinkPermissions, link, unlink, (reference) => setFormTarget({ doc: null, reference }),
  );
  const [deleteTarget, setDeleteTarget] = useState<ProjectDocumentRow | null>(null);
  const [deleteError, setDeleteError] = useState<{ headline: string; detail: string } | null>(null);
  // The selected document lives in URL state so copied register links reopen the same preview.
  const drawerId = searchParams.get('open');
  const setDrawerDoc = useCallback((doc: ProjectDocumentRow | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (doc) next.set('open', doc.id);
      else next.delete('open');
      return next;
    }, { replace: doc === null });
  }, [setSearchParams]);
  const [revisionParent, setRevisionParent] = useState<ProjectDocumentRow | null>(null);
  const [revisionError, setRevisionError] = useState<{ headline: string; detail: string } | null>(null);

  const currentUserId = currentUser?.id ?? null;
  const canCreate = may('create', 'document');
  const canCreateMicrosoftReference = documentLinkPermissions.projectCreate();
  // General document write-role (Admin·Exec·PM·Finance) — gates the non-author status moves
  // (Issue Draft→Issued, Close Approved→Closed). A-7: the metadata "Edit" action is additionally
  // AUTHOR-scoped (only the author, or Admin break-glass) — computed per row via canEditDoc().
  const canWriteDocs = may('create', 'document');
  const canDelete = may('delete', 'document');
  const canApprove = may('transition', 'documentStatus');

  const { pending, setPending, transitionError, setTransitionError, sodBlocked, setSodBlocked, reviewUnavailableLabel,
    isOwnDocument, statusActions, allowedStatusTargets, onTransitionConfirm } = useDocumentWorkflow({
    canWriteDocs, canApprove, currentUserId, transition,
  });

  // A-7 (rbac-visibility §H): Edit a document = ◆ author. The policy predicate is record-scoped,
  // so pass the row's author_id + the current user. Admin is break-glass (edit is not an SoD
  // axis). RLS/RPC stays the authority; this is FE clarity.
  const canEditDoc = (d: ProjectDocumentRow) =>
    may('edit', 'document', { currentUserId, record: { author_id: d.author_id } });

  const all = useMemo(() => (data ?? []) as ProjectDocumentRow[], [data]);
  const { fileInputRef, handleFileSelected, handleDownload, openPreview, downloadSelected, drawerFileContent, fileCell } =
    useDocumentFiles(projectId, all, canEditDoc);
  const profileNames = useMemo(
    () => new Map<string, string>((orgProfiles ?? []).map((profile) => [profile.id, profile.full_name?.trim() ?? ''] as const)),
    [orgProfiles],
  );
  const categoryName = useCallback((doc: ProjectDocumentRow) =>
    doc.category?.trim() || (isMicrosoftFolder(doc)
      ? t('projectDetail.documents.category.microsoftFolders', 'Microsoft folders')
      : t('projectDetail.documents.category.uncategorized', 'Uncategorized')), [t]);
  const categories = useMemo(
    () => Array.from(new Set(all.map(categoryName))).sort((a, b) => a.localeCompare(b)),
    [all, categoryName],
  );
  const needsAction = all.filter((doc) => ['Missing', 'Expired'].includes(String(doc.status)));
  const missingCount = needsAction.filter((doc) => String(doc.status) === 'Missing').length;
  const expiredCount = needsAction.filter((doc) => String(doc.status) === 'Expired').length;

  const documentsById = useMemo(() => {
    const map = new Map<string, ProjectDocumentRow>();
    all.forEach((doc) => map.set(doc.id, doc));
    return map;
  }, [all]);

  const childDocumentsByParentId = useMemo(() => {
    const map = new Map<string, ProjectDocumentRow[]>();
    all.forEach((doc) => {
      if (doc.parent_document_id) {
        const children = map.get(doc.parent_document_id) ?? [];
        children.push(doc);
        map.set(doc.parent_document_id, children);
      }
    });
    return map;
  }, [all]);

  // The Drawer resolves its row against the refreshed register, never a stale copy, so a link,
  // unlink or check landing while it is open is reflected without losing focus or state.
  const drawerDoc = drawerId ? (documentsById.get(drawerId) ?? null) : null;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (d) =>
        (!q || d.title.toLowerCase().includes(q) || (d.code ?? '').toLowerCase().includes(q) || categoryName(d).toLowerCase().includes(q)) &&
        (!categoryFilter || categoryName(d) === categoryFilter) &&
        (!statusFilter || (!isMicrosoftFolder(d) && d.status === statusFilter)) &&
        (!sourceFilter || (sourceFilter === 'onedrive' ? d.source === 'onedrive' : d.source !== 'onedrive')),
    );
  }, [all, search, categoryFilter, statusFilter, sourceFilter, categoryName]);

  const documentsView = searchParams.get('documentsView') === 'grouped' ? 'grouped' : 'register';
  const setDocumentsView = (view: 'register' | 'grouped') => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('documentsView', view);
      return next;
    }, { replace: true });
  };
  const setSortBy = (key: string) => setSort((current) => ({
    key,
    dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc',
  }));
  const sortedFiltered = useMemo(() => {
    const compareValue = (doc: ProjectDocumentRow) => {
      if (sort.key === 'category') return categoryName(doc);
      if (sort.key === 'status') return String(doc.status);
      return doc.title;
    };
    return [...filtered].sort((a, b) => {
      const groupOrder = documentsView === 'grouped' ? categoryName(a).localeCompare(categoryName(b)) : 0;
      if (groupOrder !== 0) return groupOrder;
      const sorted = compareValue(a).localeCompare(compareValue(b), undefined, { numeric: true, sensitivity: 'base' });
      return sort.dir === 'asc' ? sorted : -sorted;
    });
  }, [filtered, categoryName, documentsView, sort]);

  // The register and its open preview share one display-triggered verification batch. Include the
  // live drawer row even when filters hide it, and deduplicate it against the visible register.
  const verificationRows = useMemo(() => {
    const rowsById = new Map(sortedFiltered.map((doc) => [doc.id, doc] as const));
    if (drawerDoc) rowsById.set(drawerDoc.id, drawerDoc);
    return Array.from(rowsById.values());
  }, [drawerDoc, sortedFiltered]);
  const verification = useDocumentVerification(projectId, verificationRows, !isError);
  const verificationIds = useMemo(() => new Set(verification.documentIds), [verification.documentIds]);

  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  const selectedDocuments = all.filter((doc) => selectedIds.has(doc.id));
  const documentSelection: DataTableSelection<ProjectDocumentRow> = {
    selectedIds,
    onChange: (ids) => {
      setBulkStatus('');
      setBulkFailure(null);
      setSelectedIds(ids);
    },
    rowLabel: (doc) => t('projectDetail.documents.selectDocument', 'Select {{title}}', { title: doc.title }),
  };

  const cells = createDocumentRegisterCells({
    t,
    profileNames,
    currentUserId,
    fileCell,
  });
  const { ownerLabel, sourceName, documentHasFile, statusLabels } = cells;
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
          checking: verification.checking,
          failed: Boolean(verification.error),
          retry: () => verification.retry(isError ? [d] : undefined),
        } : undefined}
      />
    ) : null;
  };
  const columns = buildDocumentRegisterColumns({
    t, documentsById, childDocumentsByParentId, setDrawerDoc, categoryName, filtered, cells, microsoftCell,
  });
  const selectedDocumentsHaveFile = selectedDocuments.some(documentHasFile);

  const bulkStatusTargets = selectedDocuments.length > 0
    ? allowedStatusTargets(selectedDocuments[0]).filter((target) =>
        selectedDocuments.every((doc) => allowedStatusTargets(doc).includes(target)),
      )
    : [];

  const copyDocumentLink = async (doc: ProjectDocumentRow) => {
    try {
      const linkUrl = new URL(window.location.href);
      linkUrl.searchParams.set('open', doc.id);
      if (!linkUrl.searchParams.has('documentsView')) linkUrl.searchParams.set('documentsView', 'register');
      await navigator.clipboard.writeText(linkUrl.toString());
      toast(t('projectDetail.documents.toast.linkCopied', 'Document link copied'), doc.title, 'success');
    } catch {
      toast(
        t('projectDetail.documents.toast.linkCopyFailedTitle', 'Could not copy document link'),
        t('projectDetail.documents.toast.linkCopyFailed', 'Check browser clipboard access and try again.'),
        'warning',
      );
    }
  };

  const rowMenu = buildDocumentRowMenu({
    t, openPreview, handleDownload, canEditDoc, canWriteDocs, canDelete, canCreateMicrosoftReference,
    documentLinkPermissions, statusActions, startLatestRevision, copyDocumentLink,
    setFormTarget, setMicrosoftEntry, setUnlinkTarget, setRevisionParent, setDeleteTarget,
  });

  const onBulkStatusConfirm = async () => {
    if (!pendingBulkStatus) return;
    setBulkFailure(null);
    const targets = selectedDocuments.filter((doc) => allowedStatusTargets(doc).includes(pendingBulkStatus));
    let succeeded = 0;
    const failures: Array<{ doc: ProjectDocumentRow; error: unknown }> = [];
    for (const doc of targets) {
      try {
        await transition.mutateAsync({ id: doc.id, status: pendingBulkStatus });
        succeeded += 1;
      } catch (error) {
        failures.push({ doc, error });
      }
    }
    setBulkStatus('');
    setBulkStatusOpen(false);
    if (succeeded > 0) {
      toast(
        t('projectDetail.documents.bulk.statusUpdated', 'Status updated for {{count}} documents', { count: succeeded }),
        transitionActionLabel(pendingBulkStatus, t),
        'success',
      );
    }
    if (failures.length > 0) {
      const { headline, detail } = classifyMutationError(failures[0].error);
      const visibleFailures = failures.map(({ doc, error }) => {
        const classified = classifyMutationError(error, undefined, { suppressCapture: true });
        return { id: doc.id, title: doc.title, headline: classified.headline, detail: classified.detail };
      });
      setSelectedIds(new Set(failures.map(({ doc }) => doc.id)));
      setBulkFailure({ succeeded, failures: visibleFailures });
      toast(
        t('projectDetail.documents.bulk.statusFailed', 'Some documents could not be updated'),
        visibleFailures.map((failure) => `${failure.title}: ${failure.detail || failure.headline}`).join(' · ') || detail || headline,
        'warning',
      );
    } else {
      setPendingBulkStatus(null);
      setSelectedIds(new Set());
      setBulkFailure(null);
    }
  };

  const exportSelectedRegister = () => {
    const table = {
      header: [
        t('projectDetail.documents.column.document', 'Document'),
        t('projectDetail.documents.column.code', 'Code'),
        t('projectDetail.documents.column.category', 'Category'),
        t('projectDetail.documents.column.revision', 'Revision'),
        t('projectDetail.documents.column.status', 'Status'),
        t('projectDetail.documents.column.source', 'Source'),
        t('projectDetail.documents.column.owner', 'Owner'),
        t('projectDetail.documents.column.documentDate', 'Document date'),
      ],
      body: selectedDocuments.map((doc) => [
        doc.title,
        doc.code ?? '',
        categoryName(doc),
        doc.revision ?? '',
        isMicrosoftFolder(doc) ? '' : String(doc.status),
        sourceName(doc),
        ownerLabel(doc),
        doc.doc_date ?? '',
      ]),
    };
    const url = URL.createObjectURL(new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `project-${projectId}-document-register.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const onDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteError(null);
    try {
      await remove.mutateAsync(target.id);
      toast(t('projectDetail.documents.toast.deleted', 'Document deleted'), target.title, 'success');
      setDeleteTarget(null);
      setDeleteError(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setDeleteError({ headline, detail });
      toast(headline, detail, 'warning');
    }
  };

  const handleCreateRevision = (data: { title: string; code: string; category: string; revision: string; doc_date: string; microsoft?: MicrosoftReferenceInput }) => {
    const parent = latestRevision?.parent ?? revisionParent;
    if (!parent || (data.microsoft && !documentLinkPermissions.projectCreate())) return;
    setRevisionError(null);
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
          setRevisionError({ headline, detail });
          toast(headline, detail, 'warning');
        },
      },
    );
  };

  const previewParentDoc = drawerDoc?.parent_document_id ? documentsById.get(drawerDoc.parent_document_id) ?? null : null;
  const previewChildDocs = drawerDoc ? childDocumentsByParentId.get(drawerDoc.id) ?? [] : [];
  const previewTransitions = drawerDoc ? statusActions(drawerDoc).filter((action) => action.label !== reviewUnavailableLabel) : [];
  const previewSodBlocked = Boolean(drawerDoc && drawerDoc.status === 'Issued' && canApprove && isOwnDocument(drawerDoc));
  const previewCanEdit = Boolean(drawerDoc && canEditDoc(drawerDoc) && drawerDoc.status !== 'Closed' && drawerDoc.status !== 'Superseded');
  const previewSharePointUrl = drawerDoc ? projectReference(drawerDoc)?.web_url ?? null : null;
  const safePreviewSharePointUrl = previewSharePointUrl && validMicrosoftBrowserUrl(previewSharePointUrl)
    ? previewSharePointUrl
    : null;
  const editPreview = () => {
    if (!drawerDoc) return;
    const doc = drawerDoc;
    setDrawerDoc(null);
    setFormTarget({ doc });
  };
  const deletePreview = () => {
    if (!drawerDoc) return;
    const doc = drawerDoc;
    setDrawerDoc(null);
    setDeleteTarget(doc);
  };

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[16px] font-bold tracking-[-0.01em]">
          {t('projectDetail.documents.heading', 'Document register')}
        </h2>
      </div>

      {microsoftEntry && (
        <MicrosoftEntry code={projectCode} onClose={() => setMicrosoftEntry(null)} onSelect={onSelectReference} />
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

      {needsAction.length > 0 && (
        <GateNotice variant="blocked" className="mb-3.5" data-testid="documents-action-banner">
          {t('projectDetail.documents.needsAction', '{{count}} documents need action · {{missing}} missing · {{expired}} expired', {
            count: needsAction.length,
            missing: missingCount,
            expired: expiredCount,
          })}
        </GateNotice>
      )}

      {/* Selection actions and their failure report sit above the assembly, so the assembly stays one
          unbroken surface (toolbar seamed to its rows) whatever the selection is. */}
      {bulkFailure && <div role="alert" className="mb-3 rounded-md border border-destructive/25 bg-destructive/[0.04] px-3 py-2 text-sm text-destructive-text">
        {bulkFailure.succeeded > 0 && <p>{t('projectDetail.documents.bulk.partialSuccess', 'Updated {{count}} document(s). Failed documents remain selected for retry.', { count: bulkFailure.succeeded })}</p>}
        <ul className="list-disc space-y-1 pl-5">{bulkFailure.failures.map((failure) => <li key={failure.id}>{failure.title}: {failure.headline}{failure.detail ? `. ${failure.detail}` : ''}</li>)}</ul>
      </div>}

      {selectedDocuments.length > 0 && (
        <DocumentsBulkBar
          selectedCount={selectedDocuments.length}
          selectedDocumentsHaveFile={selectedDocumentsHaveFile}
          onDownloadSelected={() => void downloadSelected(selectedDocuments)}
          bulkStatus={bulkStatus}
          setBulkStatus={setBulkStatus}
          bulkStatusTargets={bulkStatusTargets}
          statusLabels={statusLabels}
          bulkStatusOpen={bulkStatusOpen}
          setBulkStatusOpen={setBulkStatusOpen}
          onReviewStatus={() => { setBulkFailure(null); setPendingBulkStatus(bulkStatus as DocStatus); }}
          onExportSelected={exportSelectedRegister}
          onClearSelection={() => { setSelectedIds(new Set()); setBulkStatus(''); setBulkStatusOpen(false); }}
        />
      )}

      {/* One card assembly (DESIGN.md §3): the register toolbar seams to the rows below it, so the
          filters and the register read as one surface in every state, like the record's other tabs. */}
      <div className="min-w-0" data-testid="documents-register-assembly">
        {/* The folder action shares the toolbar row with the other create/link controls (empty for non-writers). */}
        <DocumentsToolbar
          registerSize={all.length}
          search={search}
          setSearch={setSearch}
          categories={categories}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          sourceFilter={sourceFilter}
          setSourceFilter={setSourceFilter}
          documentsView={documentsView}
          setDocumentsView={setDocumentsView}
          canCreateMicrosoftReference={canCreateMicrosoftReference}
          canCreate={canCreate}
          folderAction={(
            <RecordFolderAction
              target={{ kind: 'project', id: projectId }}
              hasFolder={all.some((d) => d.source === 'onedrive' && d.ms_item_kind === 'folder')}
              onChooseExisting={() => { if (canCreateMicrosoftReference) setMicrosoftEntry({ kind: 'create' }); }}
            />
          )}
          onLinkMicrosoft={() => setMicrosoftEntry({ kind: 'create' })}
          onAddDocument={() => setFormTarget({ doc: null })}
        />

        {state === 'loading' && (
          <div className="rounded-b-lg border border-border bg-card">
            <ListState variant="loading" rows={5} />
          </div>
        )}

        {state === 'error' && (
          <div className="rounded-b-lg border border-border bg-card">
            <ListState
              variant="error"
              title={t('projectDetail.documents.errorTitle', "Couldn't load documents")}
              sub={t(
                'projectDetail.documents.errorSub',
                'The request failed. Check your connection and try again.',
              )}
              onRetry={() => refetch()}
            />
          </div>
        )}

        {state === 'empty' && (
          <div className="rounded-b-lg border border-border bg-card">
            <ListState
              variant="empty"
              icon="doc"
              title={t('projectDetail.documents.emptyTitle', 'No documents yet')}
              sub={t(
                'projectDetail.documents.emptySub',
                "Add a drawing, specification, or transmittal to start the project's document register.",
              )}
            />
          </div>
        )}

        {state === undefined && (
          <DataTable<ProjectDocumentRow>
            rows={sortedFiltered}
            columns={columns}
            rowKey={(d) => d.id}
            selection={documentSelection}
            onActivate={(d) => setDrawerDoc(d)}
            rowMenu={rowMenu}
            selectedKey={drawerDoc?.id}
            sort={sort}
            onSort={setSortBy}
            groupBy={documentsView === 'grouped' ? categoryName : undefined}
            state={filtered.length === 0 ? 'empty' : undefined}
            emptyTitle={t('projectDetail.documents.noSearchMatch', 'No documents match your search')}
            emptySub={t('projectDetail.documents.noSearchMatchSub', 'Try a different title, code, or category.')}
            tableId="project-detail-tabs-documentstab-table"
          />
        )}
      </div>

      {drawerDoc && (
        <DocumentDrawer
          doc={drawerDoc}
          parentDoc={previewParentDoc}
          childDocs={previewChildDocs}
          transitions={previewTransitions}
          sodBlocked={previewSodBlocked}
          fileContent={drawerFileContent(drawerDoc)}
          hasFile={Boolean(drawerDoc.file_path)}
          sharePointUrl={safePreviewSharePointUrl}
          fullRecordHref={`/projects/${projectId}/documents`}
          canEdit={previewCanEdit}
          canDelete={canDelete}
          nestedOpen={!!pending}
          onClose={() => setDrawerDoc(null)}
          onEdit={editPreview}
          onDelete={deletePreview}
          onDownload={() => void handleDownload(drawerDoc)}
          onViewDocument={setDrawerDoc}
          microsoftFile={microsoftCell(drawerDoc)}
        />
      )}

      <DocumentsDialogs
        formTarget={formTarget}
        setFormTarget={setFormTarget}
        canCreateMicrosoftReference={canCreateMicrosoftReference}
        onCreateDocument={async (input) => {
          const reference = formTarget?.reference;
          if (reference && !documentLinkPermissions.projectCreate()) {
            throw Object.assign(new Error('View-only session'), { code: '42501' });
          }
          // One INSERT carries the reference (no empty intermediate row).
          await create.mutateAsync(reference ? { ...input, source: 'onedrive', microsoft: reference } : input);
          toast(t('projectDetail.documents.toast.added', 'Document added'), input.title, 'success');
          setFormTarget(null);
        }}
        onUpdateDocument={async (id, input) => {
          await update.mutateAsync({ id, input });
          toast(t('projectDetail.documents.toast.updated', 'Document updated'), input.title, 'success');
          setFormTarget(null);
        }}
        onDocumentError={(err) => {
          const { headline, detail } = classifyMutationError(err);
          toast(headline, detail, 'warning');
        }}
        onChangeReference={canCreateMicrosoftReference ? () => { setFormTarget(null); setMicrosoftEntry({ kind: 'create' }); } : undefined}
        fileInputRef={fileInputRef}
        onFileSelected={handleFileSelected}
        revisionTarget={latestRevision}
        revisionParent={revisionParent}
        onCreateRevision={handleCreateRevision}
        revisionLoading={createRevision.isPending}
        revisionError={revisionError}
        onRevisionClose={() => { setRevisionParent(null); setLatestRevision(null); setRevisionError(null); }}
        unlinkTarget={unlinkTarget}
        onUnlinkConfirm={onUnlinkConfirm}
        onUnlinkClose={() => setUnlinkTarget(null)}
        unlink={unlink}
        pending={pending}
        transitionError={transitionError}
        onTransitionConfirm={onTransitionConfirm}
        onTransitionCancel={() => { setPending(null); setTransitionError(null); }}
        transitionLoading={transition.isPending}
        pendingBulkStatus={pendingBulkStatus}
        bulkFailure={bulkFailure}
        onBulkStatusConfirm={() => void onBulkStatusConfirm()}
        onBulkStatusCancel={() => setPendingBulkStatus(null)}
        bulkSelectedCount={selectedDocuments.length}
        deleteTarget={deleteTarget}
        deleteError={deleteError}
        onDeleteConfirm={() => void onDeleteConfirm()}
        onDeleteCancel={() => { setDeleteTarget(null); setDeleteError(null); }}
        deleteLoading={remove.isPending}
      />
    </div>
  );
};

export default DocumentsTab;
