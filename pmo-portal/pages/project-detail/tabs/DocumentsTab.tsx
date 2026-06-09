import React, { useMemo, useState } from 'react';
import {
  Toolbar,
  SearchMini,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
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
  type StatusVariant,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useDocuments, useDocumentMutations } from '@/src/hooks/useDocuments';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type {
  ProjectDocumentRow,
  ProjectDocumentInput,
  DocStatus,
} from '@/src/lib/db/documents';

export interface DocumentsTabProps {
  projectId: string;
}

/**
 * Per-project DOCUMENT REGISTER (metadata only — Storage is disabled, so there is no file
 * upload; the "Attach file" affordance is a disabled placeholder until Storage returns).
 * Replaces the deferred placeholder with a real CRUD + status-workflow register, applying
 * crud-components §9.9 / rbac-visibility §H + the Companies slice template.
 *
 * Status workflow: Draft → Issued → Approved / Rejected → Closed. The Approve/Reject step is
 * SoD-gated (approver ≠ author): the document's author can never approve their own document.
 * Gating reads the REAL JWT role + the current user id; RLS is the enforcement authority.
 */

/**
 * Tinted-status pill per doc_status — DESIGN.md variants (dot + label, never color-only):
 * Draft = quiet neutral; Issued = blue (in review); Approved = green; Rejected = red;
 * Closed = neutral (terminal/archived).
 */
const STATUS_PILL: Record<DocStatus, StatusVariant> = {
  Draft: 'draft',
  Issued: 'open',
  Approved: 'won',
  Rejected: 'lost',
  Closed: 'neutral',
};

/** The category list (short fixed enum → native SelectField). */
const CATEGORY_OPTIONS = [
  { value: 'Drawing', label: 'Drawing' },
  { value: 'Specification', label: 'Specification' },
  { value: 'Report', label: 'Report' },
  { value: 'Transmittal', label: 'Transmittal' },
  { value: 'Submittal', label: 'Submittal' },
  { value: 'Certificate', label: 'Certificate' },
  { value: 'Other', label: 'Other' },
];

interface FormValues {
  title: string;
  code: string;
  category: string;
  revision: string;
  doc_date: string;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.title.trim()) errors.title = 'Title is required.';
  if (!v.category.trim()) errors.category = 'Category is required.';
  return errors;
};

/** A pending status transition launched from a row. */
interface PendingTransition {
  doc: ProjectDocumentRow;
  to: DocStatus;
  /** Confirm button verb, e.g. "Issue document". */
  verb: string;
}

