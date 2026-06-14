import React, { useEffect, useMemo, useState } from 'react';
import {
  Toolbar,
  SearchMini,
  ViewToggle,
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
  AccessDenied,
  useEntityForm,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { ExportButton } from '@/src/components/export';
import { ImportButton } from '@/src/components/import';
import { companyImportDescriptor } from '@/src/lib/import';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePermission } from '@/src/auth/usePermission';
import { useCompanies, useCompanyMutations } from '@/src/hooks/useCompanies';
import { useContactsByCompany } from '@/src/hooks/useContacts';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { CompanyRow, CompanyType, CompanyInput } from '@/src/lib/db/companies';
import { companyTypeVariant } from '@/src/lib/status/statusVariants';

/** Type filter segments: All + the three company_type enum values (Internal / Client / Vendor). */
type TypeFilter = 'All' | CompanyType;
const TYPE_FILTERS: TypeFilter[] = ['All', 'Internal', 'Client', 'Vendor'];

// Company-type pill comes from the single status registry's CATEGORY family
// (`companyTypeVariant`): Client = categorical `violet` (the highlighted type),
// Vendor / Internal = `neutral`. Per the Freed-Blue Status Rule, a type pill never
// uses the action-blue (`open`) and never borrows a workflow tint (`won`/`lost`);
// the distinct LABEL carries identity, so the types read apart by label + dot.

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
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useCompanies();
  const { create, update, archive, remove } = useCompanyMutations();

  // A-5 (rbac-visibility §D): Companies directory view = Admin·Exec·PM·Finance; Engineer = ○
  // (no nav, no page). The rail hides it but the ROUTE does not — so an Engineer reaching
  // /companies by URL gets a clean access-denied surface, not the master-data directory. RLS
  // is the authority for the rows; this is FE clarity.
  const canView = may('view', 'company');

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TypeFilter>('All');

  // Modal: null = closed; { company: null } = create; { company } = edit.
  const [formTarget, setFormTarget] = useState<{ company: CompanyRow | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CompanyRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanyRow | null>(null);
  // In-use delete block (23503): the company whose hard-delete the RPC refused
  // because it is still referenced. Drives the inline GateNotice + Archive-instead
  // recovery path (crud-components §5.3).
  const [blockedCompany, setBlockedCompany] = useState<CompanyRow | null>(null);
  // D11: the company shown in the read-first quick-view Drawer (the in-hand row;
  // no extra fetch). Row activation opens it; footer entry points reuse the
  // existing form/archive/delete setters.
  const [drawerCompany, setDrawerCompany] = useState<CompanyRow | null>(null);

  const canCreate = may('create', 'company');
  const canEdit = may('edit', 'company');
  const canArchive = may('archive', 'company');
  const canDelete = may('delete', 'company');
  const canRowWrite = canEdit || canArchive || canDelete;

  const all = useMemo(() => data ?? [], [data]);

  // CW-7: ⌘K deep-link interim. A `?focus=<id>` param (set by the command palette until the
  // `/companies/:id` page lands, plan §4) opens that record's quick-view drawer once the list is
  // loaded, then clears the param so a refresh/back doesn't re-trigger it. RLS already scoped the
  // cache, so a focus id the viewer can't see simply finds no row (no leak).
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  useEffect(() => {
    if (!focusId || !canView) return;
    const match = all.find((c) => c.id === focusId);
    if (match) setDrawerCompany(match);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('focus');
        return next;
      },
      { replace: true },
    );
  }, [focusId, all, canView, setSearchParams]);

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

  // A-5 page view-gate (after all hooks — Rules of Hooks): a denied role (Engineer) gets the
  // shared access-denied surface, not the directory.
  if (!canView) {
    return (
      <AccessDenied
        title="You don't have access to Companies"
        sub="The company directory is shared master data for managers and finance. Your work lives on your dashboard, projects, and tasks."
        onBack={() => navigate('/')}
      />
    );
  }

  const columns: Column<CompanyRow>[] = [
    {
      key: 'name',
      header: 'Company',
      cell: (c) => (
        <span className="truncate font-semibold" title={c.name}>
          {c.name}
        </span>
      ),
      exportValue: (c) => c.name,
    },
    {
      key: 'type',
      header: 'Type',
      cell: (c) => <StatusPill variant={companyTypeVariant(c.type)}>{c.type}</StatusPill>,
      exportValue: (c) => c.type,
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
      setBlockedCompany(null);
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
      // A referenced company also renders a persistent inline GateNotice (the toast
      // auto-dismisses; the gate keeps the recovery path within reach).
      setBlockedCompany(isInUse ? target : null);
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

      {/* In-use delete block (23503) — inline GateNotice with an Archive-instead
          recovery path. Persists until the user archives or dismisses it. */}
      {blockedCompany && (
        <GateNotice variant="blocked" className="mb-3.5" data-testid="company-delete-gate">
          <div>
            <b className="font-semibold">{blockedCompany.name}</b> is referenced by other
            records and can&rsquo;t be deleted. Archive it instead to remove it from new records
            while keeping the audit trail.
            <div className="mt-2.5 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setArchiveTarget(blockedCompany);
                  setBlockedCompany(null);
                }}
              >
                Archive instead
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setBlockedCompany(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        </GateNotice>
      )}

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
            // Below `sm` the toolbar stacks: `basis-full` forces the search onto
            // its own full-width row and `min-w-0` drops the base min-w-[190px]
            // clip, so it shrinks to the viewport and stays reachable at 375px. At
            // `sm`+ it right-aligns at its natural width (ml-auto).
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
          <ExportButton rows={filtered} columns={columns} entity="Companies" />
          {/* Bulk import (ADR-0027): role-gated via can('create','company'); reuses the
              entity's create repository so RLS stamps org_id + gates the write role. On a
              successful import the wizard close refetches the list. */}
          <ImportButton
            entity="company"
            descriptor={companyImportDescriptor}
            onImported={() => void refetch()}
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
          onActivate={(c) => setDrawerCompany(c)}
          rowLabel={(c) => `View ${c.name}`}
          rowMenu={canRowWrite ? rowMenu : undefined}
          selectedKey={drawerCompany?.id}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle="No companies match your filters"
          emptySub="Try a different type or clear the search."
        />
      )}

      {/* D11: read-first quick-view drawer (the in-hand row — no extra fetch). */}
      <CompanyDrawer
        company={drawerCompany}
        canEdit={canEdit}
        canArchive={canArchive}
        canDelete={canDelete}
        onClose={() => setDrawerCompany(null)}
        onTypeChange={async (next) => {
          if (!drawerCompany) return;
          const target = drawerCompany;
          try {
            await update.mutateAsync({ id: target.id, input: { name: target.name, type: next } });
            // Optimistic pill update so the drawer reflects the new type immediately
            // (the list re-fetch follows). OD-UX-1: routine reversible write → toast,
            // no ConfirmDialog.
            setDrawerCompany({ ...target, type: next });
            toast('Company updated', `${target.name} is now ${next}`, 'success');
          } catch (err) {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }
        }}
        typeChanging={update.isPending}
        onEdit={() => {
          // Close the drawer first, THEN open the form modal — never two
          // focus-traps stacked (secondary Director decision).
          const c = drawerCompany;
          setDrawerCompany(null);
          if (c) setFormTarget({ company: c });
        }}
        onArchive={() => {
          const c = drawerCompany;
          setDrawerCompany(null);
          if (c) setArchiveTarget(c);
        }}
        onDelete={() => {
          const c = drawerCompany;
          setDrawerCompany(null);
          if (c) setDeleteTarget(c);
        }}
      />

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

