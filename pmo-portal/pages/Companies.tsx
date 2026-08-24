import React, { useMemo, useState } from 'react';
import {
  ListPage,
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
  GateNotice,
  AccessDenied,
  useEntityForm,
  useToast,
  Button,
  Icon,
  type SubmitError,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { ExportButton } from '@/src/components/export';
import { ImportButton } from '@/src/components/import';
import { companyImportDescriptor } from '@/src/lib/import';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useCompanies, useCompanyMutations } from '@/src/hooks/useCompanies';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import type { CompanyRow, CompanyType, CompanyInput } from '@/src/lib/db/companies';
import { companyTypeVariant } from '@/src/lib/status/statusVariants';
import { TaskPushBadge } from '@/src/components/tasks/TaskPushBadge';
import { IDLE_PENDING_PUSH, type PendingPushState } from '@/src/lib/adapterSeam/pendingPush';

/** Type filter segments: All + the three company_type enum values (Internal / Client / Vendor). */
type TypeFilter = 'All' | CompanyType;
const TYPE_FILTERS: TypeFilter[] = ['All', 'Internal', 'Client', 'Vendor'];

// Company-type pill comes from the single status registry's CATEGORY family
// (`companyTypeVariant`): Client = categorical `violet` (the highlighted type),
// Vendor / Internal = `neutral`. Per the Freed-Blue Status Rule, a type pill never
// uses the action-blue (`open`) and never borrows a workflow tint (`won`/`lost`);
// the distinct LABEL carries identity, so the types read apart by label + dot.

/**
 * The display label for each `company_type` value, resolved once per render. The VALUE is the
 * database enum and is never translated (it is filter state, an export cell, and a policy input);
 * only the label a person reads is. One map so the filter segment, the form's Type select and the
 * row pill can never drift into three different words for the same type.
 */
const typeLabels = (t: TFunction): Record<CompanyType, string> => ({
  Client: t('companies.type.client', 'Client'),
  Vendor: t('companies.type.vendor', 'Vendor'),
  Internal: t('companies.type.internal', 'Internal'),
});

interface FormValues {
  name: string;
  type: CompanyType;
}

/**
 * `t` has to be threaded in: the message is user-visible, and a module-level literal cannot reach
 * the active locale. The validation SHAPE is unchanged — same fields, same trigger, same keys.
 */
const makeValidate =
  (t: TFunction) =>
  (v: FormValues): Partial<Record<keyof FormValues, string>> => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    if (!v.name.trim())
      errors.name = t('companies.form.errors.nameRequired', 'Company name is required.');
    return errors;
  };

