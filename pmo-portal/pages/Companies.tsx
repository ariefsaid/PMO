import React, { useMemo, useState } from 'react';
import {
  Toolbar,
  SearchMini,
  ViewToggle,
  ListState,
  DataTable,
  StatusPill,
  ConfirmDialog,
  EntityFormModal,
  TextField,
  SelectField,
  FormSection,
  FormGrid,
  useEntityForm,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
  type StatusVariant,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useCompanies, useCompanyMutations } from '@/src/hooks/useCompanies';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { CompanyRow, CompanyType, CompanyInput } from '@/src/lib/db/companies';

/** Type filter segments: All + the three company_type enum values (Internal / Client / Vendor). */
type TypeFilter = 'All' | CompanyType;
const TYPE_FILTERS: TypeFilter[] = ['All', 'Internal', 'Client', 'Vendor'];

/** Tinted-status pill per company_type — quiet neutral tints, label carries identity. */
const TYPE_PILL: Record<CompanyType, StatusVariant> = {
  Client: 'open',
  Vendor: 'progress',
  Internal: 'neutral',
};

const TYPE_OPTIONS = [
  { value: 'Client', label: 'Client' },
  { value: 'Vendor', label: 'Vendor' },
  { value: 'Internal', label: 'Internal' },
];

interface FormValues {
  name: string;
  type: CompanyType;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.name.trim()) errors.name = 'Company name is required.';
  return errors;
};

const Companies: React.FC = () => {
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useCompanies();
  const { create, update, archive, remove } = useCompanyMutations();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TypeFilter>('All');

  // Modal: null = closed; { company: null } = create; { company } = edit.
  const [formTarget, setFormTarget] = useState<{ company: CompanyRow | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CompanyRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanyRow | null>(null);

  const canCreate = may('create', 'company');
  const canEdit = may('edit', 'company');
  const canArchive = may('archive', 'company');
  const canDelete = may('delete', 'company');
  const canRowWrite = canEdit || canArchive || canDelete;

  const all = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((c) => filter === 'All' || c.type === filter)
      .filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [all, search, filter]);

  // ── States ──────────────────────────────────────────────────────────────
  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  const columns: Column<CompanyRow>[] = [
    {
      key: 'name',
      header: 'Company',
      cell: (c) => (
        <span className="truncate font-semibold" title={c.name}>
          {c.name}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (c) => <StatusPill variant={TYPE_PILL[c.type]}>{c.type}</StatusPill>,
    },
  ];

  const rowMenu = (c: CompanyRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canEdit) items.push({ label: 'Edit', onClick: () => setFormTarget({ company: c }) });
    if (canArchive) items.push({ label: 'Archive', onClick: () => setArchiveTarget(c) });
    if (canDelete) items.push({ label: 'Delete', onClick: () => setDeleteTarget(c), danger: true });
    return items;
  };

  const onArchiveConfirm = async () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    try {
      await archive.mutateAsync(target.id);
      toast('Company archived', target.name, 'success');
      setArchiveTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await remove.mutateAsync(target.id);
      toast('Company deleted', target.name, 'success');
      setDeleteTarget(null);
    } catch (err) {
      // Centralized classification (ADR-0017): 23503 foreign_key_violation (referenced by
      // projects/procurements/profiles) → "Still in use"; for that case surface the recovery
      // path (Archive instead) as the detail rather than the verbatim FK message.
      const { headline, detail } = classifyMutationError(err);
      const isInUse = (err as { code?: string })?.code === '23503';
      toast(
        headline,
        isInUse
          ? `${target.name} is referenced by other records and can't be deleted. Archive it instead to keep the audit trail.`
          : detail,
        'warning',
      );
      setDeleteTarget(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">Companies</h1>
          <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">
            Clients and vendors used across projects and procurement. Master data shared by the
            whole organisation.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ company: null })}>
            <Icon name="plus" />
            New company
          </Button>
        )}
      </div>

      {/* Toolbar */}
      {state !== 'loading' && (
        <Toolbar standalone>
          <ViewToggle<TypeFilter>
            options={TYPE_FILTERS.map((f) => ({ value: f, label: f }))}
            value={filter}
            onChange={setFilter}
            ariaLabel="Filter by type"
          />
          <SearchMini
            placeholder="Search companies…"
            aria-label="Search companies"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="ml-auto"
          />
        </Toolbar>
      )}

      {/* Body */}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title="Couldn't load companies"
          sub="The request failed. Check your connection and try again."
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="folder"
          title="No companies yet"
          sub="Add your first client or vendor to start linking projects and purchase requests to a directory."
          action={
            canCreate ? { label: 'New company', onClick: () => setFormTarget({ company: null }) } : undefined
          }
        />
      )}

      {state === undefined && (
        <DataTable<CompanyRow>
          rows={filtered}
          columns={columns}
          rowKey={(c) => c.id}
          rowMenu={canRowWrite ? rowMenu : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle="No companies match your filters"
          emptySub="Try a different type or clear the search."
        />
      )}

      {/* Create / edit modal */}
      {formTarget && (
        <CompanyFormModal
          company={formTarget.company}
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
            toast('Company created', input.name, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast('Company updated', input.name, 'success');
            setFormTarget(null);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      {/* Archive confirm (default tone) */}
      <ConfirmDialog
        open={!!archiveTarget}
        tone="default"
        title={archiveTarget ? `Archive ${archiveTarget.name}?` : 'Archive company?'}
        description="It will be hidden from the default list and can't be selected on new records. Existing references stay intact. You can restore it any time."
        confirmLabel="Archive company"
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />

      {/* Delete confirm (destructive tone) */}
      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : 'Delete company?'}
        description="This permanently removes the company. A company referenced by projects or procurements can't be deleted; archive it instead."
        confirmLabel="Delete company"
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

// ── Create / edit form modal ────────────────────────────────────────────────

interface CompanyFormModalProps {
  company: CompanyRow | null;
  onClose: () => void;
  onCreate: (input: CompanyInput) => Promise<void>;
  onUpdate: (id: string, input: CompanyInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const CompanyFormModal: React.FC<CompanyFormModalProps> = ({
  company,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const isEdit = !!company;
  const form = useEntityForm<FormValues>({
    initialValues: { name: company?.name ?? '', type: company?.type ?? 'Client' },
    validate,
    idPrefix: 'company-form',
  });

  const nameField = form.fieldProps('name');
  const typeField = form.fieldProps('type');

  const errorSummary = form.errors.name
    ? [{ fieldId: nameField.id, message: form.errors.name }]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: CompanyInput = { name: values.name.trim(), type: values.type };
      try {
        if (isEdit && company) await onUpdate(company.id, input);
        else await onCreate(input);
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={isEdit ? 'Edit company' : 'New company'}
      subtitle={isEdit ? 'Update this company record' : 'Add a client or vendor to the directory'}
      submitLabel={isEdit ? 'Save company' : 'Create company'}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      errorSummary={errorSummary}
    >
      <FormSection legend="Identity">
        <FormGrid>
          <TextField
            id={nameField.id}
            label="Company name"
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder="e.g. Cascade Port Authority"
            autoComplete="organization"
            fullWidth
          />
          <SelectField
            id={typeField.id}
            label="Type"
            required
            value={typeField.value}
            onChange={(v) => typeField.onChange(v as CompanyType)}
            onBlur={typeField.onBlur}
            options={TYPE_OPTIONS}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default Companies;