// ── FR-CRM-008: company's non-archived contacts list ─────────────────────────

/**
 * Read-only contacts list for the company quick-view Drawer. Consumes the
 * pre-wired `useContactsByCompany` hook (AC-CRM-021). Handles loading,
 * empty ("No contacts yet"), and populated states. No write affordances here
 * — YAGNI; the Contacts page owns create/edit/archive.
 */
const CompanyContactsList: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { data, isPending } = useContactsByCompany(companyId);

  if (isPending) {
    return (
      <p
        role="status"
        aria-label="Loading contacts"
        className="text-[13px] text-muted-foreground"
      >
        Loading…
      </p>
    );
  }

  const contacts = data ?? [];

  if (contacts.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">No contacts yet</p>
    );
  }

  return (
    <ul className="flex flex-col gap-2" aria-label="Contacts list">
      {contacts.map((c) => (
        <li key={c.id} className="flex flex-col gap-0.5">
          <span className="text-[14px] font-medium text-foreground">{c.full_name}</span>
          {c.title && (
            <span className="text-[12px] text-muted-foreground">{c.title}</span>
          )}
        </li>
      ))}
    </ul>
  );
};

// ── D11: read-first quick-view drawer ────────────────────────────────────────

interface CompanyDrawerProps {
  /** null = closed. The in-hand CompanyRow (no extra fetch). */
  company: CompanyRow | null;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  onClose: () => void;
  /** Inline type change — routine reversible write (OD-UX-1: toast, no confirm). */
  onTypeChange: (next: CompanyType) => Promise<void>;
  typeChanging: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

/** Definition-list row — label (overline voice) + value. */
const DField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-1">
    <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
      {label}
    </dt>
    <dd className="text-[14px] text-foreground">{children}</dd>
  </div>
);

const CompanyDrawer: React.FC<CompanyDrawerProps> = ({
  company,
  canEdit,
  canArchive,
  canDelete,
  onClose,
  onTypeChange,
  typeChanging,
  onEdit,
  onArchive,
  onDelete,
}) => {
  const typeSelectId = React.useId();
  if (!company) return null;

  const hasFooter = canEdit || canArchive || canDelete;

  return (
    <Drawer
      open
      title={company.name}
      subtitle={<StatusPill variant={companyTypeVariant(company.type)}>{company.type}</StatusPill>}
      loading={typeChanging}
      onClose={onClose}
      footer={
        hasFooter ? (
          <>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={onEdit}>
                Edit
              </Button>
            )}
            {canArchive && (
              <Button variant="ghost" size="sm" onClick={onArchive}>
                Archive
              </Button>
            )}
            {canDelete && (
              <Button variant="destructive" size="sm" className="ml-auto" onClick={onDelete}>
                Delete
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <dl className="flex flex-col gap-4">
        <DField label="Name">{company.name}</DField>
        <DField label="Type">
          {canEdit ? (
            // OD-UX-1: company type is master-data classification, not an SoD
            // workflow → a single-click change + toast, NO ConfirmDialog. On
            // !canEdit the value renders as the read-only pill (below).
            <SelectField
              id={typeSelectId}
              label="Type"
              hideLabel
              value={company.type}
              onChange={(v) => void onTypeChange(v as CompanyType)}
              options={TYPE_OPTIONS}
              disabled={typeChanging}
            />
          ) : (
            <StatusPill variant={companyTypeVariant(company.type)}>{company.type}</StatusPill>
          )}
        </DField>
        {/* FR-CRM-008: read-only contacts section (non-archived, fed by useContactsByCompany). */}
        <DField label="Contacts">
          <CompanyContactsList companyId={company.id} />
        </DField>
      </dl>
    </Drawer>
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
    // F8 (AC-IXD-FORM-F8): submit stays disabled until the required name is present.
    requiredFields: ['name'],
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
      submitDisabled={!form.isComplete}
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
