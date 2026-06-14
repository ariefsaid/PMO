import React, { useMemo, useState } from 'react';
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
  TextArea,
  SelectField,
  FormSection,
  FormGrid,
  AccessDenied,
  useEntityForm,
  useToast,
  Button,
  Icon,
  type Column,
  type RowMenuItem,
  type StatusVariant,
} from '@/src/components/ui';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '@/src/auth/usePermission';
import { useContacts, useContactActivities, useContactMutations } from '@/src/hooks/useContacts';
import { useCompanies } from '@/src/hooks/useCompanies';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ContactRow, ContactInput } from '@/src/lib/db/contacts';
import type { CrmActivityKind, CrmActivityInput } from '@/src/lib/db/crmActivities';

/**
 * Activity-kind pills — four DISTINCT hues, never color-only (each carries its label):
 * Call = blue (`open`), Email = categorical violet, Meeting = green (`won`), Note = neutral.
 * Mirrors the company-type-pill precedent (Companies.tsx).
 */
const KIND_PILL: Record<CrmActivityKind, StatusVariant> = {
  Call: 'open',
  Email: 'violet',
  Meeting: 'won',
  Note: 'neutral',
};

const KIND_OPTIONS = [
  { value: 'Call', label: 'Call' },
  { value: 'Email', label: 'Email' },
  { value: 'Meeting', label: 'Meeting' },
  { value: 'Note', label: 'Note' },
];

interface FormValues {
  full_name: string;
  company_id: string;
  title: string;
  email: string;
  phone: string;
  notes: string;
}

const validate = (v: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!v.full_name.trim()) errors.full_name = 'Contact name is required.';
  if (!v.company_id) errors.company_id = 'A company is required.';
  return errors;
};