const DocumentsTab: React.FC<DocumentsTabProps> = ({ projectId }) => {
  const may = usePermission();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useDocuments(projectId);
  const { create, update, transition, remove } = useDocumentMutations(projectId);

  const [search, setSearch] = useState('');

  // Modal: null = closed; { doc: null } = create; { doc } = edit.
  const [formTarget, setFormTarget] = useState<{ doc: ProjectDocumentRow | null } | null>(null);
  const [pending, setPending] = useState<PendingTransition | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectDocumentRow | null>(null);
  // The author who tried to act on their own Issued document (SoD block) — drives the
  // inline GateNotice that explains why Approve/Reject is unavailable.
  const [sodBlocked, setSodBlocked] = useState<ProjectDocumentRow | null>(null);

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

  const all = useMemo(() => (data ?? []) as ProjectDocumentRow[], [data]);

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
      key: 'code',
      header: 'Code',
      colClassName: 'hidden sm:table-cell',
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
      key: 'title',
      header: 'Document',
      cell: (d) => (
        <div className="min-w-0">
          <span className="block truncate font-semibold" title={d.title}>
            {d.title}
          </span>
          {d.revision && (
            <span className="text-[12px] text-muted-foreground">Rev {d.revision}</span>
          )}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      colClassName: 'hidden md:table-cell',
      cell: (d) => <span className="text-[13px] text-muted-foreground">{d.category}</span>,
    },
    {
      key: 'doc_date',
      header: 'Date',
      colClassName: 'hidden lg:table-cell',
      cell: (d) =>
        d.doc_date ? (
          <span className="tabular text-[13px] text-muted-foreground">{d.doc_date}</span>
        ) : (
          <span className="text-muted-foreground">{'—'}</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (d) => <StatusPill variant={STATUS_PILL[d.status]}>{d.status}</StatusPill>,
    },
  ];

  /** The status actions available on a row, per the workflow + SoD + role gates. */
  const statusActions = (d: ProjectDocumentRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    // Draft → Issued (a non-approval move: any document write-role).
    if (d.status === 'Draft' && canWriteDocs) {
      items.push({ label: 'Issue', onClick: () => setPending({ doc: d, to: 'Issued', verb: 'Issue document' }) });
    }
    // Issued → Approved / Rejected (the SoD step: approver must NOT be the author).
    if (d.status === 'Issued' && canApprove) {
      if (isOwnDocument(d)) {
        // Author of their own document: the approve/reject path is hidden; expose the reason.
        items.push({ label: 'Why is review unavailable?', onClick: () => setSodBlocked(d) });
      } else {
        items.push({ label: 'Approve', onClick: () => setPending({ doc: d, to: 'Approved', verb: 'Approve document' }) });
        items.push({ label: 'Reject', onClick: () => setPending({ doc: d, to: 'Rejected', verb: 'Reject document' }), danger: true });
      }
    }
    // Approved → Closed (terminal close-out: any document write-role).
    if (d.status === 'Approved' && canWriteDocs) {
      items.push({ label: 'Close', onClick: () => setPending({ doc: d, to: 'Closed', verb: 'Close document' }) });
    }
    // Rejected → Draft (rework path) / Rejected → Closed (abandon path). AC-W3-B2.
    // These are non-approval moves (same gate as Draft→Issued / Approved→Closed: canWriteDocs).
    // The SoD approver≠author rule applies only to the Issued→Approved/Rejected step; not here.
    if (d.status === 'Rejected' && canWriteDocs) {
      items.push({ label: 'Reopen for revision', onClick: () => setPending({ doc: d, to: 'Draft', verb: 'Reopen for revision' }) });
      items.push({ label: 'Close', onClick: () => setPending({ doc: d, to: 'Closed', verb: 'Close document' }) });
    }
    return items;
  };

  const rowMenu = (d: ProjectDocumentRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    // Edit metadata while not yet terminal (Draft/Issued/Rejected can still be corrected) AND
    // only for the AUTHOR (or Admin break-glass) — A-7 author rule (rbac-visibility §H).
    if (canEditDoc(d) && d.status !== 'Closed') {
      items.push({ label: 'Edit', onClick: () => setFormTarget({ doc: d }) });
    }
    items.push(...statusActions(d));
    if (canDelete) items.push({ label: 'Delete', onClick: () => setDeleteTarget(d), danger: true });
    return items;
  };

  const anyRowWrite = canWriteDocs || canDelete || canApprove;

  const onTransitionConfirm = async () => {
    if (!pending) return;
    const { doc, to } = pending;
    try {
      await transition.mutateAsync({ id: doc.id, status: to });
      toast(`Document ${to.toLowerCase()}`, doc.title, 'success');
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
      toast('Document deleted', target.title, 'success');
      setDeleteTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-bold tracking-[-0.01em]">Document register</h2>
          <p className="mt-0.5 max-w-[64ch] text-[13px] text-muted-foreground">
            Drawings, specifications, and transmittals for this project. Metadata is tracked
            here; file attachments arrive with Storage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* D13 (OD-W2-5 honest-affordance): the dead disabled "Attach file (coming soon)"
              button was removed — file upload is signposted by the register subtitle copy
              ("file attachments arrive with Storage"), not a fake disabled control. */}
          {canCreate && (
            <Button variant="primary" size="sm" onClick={() => setFormTarget({ doc: null })}>
              <Icon name="plus" />
              Add document
            </Button>
          )}
        </div>
      </div>

      {/* SoD block (approver = author): persistent inline reason for a hidden Approve/Reject. */}
      {sodBlocked && (
        <GateNotice variant="blocked" className="mb-3.5" data-testid="document-sod-gate">
          <div>
            You can't approve your own document (<b className="font-semibold">{sodBlocked.title}</b>).
            Approving a document is a segregation-of-duties step, so a different reviewer must
            approve or reject it.
            <div className="mt-2.5">
              <Button variant="ghost" size="sm" onClick={() => setSodBlocked(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        </GateNotice>
      )}

      {state !== 'loading' && all.length > 0 && (
        <Toolbar standalone>
          {/* Left-aligned count anchors the toolbar (matches the Admin Users pattern,
              polish #6) so the bar no longer reads as dead space beside the search. */}
          <span data-testid="documents-count" className="text-[13px] font-semibold tabular">
            {all.length} {all.length === 1 ? 'document' : 'documents'}
          </span>
          <SearchMini
            placeholder="Search documents…"
            aria-label="Search documents"
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
          title="Couldn't load documents"
          sub="The request failed. Check your connection and try again."
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="doc"
          title="No documents yet"
          sub="Add a drawing, specification, or transmittal to start the project's document register."
          action={
            canCreate ? { label: 'Add document', onClick: () => setFormTarget({ doc: null }) } : undefined
          }
        />
      )}

      {state === undefined && (
        <DataTable<ProjectDocumentRow>
          rows={filtered}
          columns={columns}
          rowKey={(d) => d.id}
          rowMenu={anyRowWrite ? rowMenu : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle="No documents match your search"
          emptySub="Try a different title, code, or category."
        />
      )}

      {/* Create / edit metadata modal */}
      {formTarget && (
        <DocumentFormModal
          doc={formTarget.doc}
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
            toast('Document added', input.title, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast('Document updated', input.title, 'success');
            setFormTarget(null);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      {/* Status transition confirm (default tone; Reject reads as destructive). */}
      <ConfirmDialog
        open={!!pending}
        tone={pending?.to === 'Rejected' ? 'destructive' : 'default'}
        title={pending ? `${pending.verb.replace(/ document$/, '')} ${pending.doc.title}?` : 'Update status?'}
        description={
          pending?.to === 'Approved'
            ? 'Approving records you as the reviewer. This is a segregation-of-duties step and is recorded.'
            : pending?.to === 'Rejected'
              ? 'Rejecting returns the document for revision. This is recorded.'
              : pending?.to === 'Issued'
                ? 'Issuing moves the document into review so a reviewer can approve or reject it.'
                : 'Closing finalises the document. This is a terminal status.'
        }
        confirmLabel={pending?.verb ?? 'Update status'}
        loading={transition.isPending}
        onConfirm={onTransitionConfirm}
        onCancel={() => setPending(null)}
      />

      {/* Delete confirm (destructive tone; Admin only). */}
      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={deleteTarget ? `Delete ${deleteTarget.title}?` : 'Delete document?'}
        description="This permanently removes the document register entry. This can't be undone."
        confirmLabel="Delete document"
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
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
  const isEdit = !!doc;
  const form = useEntityForm<FormValues>({
    initialValues: {
      title: doc?.title ?? '',
      code: doc?.code ?? '',
      category: doc?.category ?? 'Drawing',
      revision: doc?.revision ?? '',
      doc_date: doc?.doc_date ?? '',
    },
    validate,
    idPrefix: 'document-form',
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
      title={isEdit ? 'Edit document' : 'Add document'}
      subtitle={
        isEdit
          ? 'Update this register entry'
          : 'Record a drawing, specification, or transmittal. File upload arrives with Storage.'
      }
      submitLabel={isEdit ? 'Save document' : 'Add document'}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      <FormSection legend="Document">
        <FormGrid>
          <TextField
            id={titleField.id}
            label="Title"
            required
            value={titleField.value}
            onChange={titleField.onChange}
            onBlur={titleField.onBlur}
            error={titleField.error}
            placeholder="e.g. Foundation general arrangement"
            fullWidth
          />
          <TextField
            id={codeField.id}
            label="Code"
            mono
            value={codeField.value}
            onChange={codeField.onChange}
            onBlur={codeField.onBlur}
            placeholder="e.g. DWG-001"
            helper="Optional document number or drawing code."
          />
          <SelectField
            id={categoryField.id}
            label="Category"
            required
            value={categoryField.value}
            onChange={categoryField.onChange}
            onBlur={categoryField.onBlur}
            error={categoryField.error}
            options={CATEGORY_OPTIONS}
          />
          <TextField
            id={revisionField.id}
            label="Revision"
            value={revisionField.value}
            onChange={revisionField.onChange}
            onBlur={revisionField.onBlur}
            placeholder="e.g. A"
          />
          <TextField
            id={dateField.id}
            label="Document date"
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
