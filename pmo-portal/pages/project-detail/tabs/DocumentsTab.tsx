import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
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
import { projectOwner, projectReference, validMicrosoftBrowserUrl, type MicrosoftReferenceInput } from '@/src/lib/m365/reference';
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
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { toCsv } from '@/src/lib/export/toCsv';
import { formatDateOnly } from '@/src/lib/format';

export interface DocumentsTabProps {
  projectId: string;
  /** The PROJECT's code (loaded by the parent), used to suggest convention folders in the picker. */
  projectCode?: string | null;
}

/** True for a register row that references a Microsoft folder (reference-only: never issued/approved). */
/** Search shows only when the register is long enough to need it (owner ruling B7: "search only beyond ~10"). */
const SEARCH_THRESHOLD = 10;
const isMicrosoftFolder = (d: ProjectDocumentRow) => d.source === 'onedrive' && d.ms_item_kind === 'folder';

/** The Microsoft entry point in flight: a new document seeded from a reference, or linking an existing Draft. */
type MicrosoftEntryTarget = { kind: 'create' } | { kind: 'link'; doc: ProjectDocumentRow };

/**
 * Per-project DOCUMENT REGISTER with repository-backed metadata, local-file actions, and
 * Microsoft 365 references. List, filter, group, bulk actions and preview share one surface.
 *
 * Status workflow: Draft → Issued → Approved / Rejected → Closed. The Approve/Reject step is
 * SoD-gated (approver ≠ author): the document's author can never approve their own document.
 * Gating reads the REAL JWT role + the current user id; RLS is the enforcement authority.
 */