const Companies: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useCompanies();
  // `?? IDLE_PENDING_PUSH` — existing hook mocks (RBAC/export test suites) predate this field.
  const { create, update, archive, remove, pendingPush = IDLE_PENDING_PUSH } = useCompanyMutations();

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

  const canCreate = may('create', 'company');
  const canEdit = may('edit', 'company');
  const canArchive = may('archive', 'company');
  const canDelete = may('delete', 'company');
  const canRowWrite = canEdit || canArchive || canDelete;

  const all = useMemo(() => data ?? [], [data]);

  const typeLabel = typeLabels(t);
  const filterLabel = (f: TypeFilter) => (f === 'All' ? t('companies.filters.all', 'All') : typeLabel[f]);

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
        title={t('companies.accessDenied.title', "You don't have access to Companies")}
        sub={t(
          'companies.accessDenied.sub',
          'The company directory is shared master data for managers and finance. Your work lives on your dashboard, projects, and tasks.',
        )}
        onBack={() => navigate('/')}
      />
    );
  }

  const columns: Column<CompanyRow>[] = [
    {
      key: 'name',
      header: t('companies.columns.name', 'Company'),
      cell: (c) => (
        <span className="truncate font-semibold" title={c.name}>
          {c.name}
        </span>
      ),
      exportValue: (c) => c.name,
    },
    {
      key: 'type',
      // The pill reads the localised LABEL; `exportValue` keeps the raw enum so a spreadsheet
      // round-trips back into the same filter/import values regardless of the viewer's language.
      header: t('companies.columns.type', 'Type'),
      cell: (c) => <StatusPill variant={companyTypeVariant(c.type)}>{typeLabel[c.type]}</StatusPill>,
      exportValue: (c) => c.type,
    },
  ];

  const rowMenu = (c: CompanyRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canEdit)
      items.push({
        label: t('companies.actions.edit', 'Edit'),
        onClick: () => setFormTarget({ company: c }),
      });
    if (canArchive)
      items.push({
        label: t('companies.actions.archive', 'Archive'),
        onClick: () => setArchiveTarget(c),
      });
    if (canDelete)
      items.push({
        label: t('companies.actions.delete', 'Delete'),
        onClick: () => setDeleteTarget(c),
        danger: true,
      });
    return items;
  };

  const onArchiveConfirm = async () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    try {
      await archive.mutateAsync(target.id);
      toast(t('companies.toast.archived', 'Company archived'), target.name, 'success');
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
      toast(t('companies.toast.deleted', 'Company deleted'), target.name, 'success');
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
        // ⚑ NOT EXTRACTED — this sentence embeds a value. `t()` interpolation is unsafe in this
        // repo today: the unit suite mounts no i18next instance, so react-i18next's notReady `t`
        // returns the default string and SILENTLY DROPS the options bag — the screen would read
        // "{{name}} is referenced by…". See the report; the fix belongs in test/setup.ts, not here.
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
    <ListPage
      title={t('companies.title', 'Companies')}
      description={t(
        'companies.description',
        'Clients and vendors used across projects and procurement. Master data shared by the whole organisation.',
      )}
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ company: null })}>
            <Icon name="plus" />
            {t('companies.actions.new', 'New company')}
          </Button>
        )
      }
      /* In-use delete block (23503) — inline GateNotice with an Archive-instead
         recovery path. Persists until the user archives or dismisses it. */
      banner={
        blockedCompany && (
          <GateNotice variant="blocked" className="mb-3.5" data-testid="company-delete-gate">
            {/* ⚑ The sentence body is NOT extracted: it wraps the company name in <b>, so it needs
                <Trans> (or interpolation), and both are unsafe here — see the note on the in-use
                toast above. The two buttons around it ARE extracted. */}
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
                  {t('companies.deleteGate.archiveInstead', 'Archive instead')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setBlockedCompany(null)}>
                  {t('companies.deleteGate.dismiss', 'Dismiss')}
                </Button>
              </div>
            </div>
          </GateNotice>
        )
      }
      filters={
        state !== 'loading' && (
          <ViewToggle<TypeFilter>
            options={TYPE_FILTERS.map((f) => ({ value: f, label: filterLabel(f) }))}
            value={filter}
            onChange={(v) => {
              setFilter(v);
              trackFilterApplied('type', TYPE_FILTERS.length, 'companies');
            }}
            ariaLabel={t('companies.filters.ariaLabel', 'Filter by type')}
          />
        )
      }
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder={t('companies.search.placeholder', 'Search companies…')}
            aria-label={t('companies.search.ariaLabel', 'Search companies')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            searchSurface="companies-list"
            module="companies"
            resultCount={filtered.length}
            // Below `sm` the toolbar stacks: `basis-full` forces the search onto
            // its own full-width row and `min-w-0` drops the base min-w-[190px]
            // clip, so it shrinks to the viewport and stays reachable at 375px. At
            // `sm`+ it right-aligns at its natural width (ml-auto).
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        )
      }
      exportAction={
        state !== 'loading' && (
          <ExportButton rows={filtered} columns={columns} entity="Companies" />
        )
      }
      /* Bulk import (ADR-0027): role-gated via can('create','company'); reuses the
         entity's create repository so RLS stamps org_id + gates the write role. On a
         successful import the wizard close refetches the list. */
      importAction={
        state !== 'loading' && (
          <ImportButton
            entity="company"
            descriptor={companyImportDescriptor}
            onImported={() => void refetch()}
          />
        )
      }
    >
      {/* Body */}
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('companies.states.errorTitle', "Couldn't load companies")}
          sub={t('companies.states.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="folder"
          title={t('companies.states.emptyTitle', 'No companies yet')}
          sub={t(
            'companies.states.emptySub',
            'Add your first client or vendor to start linking projects and purchase requests to a directory.',
          )}
          stateId="companies-empty"
          role={realRole ?? undefined}
          module="companies"
          action={
            canCreate
              ? {
                  label: t('companies.actions.new', 'New company'),
                  onClick: () => setFormTarget({ company: null }),
                }
              : undefined
          }
        />
      )}

      {state === undefined && (
        <DataTable<CompanyRow>
          rows={filtered}
          columns={columns}
          rowKey={(c) => c.id}
          // CW-4b: rows now NAVIGATE to the routable `/companies/:id` record page (the
          // drawer-as-record is retired). Create/edit-in-modal are unchanged.
          onActivate={(c) => navigate(`/companies/${c.id}`)}
          // ⚑ Not extracted — embeds a value; see the interpolation note above.
          rowLabel={(c) => `Open ${c.name}`}
          rowMenu={canRowWrite ? rowMenu : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle={t('companies.table.emptyTitle', 'No companies match your filters')}
          emptySub={t('companies.table.emptySub', 'Try a different type or clear the search.')}
        />
      )}

      {/* Create / edit modal */}
      {formTarget && (
        <CompanyFormModal
          company={formTarget.company}
          pendingPush={pendingPush}
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
            toast(t('companies.toast.created', 'Company created'), input.name, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast(t('companies.toast.updated', 'Company updated'), input.name, 'success');
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
        /* ⚑ The named branch stays a template literal — see the interpolation note above. */
        title={
          archiveTarget
            ? `Archive ${archiveTarget.name}?`
            : t('companies.confirm.archiveTitle', 'Archive company?')
        }
        description={t(
          'companies.confirm.archiveDescription',
          "It will be hidden from the default list and can't be selected on new records. Existing references stay intact. You can restore it any time.",
        )}
        confirmLabel={t('companies.confirm.archiveConfirm', 'Archive company')}
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />

      {/* Delete confirm (destructive tone) */}
      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={
          deleteTarget
            ? `Delete ${deleteTarget.name}?`
            : t('companies.confirm.deleteTitle', 'Delete company?')
        }
        description={t(
          'companies.confirm.deleteDescription',
          "This permanently removes the company. A company referenced by projects or procurements can't be deleted; archive it instead.",
        )}
        confirmLabel={t('companies.confirm.deleteConfirm', 'Delete company')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </ListPage>
  );
};

// ── Create / edit form modal ────────────────────────────────────────────────

interface CompanyFormModalProps {
  company: CompanyRow | null;
  onClose: () => void;
  onCreate: (input: CompanyInput) => Promise<void>;
  onUpdate: (id: string, input: CompanyInput) => Promise<void>;
  onError: (err: unknown) => void;
  /** ADR-0056/FR-EAS-060..063 pending-push state for a flipped org's Vendor/Client write. */
  pendingPush: PendingPushState;
}

const CompanyFormModal: React.FC<CompanyFormModalProps> = ({
  company,
  onClose,
  onCreate,
  onUpdate,
  onError,
  pendingPush,
}) => {
  const { t } = useTranslation();
  const isEdit = !!company;
  // Identity changes only when `t` does (i.e. on a language change), so `useEntityForm`'s
  // `runValidate` memo behaves exactly as it did with the old module-level function.
  const validate = useMemo(() => makeValidate(t), [t]);
  const typeOptions = useMemo(() => {
    const labels = typeLabels(t);
    return [
      { value: 'Client', label: labels.Client },
      { value: 'Vendor', label: labels.Vendor },
      { value: 'Internal', label: labels.Internal },
    ];
  }, [t]);
  const form = useEntityForm<FormValues>({
    initialValues: { name: company?.name ?? '', type: company?.type ?? 'Client' },
    validate,
    idPrefix: 'company-form',
    // F8 (AC-IXD-FORM-F8): submit stays disabled until the required name is present.
    requiredFields: ['name'],
    module: 'companies',
  });

  const nameField = form.fieldProps('name');
  const typeField = form.fieldProps('type');

  // AC-ERR-001: a rejected save gets PERSISTENT in-dialog evidence, not only the corner
  // toast (which auto-dismisses, leaving the modal indistinguishable from a pristine form
  // with data in it). `suppressCapture` because the page's `onError` classifies the same
  // rejection for the toast and owns the single `save_failed` event.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

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
        const { headline, detail } = classifyMutationError(err, undefined, {
          module: 'companies',
          operation: isEdit ? 'update' : 'create',
          suppressCapture: true,
        });
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
          ? t('companies.form.editTitle', 'Edit company')
          : t('companies.form.newTitle', 'New company')
      }
      subtitle={
        isEdit
          ? t('companies.form.editSubtitle', 'Update this company record')
          : t('companies.form.newSubtitle', 'Add a client or vendor to the directory')
      }
      submitLabel={
        isEdit
          ? t('companies.form.editSubmit', 'Save company')
          : t('companies.form.newSubmit', 'Create company')
      }
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
      submitError={saveError}
    >
      {pendingPush.status !== 'idle' && (
        <div className="mb-3.5 flex justify-end">
          <TaskPushBadge state={pendingPush} />
        </div>
      )}
      <FormSection legend={t('companies.form.sections.identity', 'Identity')}>
        <FormGrid>
          <TextField
            id={nameField.id}
            label={t('companies.form.name.label', 'Company name')}
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder={t('companies.form.name.placeholder', 'e.g. Cascade Port Authority')}
            autoComplete="organization"
            fullWidth
          />
          <SelectField
            id={typeField.id}
            label={t('companies.form.type.label', 'Type')}
            required
            value={typeField.value}
            onChange={(v) => typeField.onChange(v as CompanyType)}
            onBlur={typeField.onBlur}
            options={typeOptions}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default Companies;