const Contacts: React.FC = () => {
  const may = usePermission();
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
  const [drawerContact, setDrawerContact] = useState<ContactRow | null>(null);

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
        title="You don't have access to Contacts"
        sub="The CRM directory is shared master data for managers and finance. Your work lives on your dashboard, projects, and tasks."
        onBack={() => navigate('/')}
      />
    );
  }

  const columns: Column<ContactRow>[] = [
    {
      key: 'full_name',
      header: 'Name',
      cell: (c) => (
        <span className="truncate font-semibold" title={c.full_name}>
          {c.full_name}
        </span>
      ),
      exportValue: (c) => c.full_name,
    },
    {
      key: 'company',
      header: 'Company',
      cell: (c) => (
        <span className="truncate text-muted-foreground" title={companyById.get(c.company_id) ?? ''}>
          {companyById.get(c.company_id) ?? '—'}
        </span>
      ),
      exportValue: (c) => companyById.get(c.company_id) ?? '',
    },
    {
      key: 'email',
      header: 'Email',
      cell: (c) => <span className="truncate text-muted-foreground">{c.email ?? '—'}</span>,
      exportValue: (c) => c.email ?? '',
    },
  ];

  const rowMenu = (c: ContactRow): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    if (canEdit) items.push({ label: 'Edit', onClick: () => setFormTarget({ contact: c }) });
    if (canArchive) items.push({ label: 'Archive', onClick: () => setArchiveTarget(c) });
    if (canDelete) items.push({ label: 'Delete', onClick: () => setDeleteTarget(c), danger: true });
    return items;
  };

  const onArchiveConfirm = async () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    try {
      await archive.mutateAsync(target.id);
      toast('Contact archived', target.full_name, 'success');
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
      toast('Contact deleted', target.full_name, 'success');
      setDeleteTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">Contacts</h1>
          <p className="mt-0.5 max-w-[68ch] text-sm text-muted-foreground">
            People at the companies you work with. Master data shared by the whole organisation —
            log calls, emails and meetings against each contact.
          </p>
        </div>
        {canCreate && (
          <Button variant="primary" onClick={() => setFormTarget({ contact: null })}>
            <Icon name="plus" />
            New contact
          </Button>
        )}
      </div>

      {state !== 'loading' && (
        <Toolbar standalone>
          <SelectField
            label="Filter by company"
            hideLabel
            value={companyFilter}
            onChange={setCompanyFilter}
            options={[{ value: 'All', label: 'All companies' }, ...companyOptions]}
          />
          <SearchMini
            placeholder="Search contacts…"
            aria-label="Search contacts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        </Toolbar>
      )}

      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title="Couldn't load contacts"
          sub="The request failed. Check your connection and try again."
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="folder"
          title="No contacts yet"
          sub="Add your first contact to start logging calls, emails and meetings against the people you work with."
          action={
            canCreate ? { label: 'Add your first contact', onClick: () => setFormTarget({ contact: null }) } : undefined
          }
        />
      )}

      {state === undefined && (
        <DataTable<ContactRow>
          rows={filtered}
          columns={columns}
          rowKey={(c) => c.id}
          onActivate={(c) => setDrawerContact(c)}
          rowLabel={(c) => `View ${c.full_name}`}
          rowMenu={canRowWrite ? rowMenu : undefined}
          selectedKey={drawerContact?.id}
          state={filtered.length === 0 ? 'empty' : undefined}
          emptyTitle="No contacts match your filters"
          emptySub="Try a different company or clear the search."
        />
      )}

      <ContactDrawer
        contact={drawerContact}
        companyName={drawerContact ? companyById.get(drawerContact.company_id) ?? null : null}
        canEdit={canEdit}
        canArchive={canArchive}
        canDelete={canDelete}
        onClose={() => setDrawerContact(null)}
        onEdit={() => {
          const c = drawerContact;
          setDrawerContact(null);
          if (c) setFormTarget({ contact: c });
        }}
        onArchive={() => {
          const c = drawerContact;
          setDrawerContact(null);
          if (c) setArchiveTarget(c);
        }}
        onDelete={() => {
          const c = drawerContact;
          setDrawerContact(null);
          if (c) setDeleteTarget(c);
        }}
      />

      {formTarget && (
        <ContactFormModal
          contact={formTarget.contact}
          companyOptions={companyOptions}
          onClose={() => setFormTarget(null)}
          onCreate={async (input) => {
            await create.mutateAsync(input);
            toast('Contact created', input.full_name, 'success');
            setFormTarget(null);
          }}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast('Contact updated', input.full_name, 'success');
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
        title={archiveTarget ? `Archive ${archiveTarget.full_name}?` : 'Archive contact?'}
        description="They will be hidden from the default list. Existing activity stays intact. You can restore them any time."
        confirmLabel="Archive contact"
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={deleteTarget ? `Delete ${deleteTarget.full_name}?` : 'Delete contact?'}
        description="This permanently removes the contact and all of their logged activity. This cannot be undone — archive instead to keep the history."
        confirmLabel="Delete contact"
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

// ── Quick-view drawer ────────────────────────────────────────────────────────

interface ContactDrawerProps {
  contact: ContactRow | null;
  companyName: string | null;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  onClose: () => void;
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

const ContactDrawer: React.FC<ContactDrawerProps> = ({
  contact,
  companyName,
  canEdit,
  canArchive,
  canDelete,
  onClose,
  onEdit,
  onArchive,
  onDelete,
}) => {
  if (!contact) return null;
  const hasFooter = canEdit || canArchive || canDelete;

  return (
    <Drawer
      open
      title={contact.full_name}
      subtitle={contact.title ?? undefined}
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
        <DField label="Company">{companyName ?? '—'}</DField>
        {contact.email && <DField label="Email">{contact.email}</DField>}
        {contact.phone && <DField label="Phone">{contact.phone}</DField>}
        {contact.notes && <DField label="Notes">{contact.notes}</DField>}
      </dl>
      <div className="mt-6 border-t border-border pt-5">
        <ContactActivityPanel contactId={contact.id} />
      </div>
    </Drawer>
  );
};

// ── Activity timeline + log form ─────────────────────────────────────────────

const formatOccurred = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const ContactActivityPanel: React.FC<{ contactId: string }> = ({ contactId }) => {
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useContactActivities(contactId);
  const { logActivity } = useContactMutations();
  const canLog = may('create', 'contactActivity');

  const [kind, setKind] = useState<CrmActivityKind>('Call');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const activities = data ?? [];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() && !body.trim()) return;
    const input: CrmActivityInput = {
      contact_id: contactId,
      kind,
      subject: subject.trim() || null,
      body: body.trim() || null,
      occurred_at: new Date().toISOString(),
      company_id: null,
      project_id: null,
    };
    try {
      await logActivity.mutateAsync(input);
      toast('Activity logged', subject.trim() || kind, 'success');
      setSubject('');
      setBody('');
      setKind('Call');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <div>
      <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Activity
      </h3>

      {canLog && (
        <form onSubmit={onSubmit} className="mb-5 flex flex-col gap-3 rounded-md border border-border bg-card p-3">
          <FormGrid>
            <SelectField
              label="Activity type"
              value={kind}
              onChange={(v) => setKind(v as CrmActivityKind)}
              options={KIND_OPTIONS}
            />
            <TextField
              label="Subject"
              value={subject}
              onChange={setSubject}
              placeholder="e.g. Kickoff call"
            />
          </FormGrid>
          <TextArea
            label="Notes"
            value={body}
            onChange={setBody}
            rows={2}
            fullWidth
            placeholder="What was discussed?"
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={logActivity.isPending}
              disabled={!subject.trim() && !body.trim()}
            >
              Log activity
            </Button>
          </div>
        </form>
      )}

      {isPending && <ListState variant="loading" rows={3} />}

      {!isPending && isError && (
        <ListState
          variant="error"
          title="Couldn't load activity"
          sub="The request failed. Try again."
          onRetry={() => refetch()}
        />
      )}

      {!isPending && !isError && activities.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
          No activity logged yet.
        </p>
      )}

      {!isPending && !isError && activities.length > 0 && (
        <ol data-testid="activity-timeline" className="flex flex-col gap-3">
          {activities.map((a) => (
            <li key={a.id} className="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <StatusPill variant={KIND_PILL[a.kind]}>{a.kind}</StatusPill>
                <span className="text-[11px] text-muted-foreground">
                  {formatOccurred(a.occurred_at)}
                </span>
              </div>
              {a.subject && <span className="text-[13.5px] font-medium text-foreground">{a.subject}</span>}
              {a.body && <p className="text-[13px] text-muted-foreground">{a.body}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

// ── Create / edit form modal ─────────────────────────────────────────────────

interface ContactFormModalProps {
  contact: ContactRow | null;
  companyOptions: { value: string; label: string }[];
  onClose: () => void;
  onCreate: (input: ContactInput) => Promise<void>;
  onUpdate: (id: string, input: ContactInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const ContactFormModal: React.FC<ContactFormModalProps> = ({
  contact,
  companyOptions,
  onClose,
  onCreate,
  onUpdate,
  onError,
}) => {
  const isEdit = !!contact;
  const form = useEntityForm<FormValues>({
    initialValues: {
      full_name: contact?.full_name ?? '',
      company_id: contact?.company_id ?? '',
      title: contact?.title ?? '',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
      notes: contact?.notes ?? '',
    },
    validate,
    idPrefix: 'contact-form',
    requiredFields: ['full_name', 'company_id'],
  });

  const nameField = form.fieldProps('full_name');
  const companyField = form.fieldProps('company_id');
  const titleField = form.fieldProps('title');
  const emailField = form.fieldProps('email');
  const phoneField = form.fieldProps('phone');
  const notesField = form.fieldProps('notes');

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
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={isEdit ? 'Edit contact' : 'New contact'}
      subtitle={isEdit ? 'Update this contact record' : 'Add a person at one of your companies'}
      submitLabel={isEdit ? 'Save contact' : 'Create contact'}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      <FormSection legend="Identity">
        <FormGrid>
          <TextField
            id={nameField.id}
            label="Full name"
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder="e.g. Jane Doe"
            autoComplete="name"
            fullWidth
          />
          <SelectField
            id={companyField.id}
            label="Company"
            required
            value={companyField.value}
            onChange={(v) => companyField.onChange(v)}
            onBlur={companyField.onBlur}
            error={companyField.error}
            options={[{ value: '', label: 'Select a company…' }, ...companyOptions]}
          />
          <TextField
            id={titleField.id}
            label="Title"
            value={titleField.value}
            onChange={titleField.onChange}
            onBlur={titleField.onBlur}
            placeholder="e.g. Procurement Lead"
          />
        </FormGrid>
      </FormSection>
      <FormSection legend="Contact details">
        <FormGrid>
          <TextField
            id={emailField.id}
            label="Email"
            type="email"
            value={emailField.value}
            onChange={emailField.onChange}
            onBlur={emailField.onBlur}
            placeholder="name@example.com"
            autoComplete="email"
          />
          <TextField
            id={phoneField.id}
            label="Phone"
            value={phoneField.value}
            onChange={phoneField.onChange}
            onBlur={phoneField.onBlur}
            placeholder="e.g. +1 555 010 0000"
            autoComplete="tel"
          />
          <TextArea
            id={notesField.id}
            label="Notes"
            value={notesField.value}
            onChange={notesField.onChange}
            onBlur={notesField.onBlur}
            rows={3}
            fullWidth
            placeholder="Anything worth remembering about this contact"
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default Contacts;
