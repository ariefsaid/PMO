import React, { useMemo, useState } from 'react';
import {
  ListPage,
  SearchMini,
  ListState,
  DataTable,
  ConfirmDialog,
  EntityFormModal,
  TextField,
  TextArea,
  SelectField,
  FormSection,
  FormGrid,
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
import { makeContactImportDescriptor } from '@/src/lib/import';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useContacts, useContactMutations } from '@/src/hooks/useContacts';
import { useCompanies } from '@/src/hooks/useCompanies';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ContactRow, ContactInput } from '@/src/lib/db/contacts';

interface FormValues {
  full_name: string;
  company_id: string;
  title: string;
  email: string;
  phone: string;
  notes: string;
}

/**
 * `t` has to be threaded in: both messages are user-visible, and a module-level literal cannot
 * reach the active locale. The validation SHAPE is unchanged — same fields, same trigger, same keys.
 */
const makeValidate =
  (t: TFunction) =>
  (v: FormValues): Partial<Record<keyof FormValues, string>> => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    if (!v.full_name.trim())
      errors.full_name = t('contacts.form.errors.nameRequired', 'Contact name is required.');
    if (!v.company_id)
      errors.company_id = t('contacts.form.errors.companyRequired', 'A company is required.');
    return errors;
  };

const Contacts: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useContacts();
  const { data: companyData } = useCompanies();
  const { create, update, archive, remove } = useContactMutations();

  // CRM directory view = the master-data roles (Engineer = ○, no nav/page) — mirrors Companies §D.
  const canView = may('view', 'contact');

  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string>('All');

  const [formTarget, setFormTarget] = useState<{ contact: ContactRow | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ContactRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContactRow | null>(null);

  const canCreate = may('create', 'contact');
  const canEdit = may('edit', 'contact');
  const canArchive = may('archive', 'contact');
  const canDelete = may('delete', 'contact');
  const canRowWrite = canEdit || canArchive || canDelete;

  const companies = useMemo(() => companyData ?? [], [companyData]);
  const companyById = useMemo(
    () => new Map(companies.map((c) => [c.id, c.name])),
    [companies],
  );
  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: c.id, label: c.name })),
    [companies],
  );
  const importDescriptor = useMemo(() => makeContactImportDescriptor(companies), [companies]);

  const all = useMemo(() => data ?? [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((c) => companyFilter === 'All' || c.company_id === companyFilter)
      .filter(
        (c) =>
          !q ||
          c.full_name.toLowerCase().includes(q) ||
          (c.email ?? '').toLowerCase().includes(q),
      );
  }, [all, search, companyFilter]);

  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : all.length === 0
        ? 'empty'
        : undefined;

  if (!canView) {
    return (
      <AccessDenied
        title={t('contacts.accessDenied.title', "You don't have access to Contacts")}
        sub={t(
          'contacts.accessDenied.sub',
          'The CRM directory is shared master data for managers and finance. Your work lives on your dashboard, projects, and tasks.',
        )}
        onBack={() => navigate('/')}
      />
    );
  }

  const columns: Column<ContactRow>[] = [
    {
      key: 'full_name',
      header: t('contacts.columns.name', 'Name'),
      cell: (c) => (
        <span className="truncate font-semibold" title={c.full_name}>
          {c.full_name}
        </span>
      ),
      exportValue: (c) => c.full_name,
    },
    {
      key: 'company',
      header: t('contacts.columns.company', 'Company'),
      cell: (c) => (
        <span className="truncate text-muted-foreground" title={companyById.get(c.company_id) ?? ''}>
          {companyById.get(c.company_id) ?? '—'}
        </span>
      ),
      exportValue: (c) => companyById.get(c.company_id) ?? '',
    },
    {
      key: 'email',
      header: t('contacts.columns.email', 'Email'),
      cell: (c) => <span className="truncate text-muted-foreground">{c.email ?? '—'}</span>,
      exportValue: (c) => c.email ?? '',
    },
  ];

  const rowMenu = (c: ContactRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canEdit)
      items.push({
        label: t('contacts.actions.edit', 'Edit'),
        onClick: () => setFormTarget({ contact: c }),
      });
    if (canArchive)
      items.push({
        label: t('contacts.actions.archive', 'Archive'),
        onClick: () => setArchiveTarget(c),
      });
    if (canDelete)
      items.push({
        label: t('contacts.actions.delete', 'Delete'),
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
      toast(t('contacts.toast.archived', 'Contact archived'), target.full_name, 'success');
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
      toast(t('contacts.toast.deleted', 'Contact deleted'), target.full_name, 'success');
      setDeleteTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  return (
    <ListPage
      title={t('contacts.title', 'Contacts')}
      description={t(
        'contacts.description',
        // DD-MTG-6: the CRM 'Meeting' kind is the lightweight touchpoint log; anything with
        // attendees and minutes lives in the Meetings module — so this copy no longer promises
        // "meetings" here.
        'People at the companies you work with. Master data shared by the whole organisation — log calls and emails against each contact. Minuted meetings live in the Meetings module.',
      )}
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ contact: null })}>
            <Icon name="plus" />
            {t('contacts.actions.new', 'New contact')}
          </Button>
        )
      }
      filters={
        state !== 'loading' && (
          <SelectField
            label={t('contacts.filters.companyLabel', 'Filter by company')}
            hideLabel
            value={companyFilter}
            onChange={setCompanyFilter}
            options={[
              { value: 'All', label: t('contacts.filters.allCompanies', 'All companies') },
              ...companyOptions,
            ]}
          />
        )
      }
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder={t('contacts.search.placeholder', 'Search contacts…')}
            aria-label={t('contacts.search.ariaLabel', 'Search contacts')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        )
      }
      exportAction={
        state !== 'loading' && (
          <ExportButton rows={filtered} columns={columns} entity="Contacts" />
        )
      }
      importAction={
        state !== 'loading' && (
          <ImportButton
            entity="contact"
            descriptor={importDescriptor}
            onImported={() => void refetch()}
          />
        )
      }
    >
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('contacts.states.errorTitle', "Couldn't load contacts")}
          sub={t('contacts.states.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="folder"
          title={t('contacts.states.emptyTitle', 'No contacts yet')}
          sub={t(
            'contacts.states.emptySub',
            // DD-MTG-6: same re-scope as the page description — touchpoints here, minutes in Meetings.
            'Add your first contact to start logging calls and emails against the people you work with.',
          )}
          stateId="contacts-empty"
          role={realRole ?? undefined}
          module="contacts"
          action={
            canCreate
              ? {
                  label: t('contacts.states.emptyAction', 'Add your first contact'),
                  onClick: () => setFormTarget({ contact: null }),
                }
              : undefined
          }
        />
      )}

      {state === undefined && (
        <DataTable<ContactRow>
          rows={filtered}
          columns={columns}
          rowKey={(c) => c.id}
          // CW-4b: rows now NAVIGATE to the routable `/contacts/:id` record page (the
          // drawer-as-record is retired). Create/edit-in-modal are unchanged.
          onActivate={(c) => navigate(`/contacts/${c.id}`)}
          // ⚑ Not extracted — embeds a value; `t()` interpolation is silently dropped by the
          // notReady `t` the unit suite uses (no i18next instance is mounted there).
          rowLabel={(c) => `Open ${c.full_name}`}
          rowMenu={canRowWrite ? rowMenu : undefined}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle={t('contacts.table.emptyTitle', 'No contacts match your filters')}
          emptySub={t('contacts.table.emptySub', 'Try a different company or clear the search.')}
        />
      )}

      {formTarget && (
        <ContactFormModal
          contact={formTarget.contact}
          companyOptions={companyOptions}
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
            toast(t('contacts.toast.created', 'Contact created'), input.full_name, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast(t('contacts.toast.updated', 'Contact updated'), input.full_name, 'success');
            setFormTarget(null);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        tone="default"
        /* ⚑ The named branch stays a template literal — see the interpolation note above. */
        title={
          archiveTarget
            ? `Archive ${archiveTarget.full_name}?`
            : t('contacts.confirm.archiveTitle', 'Archive contact?')
        }
        description={t(
          'contacts.confirm.archiveDescription',
          'They will be hidden from the default list. Existing activity stays intact. You can restore them any time.',
        )}
        confirmLabel={t('contacts.confirm.archiveConfirm', 'Archive contact')}
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={
          deleteTarget
            ? `Delete ${deleteTarget.full_name}?`
            : t('contacts.confirm.deleteTitle', 'Delete contact?')
        }
        description={t(
          'contacts.confirm.deleteDescription',
          'This permanently removes the contact and all of their logged activity. This cannot be undone — archive instead to keep the history.',
        )}
        confirmLabel={t('contacts.confirm.deleteConfirm', 'Delete contact')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </ListPage>
  );
};

// ── Create / edit form modal ─────────────────────────────────────────────────

interface ContactFormModalProps {
  contact: ContactRow | null;
  companyOptions: { value: string; label: string }[];
  /** When provided (T14 — "Add contact" from CompanyDetail), pre-fills and locks
   *  the company_id field so the user cannot change it. */
  defaultCompanyId?: string;
  onClose: () => void;
  onCreate: (input: ContactInput) => Promise<void>;
  onUpdate: (id: string, input: ContactInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const ContactFormModal: React.FC<ContactFormModalProps> = ({
  contact,
  companyOptions,
  defaultCompanyId,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const { t } = useTranslation();
  const isEdit = !!contact;
  // Identity changes only when `t` does (i.e. on a language change), so `useEntityForm`'s
  // `runValidate` memo behaves exactly as it did with the old module-level function.
  const validate = useMemo(() => makeValidate(t), [t]);
  // When defaultCompanyId is set (in-context create from CompanyDetail) the
  // company_id initialises to it and the field is disabled.
  const lockedCompanyId = defaultCompanyId ?? null;
  const form = useEntityForm<FormValues>({
    initialValues: {
      full_name: contact?.full_name ?? '',
      company_id: contact?.company_id ?? lockedCompanyId ?? '',
      title: contact?.title ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      notes: contact?.notes ?? '',
    },
    validate,
    idPrefix: 'contact-form',
    requiredFields: ['full_name', 'company_id'],
    module: 'contacts',
  });

  const nameField = form.fieldProps('full_name');
  const companyField = form.fieldProps('company_id');
  const titleField = form.fieldProps('title');
  const emailField = form.fieldProps('email');
  const phoneField = form.fieldProps('phone');
  const notesField = form.fieldProps('notes');

  // AC-ERR-001: a rejected save gets PERSISTENT in-dialog evidence, not only the corner
  // toast (which auto-dismisses, leaving the modal indistinguishable from a pristine form
  // with data in it). `suppressCapture` because the page's `onError` classifies the same
  // rejection for the toast and owns the single `save_failed` event.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const errorSummary = [
    form.errors.full_name ? { fieldId: nameField.id, message: form.errors.full_name } : null,
    form.errors.company_id ? { fieldId: companyField.id, message: form.errors.company_id } : null,
  ].filter(Boolean) as { fieldId: string; message: string }[];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: ContactInput = {
        company_id: values.company_id,
        full_name: values.full_name.trim(),
        title: values.title.trim() || null,
        email: values.email.trim() || null,
        phone: values.phone.trim() || null,
        notes: values.notes.trim() || null,
      };
      try {
        if (isEdit && contact) await onUpdate(contact.id, input);
        else await onCreate(input);
      } catch (err) {
        const { headline, detail } = classifyMutationError(err, undefined, {
          module: 'contacts',
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
          ? t('contacts.form.editTitle', 'Edit contact')
          : t('contacts.form.newTitle', 'New contact')
      }
      subtitle={
        isEdit
          ? t('contacts.form.editSubtitle', 'Update this contact record')
          : t('contacts.form.newSubtitle', 'Add a person at one of your companies')
      }
      submitLabel={
        isEdit
          ? t('contacts.form.editSubmit', 'Save contact')
          : t('contacts.form.newSubmit', 'Create contact')
      }
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
      submitError={saveError}
    >
      <FormSection legend={t('contacts.form.sections.identity', 'Identity')}>
        <FormGrid>
          <TextField
            id={nameField.id}
            label={t('contacts.form.fullName.label', 'Full name')}
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder={t('contacts.form.fullName.placeholder', 'e.g. Jane Doe')}
            autoComplete="name"
            fullWidth
          />
          <SelectField
            id={companyField.id}
            label={t('contacts.form.company.label', 'Company')}
            required
            value={companyField.value}
            onChange={(v) => companyField.onChange(v)}
            onBlur={companyField.onBlur}
            error={companyField.error}
            options={[
              { value: '', label: t('contacts.form.company.placeholder', 'Select a company…') },
              ...companyOptions,
            ]}
            disabled={!!lockedCompanyId}
          />
          <TextField
            id={titleField.id}
            label={t('contacts.form.jobTitle.label', 'Title')}
            value={titleField.value}
            onChange={titleField.onChange}
            onBlur={titleField.onBlur}
            placeholder={t('contacts.form.jobTitle.placeholder', 'e.g. Procurement Lead')}
          />
        </FormGrid>
      </FormSection>
      <FormSection legend={t('contacts.form.sections.contactDetails', 'Contact details')}>
        <FormGrid>
          <TextField
            id={emailField.id}
            label={t('contacts.form.email.label', 'Email')}
            type="email"
            value={emailField.value}
            onChange={emailField.onChange}
            onBlur={emailField.onBlur}
            placeholder="name@example.com"
            autoComplete="email"
          />
          <TextField
            id={phoneField.id}
            label={t('contacts.form.phone.label', 'Phone')}
            value={phoneField.value}
            onChange={phoneField.onChange}
            onBlur={phoneField.onBlur}
            placeholder={t('contacts.form.phone.placeholder', 'e.g. +1 555 010 0000')}
            autoComplete="tel"
          />
          <TextArea
            id={notesField.id}
            label={t('contacts.form.notes.label', 'Notes')}
            value={notesField.value}
            onChange={notesField.onChange}
            onBlur={notesField.onBlur}
            rows={3}
            fullWidth
            placeholder={t(
              'contacts.form.notes.placeholder',
              'Anything worth remembering about this contact',
            )}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default Contacts;
