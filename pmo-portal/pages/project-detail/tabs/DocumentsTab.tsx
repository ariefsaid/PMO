import { isMicrosoftFolder } from './documentUtils';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { DocumentFormModal } from './DocumentFormModal';
import { useDocumentWorkflow } from './useDocumentWorkflow';
import { useDocumentFiles } from './useDocumentFiles';
import { MicrosoftEntry } from './ProjectDocumentMicrosoft';
import { useDocumentMicrosoft } from './useDocumentMicrosoft';
import { DocumentDrawer, DocumentPreviewPanel, DocumentTitleCell } from './DocumentDrawer';
import {
  Toolbar,
  SearchMini,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  GateNotice,
  useToast,
  Button,
  Icon,
  Tooltip,
  ViewToggle,
  type Column,
  type DataTableSelection,
  type RowMenuItem,
  type SortState,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useDocuments, useDocumentMutations } from '@/src/hooks/useDocuments';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { useRevision } from '@/src/hooks/useRevision';
import { RecordFolderAction } from '@/src/components/m365/RecordFolderAction';
import { LinkedDocumentCell } from '@/src/components/m365/LinkedDocumentCell';
import { useDocumentLinkPermissions } from '@/src/components/m365/DocumentLinkPermissions';
import { projectOwner, projectReference, validMicrosoftBrowserUrl, type MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import { NewRevisionModal } from '@/src/components/NewRevisionModal';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { FILE_INPUT_ACCEPT } from '@/src/lib/fileConstants';
import type {
  ProjectDocumentRow,
  DocStatus,
} from '@/src/lib/db/documents';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { toCsv } from '@/src/lib/export/toCsv';
import { formatDateOnly } from '@/src/lib/format';

export interface DocumentsTabProps {
  projectId: string;
  /** Reports the register row count (null while unavailable) so the parent chrome can badge it. */
  onCountChange?: (count: number | null) => void;
  /** The PROJECT's code (loaded by the parent), used to suggest convention folders in the picker. */
  projectCode?: string | null;
}

/** Search shows only when the register is long enough to need it (owner ruling B7: "search only beyond ~10"). */
const SEARCH_THRESHOLD = 10;

/**
 * Per-project DOCUMENT REGISTER with repository-backed metadata, local-file actions, and
 * Microsoft 365 references. List, filter, group, bulk actions and preview share one surface.
 *
 * Status workflow: Draft → Issued → Approved / Rejected → Closed. The Approve/Reject step is
 * SoD-gated (approver ≠ author): the document's author can never approve their own document.
 * Gating reads the REAL JWT role + the current user id; RLS is the enforcement authority.
 */

// Status pills use the single workflow variant registry. Labels carry the exact state identity.

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

const DocumentsTab: React.FC<DocumentsTabProps> = ({ projectId, projectCode = null, onCountChange }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation('project');
  const isDesktop = useIsDesktop();
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

  // Modal: null = closed; { doc: null } = create; { doc } = edit.
  const [formTarget, setFormTarget] = useState<{ doc: ProjectDocumentRow | null; reference?: MicrosoftReferenceInput } | null>(null);
  const { microsoftEntry, setMicrosoftEntry, unlinkTarget, setUnlinkTarget, latestRevision,
    setLatestRevision, startLatestRevision, onUnlinkConfirm, onSelectReference } = useDocumentMicrosoft(
    documentLinkPermissions, link, unlink, (reference) => setFormTarget({ doc: null, reference }),
  );
  const [deleteTarget, setDeleteTarget] = useState<ProjectDocumentRow | null>(null);
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

  const currentUserId = currentUser?.id ?? null;
  const canCreate = may('create', 'document');
  const canCreateMicrosoftReference = documentLinkPermissions.projectCreate();
  // General document write-role (Admin·Exec·PM·Finance) — gates the non-author status moves
  // (Issue Draft→Issued, Close Approved→Closed). A-7: the metadata "Edit" action is additionally
  // AUTHOR-scoped (only the author, or Admin break-glass) — computed per row via canEditDoc().
  const canWriteDocs = may('create', 'document');
  const canDelete = may('delete', 'document');
  const canApprove = may('transition', 'documentStatus');

  const { pending, setPending, sodBlocked, setSodBlocked, reviewUnavailableLabel,
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
      setSelectedIds(ids);
    },
    rowLabel: (doc) => t('projectDetail.documents.selectDocument', 'Select {{title}}', { title: doc.title }),
  };

  // A complete Microsoft reference renders through the shared linked-document details in the
  // preview; a row with an incomplete reference remains an ordinary upload/source row.
  const microsoftCell = (d: ProjectDocumentRow, compact = false): React.ReactNode => {
    const reference = projectReference(d);
    return reference ? <LinkedDocumentCell reference={reference} title={d.title} owner={projectOwner(d)} compact={compact} /> : null;
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
  const selectedDocumentsHaveFile = selectedDocuments.some(documentHasFile);
  const statusLabels: Record<DocStatus, string> = {
    Draft: t('projectDetail.documents.action.reopen', 'Reopen for revision'),
    Issued: t('projectDetail.documents.action.issue', 'Issue'),
    Approved: t('projectDetail.documents.action.approve', 'Approve'),
    Rejected: t('projectDetail.documents.action.reject', 'Reject'),
    Closed: t('projectDetail.documents.action.close', 'Close'),
    Superseded: t('projectDetail.documents.action.close', 'Close'),
  };
  const columns: Column<ProjectDocumentRow>[] = [
    {
      key: 'title',
      header: t('projectDetail.documents.column.document', 'Document'),
      size: 320, minSize: 260, maxSize: 420,
      sortKey: 'title',
      cell: (d) => (
        <DocumentTitleCell
          doc={d}
          parentDoc={d.parent_document_id ? (documentsById.get(d.parent_document_id) ?? null) : null}
          childDocs={childDocumentsByParentId.get(d.id) ?? []}
          onViewDocument={setDrawerDoc}
        />
      ),
      exportValue: (d) => d.title,
    },
    {
      key: 'category',
      header: t('projectDetail.documents.column.category', 'Category'),
      size: 128, minSize: 112, maxSize: 220,
      sortKey: 'category',
      cell: (d) => <span className="text-[13px] text-muted-foreground">{categoryName(d)}</span>,
      exportValue: categoryName,
    },
    {
      key: 'status',
      header: t('projectDetail.documents.column.status', 'Status'),
      kind: 'status',
      size: 120, minSize: 112, maxSize: 160,
      sortKey: 'status',
      cell: statusCell,
      exportValue: (d) => isMicrosoftFolder(d) ? '' : String(d.status),
    },
    {
      key: 'source',
      header: t('projectDetail.documents.column.source', 'Source'),
      size: 136, minSize: 120, maxSize: 220,
      cell: sourceCell,
      exportValue: sourceName,
    },
    {
      key: 'owner',
      header: t('projectDetail.documents.column.owner', 'Owner'),
      size: 150, minSize: 120, maxSize: 240,
      cell: ownerCell,
      exportValue: ownerLabel,
    },
    {
      key: 'doc_date',
      header: t('projectDetail.documents.column.docDate', 'Date'),
      size: 104, minSize: 96, maxSize: 132,
      cell: documentDateCell,
      exportValue: (doc) => doc.doc_date ?? '',
    },
    ...(filtered.some(documentHasFile) ? [{
      key: 'file',
      header: t('projectDetail.documents.column.file', 'File'),
      size: 220, minSize: 160, maxSize: 300,
      cell: (doc: ProjectDocumentRow) => doc.source === 'onedrive'
        ? (isMicrosoftFolder(doc) ? '—' : (microsoftCell(doc, true) ?? '—'))
        : (fileCell(doc) ?? '—'),
      exportValue: (doc: ProjectDocumentRow) => doc.file_path?.split('/').pop() ?? (isMicrosoftFolder(doc) ? '' : doc.ms_item_name ?? ''),
    } satisfies Column<ProjectDocumentRow>] : []),
  ];

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

  const rowMenu = (d: ProjectDocumentRow): RowMenuItem[] => {
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
        items.push({ label: t('m365Documents.newRevisionFromLatest', 'Make new revision from latest file update'), onClick: () => void startLatestRevision(d) });
      }
    }
    items.push(...statusActions(d));
    items.push({ label: t('projectDetail.documents.action.copyLink', 'Copy link'), onClick: () => void copyDocumentLink(d) });
    if (canDelete) items.push({ label: t('projectDetail.documents.action.delete', 'Delete'), onClick: () => setDeleteTarget(d), danger: true });
    return items;
  };

  const onBulkStatusConfirm = async () => {
    if (!pendingBulkStatus) return;
    const targets = selectedDocuments.filter((doc) => allowedStatusTargets(doc).includes(pendingBulkStatus));
    let succeeded = 0;
    const failures: unknown[] = [];
    for (const doc of targets) {
      try {
        await transition.mutateAsync({ id: doc.id, status: pendingBulkStatus });
        succeeded += 1;
      } catch (error) {
        failures.push(error);
      }
    }
    setPendingBulkStatus(null);
    setBulkStatus('');
    setBulkStatusOpen(false);
    if (succeeded > 0) {
      toast(
        t('projectDetail.documents.bulk.statusUpdated', 'Status updated for {{count}} documents', { count: succeeded }),
        transitionActionLabel(pendingBulkStatus, t),
        'success',
      );
      setSelectedIds(new Set());
    }
    if (failures.length > 0) {
      const { headline, detail } = classifyMutationError(failures[0]);
      toast(
        t('projectDetail.documents.bulk.statusFailed', 'Some documents could not be updated'),
        detail || headline,
        'warning',
      );
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
          onSelect={onSelectReference}
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

      {needsAction.length > 0 && (
        <GateNotice variant="blocked" className="mb-3.5" data-testid="documents-action-banner">
          {t('projectDetail.documents.needsAction', '{{count}} documents need action · {{missing}} missing · {{expired}} expired', {
            count: needsAction.length,
            missing: missingCount,
            expired: expiredCount,
          })}
        </GateNotice>
      )}

      <Toolbar standalone className="min-w-0 border-0 bg-transparent px-[var(--panel-inset)] py-3">
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
          {/* B7: search earns its place only beyond about ten documents; the filters cover a short register. */}
          {(all.length > SEARCH_THRESHOLD || search) && <SearchMini
            placeholder={t('projectDetail.documents.searchPlaceholder', 'Search documents…')}
            aria-label={t('projectDetail.documents.searchAriaLabel', 'Search documents')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="min-w-0 basis-full sm:basis-56 sm:grow-0"
          />}
          <label className="sr-only" htmlFor="documents-category-filter">{t('projectDetail.documents.filter.category', 'Filter by category')}</label>
          <select
            id="documents-category-filter"
            aria-label={t('projectDetail.documents.filter.category', 'Filter by category')}
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground sm:flex-none"
          >
            <option value="">{t('projectDetail.documents.filter.allCategories', 'All categories')}</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <label className="sr-only" htmlFor="documents-status-filter">{t('projectDetail.documents.filter.status', 'Filter by status')}</label>
          <select
            id="documents-status-filter"
            aria-label={t('projectDetail.documents.filter.status', 'Filter by status')}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as DocStatus | '')}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground sm:flex-none"
          >
            <option value="">{t('projectDetail.documents.filter.allStatuses', 'All statuses')}</option>
            {(['Draft', 'Issued', 'Approved', 'Rejected', 'Closed', 'Superseded'] as DocStatus[]).map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="documents-source-filter">{t('projectDetail.documents.filter.source', 'Filter by source')}</label>
          <select
            id="documents-source-filter"
            aria-label={t('projectDetail.documents.filter.source', 'Filter by source')}
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value as 'upload' | 'onedrive' | '')}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground sm:flex-none"
          >
            <option value="">{t('projectDetail.documents.filter.allSources', 'All sources')}</option>
            <option value="upload">{t('projectDetail.documents.source.upload', 'Upload')}</option>
            <option value="onedrive">{t('projectDetail.documents.source.sharePoint', 'SharePoint')}</option>
          </select>
          <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:ml-auto sm:w-auto sm:justify-end">
            <ViewToggle<'register' | 'grouped'>
              options={[
                { value: 'register', label: t('projectDetail.documents.view.register', 'Register') },
                { value: 'grouped', label: t('projectDetail.documents.view.grouped', 'Grouped') },
              ]}
              value={documentsView}
              onChange={setDocumentsView}
              ariaLabel={t('projectDetail.documents.view.ariaLabel', 'Document register view')}
              semantics="toggle"
            />
            <div className="flex flex-wrap items-center gap-2">
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
              {canCreate && (
                <Button variant="outline" size="sm" onClick={() => setFormTarget({ doc: null })}>
                  <Icon name="plus" />
                  {t('projectDetail.documents.addDocument', 'Add document')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Toolbar>

      {selectedDocuments.length > 0 && (
        <div role="group" aria-label={t('projectDetail.documents.bulk.ariaLabel', 'Selected document actions')} className="mb-3.5 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
          <span className="mr-auto text-sm font-medium text-foreground">
            {t('projectDetail.documents.bulk.selected', '{{count}} selected', { count: selectedDocuments.length })}
          </span>
          <Button variant="outline" size="sm" disabled={!selectedDocumentsHaveFile} onClick={() => void downloadSelected(selectedDocuments)}>
            {t('projectDetail.documents.bulk.download', 'Download')}
          </Button>
          {bulkStatusOpen ? (
            <>
              <select
                aria-label={t('projectDetail.documents.bulk.changeStatus', 'Change status')}
                value={bulkStatus}
                onChange={(event) => setBulkStatus(event.target.value as DocStatus | '')}
                className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              >
                <option value="">{t('projectDetail.documents.bulk.chooseStatus', 'Choose status')}</option>
                {bulkStatusTargets.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
              </select>
              <Button size="sm" disabled={!bulkStatus} onClick={() => setPendingBulkStatus(bulkStatus as DocStatus)}>
                {t('projectDetail.documents.bulk.reviewStatus', 'Review change')}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" disabled={bulkStatusTargets.length === 0} onClick={() => setBulkStatusOpen(true)}>
              {t('projectDetail.documents.bulk.changeStatus', 'Change status')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportSelectedRegister}>
            {t('projectDetail.documents.bulk.exportRegister', 'Export register')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setSelectedIds(new Set()); setBulkStatus(''); setBulkStatusOpen(false); }}>
            {t('projectDetail.documents.bulk.clearSelection', 'Clear selection')}
          </Button>
        </div>
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
        <div className={drawerDoc && isDesktop ? 'grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)]' : ''}>
          <div className="min-w-0">
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
              emptySub={t(
                'projectDetail.documents.noSearchMatchSub',
                'Try a different title, code, or category.',
              )}
              className="!overflow-visible !rounded-none !border-0 !bg-transparent"
              tableId="project-detail-tabs-documentstab-table"
            />
          </div>
          {drawerDoc && isDesktop && (
            <DocumentPreviewPanel
              doc={drawerDoc}
              parentDoc={previewParentDoc}
              childDocs={previewChildDocs}
              transitions={previewTransitions}
              sodBlocked={previewSodBlocked}
              fileContent={drawerFileContent(drawerDoc)}
              microsoftFile={microsoftCell(drawerDoc)}
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
            />
          )}
        </div>
      )}

      {drawerDoc && !isDesktop && (
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

      <ConfirmDialog
        open={!!pendingBulkStatus}
        tone={pendingBulkStatus === 'Rejected' ? 'destructive' : 'default'}
        title={pendingBulkStatus
          ? t('projectDetail.documents.bulk.confirmTitle', 'Update status for selected documents?')
          : t('projectDetail.documents.transitionConfirm.titleFallback', 'Update status?')}
        description={pendingBulkStatus === 'Approved'
          ? t('projectDetail.documents.bulk.approvalDescription', 'Apply this approval to {{count}} selected documents. Approval is recorded and follows the reviewer separation rule.', { count: selectedDocuments.length })
          : pendingBulkStatus === 'Rejected'
            ? t('projectDetail.documents.bulk.rejectionDescription', 'Rejecting returns selected documents for revision. This change will be recorded.')
            : pendingBulkStatus === 'Issued'
              ? t('projectDetail.documents.bulk.issueDescription', 'Issuing moves selected documents into review so a reviewer can approve or reject them.')
              : pendingBulkStatus === 'Closed'
                ? t('projectDetail.documents.bulk.closeDescription', 'Closing finalises the selected documents.')
                : t('projectDetail.documents.bulk.confirmDescription', 'Apply this status change to {{count}} selected documents. The change will be recorded.', { count: selectedDocuments.length })}
        confirmLabel={t('projectDetail.documents.bulk.confirmAction', 'Confirm status change')}
        loading={transition.isPending}
        onConfirm={onBulkStatusConfirm}
        onCancel={() => setPendingBulkStatus(null)}
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

export default DocumentsTab;