// Status pills use the single workflow variant registry. Labels carry the exact state identity.

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
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation('project');
  const isDesktop = useIsDesktop();
  const may = usePermission();
  const documentLinkPermissions = useDocumentLinkPermissions();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useDocuments(projectId);
  const { data: orgProfiles } = useAssignableProfiles();
  const { create, update, transition, remove, link, unlink } = useDocumentMutations(projectId);
  const { upload, replace, progress, uploadErrors, cancelUpload, clearUploadError } = useFileUpload(projectId);
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

  // approver ≠ author (Document approval SoD): the author can never approve/reject their own doc.
  const isOwnDocument = (d: ProjectDocumentRow) =>
    !!currentUserId && d.author_id === currentUserId;

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
          childDoc={childDocumentsByParentId.get(d.id) ?? null}
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

  const allowedStatusTargets = (doc: ProjectDocumentRow): DocStatus[] => {
    if (isMicrosoftFolder(doc)) return [];
    if (doc.status === 'Draft' && canWriteDocs) return ['Issued'];
    if (doc.status === 'Issued' && canApprove && !isOwnDocument(doc)) return ['Approved', 'Rejected'];
    if (doc.status === 'Approved' && canWriteDocs) return ['Closed'];
    if (doc.status === 'Rejected' && canWriteDocs) return ['Draft', 'Closed'];
    return [];
  };
  const bulkStatusTargets = selectedDocuments.length > 0
    ? allowedStatusTargets(selectedDocuments[0]).filter((target) =>
        selectedDocuments.every((doc) => allowedStatusTargets(doc).includes(target)),
      )
    : [];

  const openPreview = (doc: ProjectDocumentRow) => {
    const reference = projectReference(doc);
    if (reference?.web_url) {
      if (!validMicrosoftBrowserUrl(reference.web_url)) {
        toast(t('m365Documents.cell.openRefused', 'This Microsoft link cannot be opened.'), undefined, 'warning');
        return;
      }
      window.open(reference.web_url, '_blank', 'noopener,noreferrer');
      return;
    }
    void handlePreview(doc);
  };

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

  const downloadSelected = async () => {
    selectedDocuments.forEach((doc) => {
      const url = !doc.file_path ? projectReference(doc)?.web_url : null;
      if (url && validMicrosoftBrowserUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
    });
    for (const doc of selectedDocuments.filter((item) => Boolean(item.file_path))) await handleDownload(doc);
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

  // C4: the drawer shows a File field only when there is a file, a Draft to upload to, an upload in flight or an error.
  const drawerFileContent = (doc: ProjectDocumentRow) => (doc.source !== 'onedrive'
    && (doc.file_path || doc.status === 'Draft' || progress[doc.id] != null || clientUploadErrors[doc.id] || uploadErrors[doc.id]) ? fileCell(doc) : undefined);
  const fileCell = (doc: ProjectDocumentRow) => {
    if (doc.source === 'onedrive') return <span className="text-muted-foreground">{'—'}</span>;
    return (
      <FileCell
        status={String(doc.status)}
        filePath={doc.file_path}
        title={doc.title}
        uploadProgress={progress[doc.id] ?? null}
        uploadError={clientUploadErrors[doc.id] ?? uploadErrors[doc.id]?.message ?? null}
        onUpload={doc.status === 'Draft' && canWriteDocs ? () => handleUploadClick(doc.id) : undefined}
        onReplace={doc.status === 'Draft' && canWriteDocs ? () => handleReplaceClick(doc.id) : undefined}
        onCancelUpload={progress[doc.id] != null ? () => cancelUpload(doc.id) : undefined}
        onRemoveError={clientUploadErrors[doc.id] || uploadErrors[doc.id] ? () => clearAnyUploadError(doc.id) : undefined}
        onDownload={doc.file_path ? () => void handleDownload(doc) : undefined}
        onPreview={doc.file_path ? () => void handlePreview(doc) : undefined}
      />
    );
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

  const previewParentDoc = drawerDoc?.parent_document_id ? documentsById.get(drawerDoc.parent_document_id) ?? null : null;
  const previewChildDoc = drawerDoc ? childDocumentsByParentId.get(drawerDoc.id) ?? null : null;
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
    <div className="panel-card min-w-0">
      <div className="border-b border-border px-[var(--panel-inset)] py-4">
        <h2 className="text-page font-bold tracking-[-0.02em]">
          {t('projectDetail.documents.heading', 'Document register')}
        </h2>
      </div>

      {/* Below the header, so a folder notice never pushes the primary actions down or off-screen (empty for non-writers). */}
      <div className="empty:hidden px-[var(--panel-inset)] pt-3">
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
          <Button variant="outline" size="sm" disabled={!selectedDocumentsHaveFile} onClick={() => void downloadSelected()}>
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
        <ListState variant="loading" rows={5} className="px-[var(--panel-inset)] pb-[var(--panel-inset)]" />
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
              childDoc={previewChildDoc}
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
          childDoc={previewChildDoc}
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

// ── D12: read-first quick-view drawer + inline status workflow ────────────────

interface LineageButtonProps {
  revision: string;
  title: string;
  direction: 'back' | 'forward';
  onClick: () => void;
}

const LineageButton: React.FC<LineageButtonProps> = ({ revision, title, direction, onClick }) => {
  const { t } = useTranslation('project');
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
  const { t } = useTranslation('project');
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
        {(doc.code || doc.revision) && (
          <span className="text-[12px] text-muted-foreground">
            {[
              doc.code,
              doc.revision ? `${t('projectDetail.documents.revLabel', 'Rev')} ${doc.revision}` : null,
            ].filter(Boolean).join(' · ')}
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

interface DocumentPreviewProps {
  /** The in-hand ProjectDocumentRow (no extra fetch). */
  doc: ProjectDocumentRow;
  parentDoc: ProjectDocumentRow | null;
  childDoc: ProjectDocumentRow | null;
  transitions: RowMenuItem[];
  sodBlocked: boolean;
  onViewDocument: (doc: ProjectDocumentRow) => void;
  fileContent: React.ReactNode;
  microsoftFile: React.ReactNode;
}

interface DocumentActionFooterProps {
  canEdit: boolean;
  canDelete: boolean;
  hasFile: boolean;
  sharePointUrl: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onDownload: () => void;
}

interface DocumentHeaderActionsProps {
  primaryAction?: RowMenuItem;
  fullRecordHref: string;
}

const DocumentHeaderActions: React.FC<DocumentHeaderActionsProps> = ({ primaryAction, fullRecordHref }) => {
  const { t } = useTranslation('project');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {primaryAction && (
        <Button
          size="sm"
          variant={primaryAction.danger ? 'destructive' : 'primary'}
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
        >
          {primaryAction.label}
        </Button>
      )}
      <Link
        to={fullRecordHref}
        className="inline-flex min-h-10 items-center rounded-sm text-sm font-medium text-primary-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {t('projectDetail.drawer.openFullPage', 'Open full page')}
      </Link>
    </div>
  );
};

const DocumentActionFooter: React.FC<DocumentActionFooterProps> = ({
  canEdit,
  canDelete,
  hasFile,
  sharePointUrl,
  onEdit,
  onDelete,
  onDownload,
}) => {
  const { t } = useTranslation('project');
  return (
    <>
      {canEdit && (
        <Button variant="outline" size="sm" onClick={onEdit}>
          {t('projectDetail.documents.action.edit', 'Edit')}
        </Button>
      )}
      {hasFile && (
        <Button variant="outline" size="sm" onClick={onDownload}>
          {t('projectDetail.documents.action.download', 'Download')}
        </Button>
      )}
      {sharePointUrl && (
        <a
          href={sharePointUrl}
          target="_blank"
          rel="noreferrer"
          className="touch-target inline-flex items-center rounded-sm px-2 text-sm font-medium text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t('projectDetail.documents.action.openSharePoint', 'Open in SharePoint')}
        </a>
      )}
      {canDelete && (
        // B1: Delete stays reachable but quiet; it is confirmed, and the drawer's one filled action is the next step.
        <Button variant="ghost" size="sm" className="text-destructive-text! sm:ml-auto" onClick={onDelete}>
          {t('projectDetail.documents.action.delete', 'Delete')}
        </Button>
      )}
    </>
  );
};

const DocumentPreviewFields: React.FC<DocumentPreviewProps & { statusHeadingLevel: 2 | 4 }> = ({
  doc,
  parentDoc,
  childDoc,
  transitions,
  sodBlocked,
  onViewDocument,
  fileContent,
  microsoftFile,
  statusHeadingLevel,
}) => {
  const { t } = useTranslation('project');
  const isFolder = isMicrosoftFolder(doc);
  const StatusHeading = statusHeadingLevel === 2 ? 'h2' : 'h4';
  return (
    <>
      <dl className="flex flex-col gap-4">
        {!isFolder && doc.revision && (
          <DocField label={t('projectDetail.documents.field.revision', 'Revision')}>
            {`${t('projectDetail.documents.revLabel', 'Rev')} ${doc.revision}`}
          </DocField>
        )}
        {!isFolder && (
          <>
            {/* C4: empty fields are left out, never shown as "—". */}
            {doc.code && <DocField label={t('projectDetail.documents.field.code', 'Code')}>
              <span className="font-mono text-[13px]">{doc.code}</span>
            </DocField>}
            <DocField label={t('projectDetail.documents.field.category', 'Category')}>
              {doc.category || t('projectDetail.documents.category.uncategorized', 'Uncategorized')}
            </DocField>
            {doc.doc_date && <DocField label={t('projectDetail.documents.field.docDate', 'Document date')}>
              <span className="tabular-nums">{formatDateOnly(doc.doc_date)}</span>
            </DocField>}
          </>
        )}
        {parentDoc?.revision && (
          <DocField label={t('projectDetail.documents.field.lineage', 'Revision lineage')}>
            <LineageButton revision={parentDoc.revision} title={doc.title} direction="back" onClick={() => onViewDocument(parentDoc)} />
          </DocField>
        )}
        {doc.status === 'Superseded' && childDoc?.revision && (
          <DocField label={t('projectDetail.documents.field.supersededBy', 'Superseded by')}>
            <LineageButton revision={childDoc.revision} title={doc.title} direction="forward" onClick={() => onViewDocument(childDoc)} />
          </DocField>
        )}
        {microsoftFile && (
          <DocField label={t('projectDetail.documents.field.microsoft', 'Microsoft 365 item')}>
            {microsoftFile}
          </DocField>
        )}
        {fileContent && <DocField label={t('projectDetail.documents.field.file', 'File')}>
          {fileContent}
        </DocField>}
      </dl>

      {(transitions.length > 0 || sodBlocked) && (
        <div className="mt-5 border-t border-border pt-4">
          <StatusHeading className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {t('projectDetail.documents.updateStatus', 'Update status')}
          </StatusHeading>
          {sodBlocked ? (
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
              {transitions.map((action) => (
                <Button
                  key={action.label}
                  size="sm"
                  variant={action.danger ? 'destructive' : 'outline'}
                  onClick={action.onClick}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};

interface DocumentDrawerProps extends DocumentPreviewProps, DocumentActionFooterProps {
  fullRecordHref: string;
  nestedOpen: boolean;
  onClose: () => void;
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
  hasFile,
  sharePointUrl,
  fullRecordHref,
  nestedOpen,
  onClose,
  onEdit,
  onDelete,
  onViewDocument,
  onDownload,
  fileContent,
  microsoftFile,
}) => {
  const isFolder = isMicrosoftFolder(doc);
  const [primaryTransition, ...secondaryTransitions] = transitions;

  return (
    <Drawer
      open
      title={doc.title}
      status={!isFolder ? <StatusPill variant={workflowVariant(doc.status)}>{doc.status}</StatusPill> : undefined}
      headerActions={<DocumentHeaderActions primaryAction={primaryTransition} fullRecordHref={fullRecordHref} />}
      nestedOpen={nestedOpen}
      onClose={onClose}
      footer={<DocumentActionFooter
        canEdit={canEdit}
        canDelete={canDelete}
        hasFile={hasFile}
        sharePointUrl={sharePointUrl}
        onEdit={onEdit}
        onDelete={onDelete}
        onDownload={onDownload}
      />}
    >
      <DocumentPreviewFields statusHeadingLevel={2} doc={doc} parentDoc={parentDoc} childDoc={childDoc} transitions={secondaryTransitions} sodBlocked={sodBlocked} onViewDocument={onViewDocument} fileContent={fileContent} microsoftFile={microsoftFile} />
    </Drawer>
  );
};

const DocumentPreviewPanel: React.FC<DocumentDrawerProps> = ({
  doc,
  parentDoc,
  childDoc,
  transitions,
  sodBlocked,
  canEdit,
  canDelete,
  hasFile,
  sharePointUrl,
  fullRecordHref,
  nestedOpen,
  onClose,
  onEdit,
  onDelete,
  onViewDocument,
  onDownload,
  fileContent,
  microsoftFile,
}) => {
  const { t } = useTranslation('project');
  const isFolder = isMicrosoftFolder(doc);
  const [primaryTransition, ...secondaryTransitions] = transitions;
  return (
    <aside
      aria-labelledby="document-preview-title"
      aria-hidden={nestedOpen || undefined}
      inert={nestedOpen || undefined}
      className="flex min-h-[440px] min-w-0 flex-col rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5">
        <div className="min-w-0">
          <h3 id="document-preview-title" className="break-words text-base font-semibold text-foreground">{doc.title}</h3>
          {!isFolder && <div className="mt-1.5"><StatusPill variant={workflowVariant(doc.status)}>{doc.status}</StatusPill></div>}
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <DocumentHeaderActions primaryAction={primaryTransition} fullRecordHref={fullRecordHref} />
          <Button variant="ghost" iconOnly aria-label={t('projectDetail.documents.action.closePreview', 'Close preview')} onClick={onClose}>
            <Icon name="x" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <DocumentPreviewFields statusHeadingLevel={4} doc={doc} parentDoc={parentDoc} childDoc={childDoc} transitions={secondaryTransitions} sodBlocked={sodBlocked} onViewDocument={onViewDocument} fileContent={fileContent} microsoftFile={microsoftFile} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3.5">
        <DocumentActionFooter canEdit={canEdit} canDelete={canDelete} hasFile={hasFile} sharePointUrl={sharePointUrl} onEdit={onEdit} onDelete={onDelete} onDownload={onDownload} />
      </div>
    </aside>
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
  const { t } = useTranslation('project');
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
  const { t } = useTranslation('project');
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
