import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  RecordHeader,
  Card,
  CardHead,
  CardPad,
  Button,
  Icon,
  StatusPill,
  ListState,
  ConfirmDialog,
  AccessDenied,
  EntityFormModal,
  TextField,
  TextArea,
  SelectField,
  FormSection,
  FormGrid,
  useEntityForm,
  useToast,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { usePermission } from '@/src/auth/usePermission';
import { useContact, useContactActivities, useContactMutations } from '@/src/hooks/useContacts';
import { useCompanies } from '@/src/hooks/useCompanies';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { crmActivityVariant } from '@/src/lib/status/statusVariants';
import type { ContactInput } from '@/src/lib/db/contacts';
import type { CrmActivityKind, CrmActivityInput, CrmActivityRow } from '@/src/lib/db/crmActivities';

/**
 * ContactDetail — the routable `/contacts/:id` master-data record page (CW-4b).
 *
 * Mirrors the CW-4a `IncidentDetail` / sibling `CompanyDetail` pattern: the shared `RecordHeader`
 * (page variant: icon + name + the categorical "Contact" pill + the role-allowed Edit/Archive
 * action zone), a `BackBar` "Back to Contacts", read-only field sections with edit-in-modal, and
 * the CRM activity timeline + Log-activity form on the page.
 * RLS is the enforcement authority; `can()` (via `usePermission`) gates affordances for clarity.
 */
const KIND_OPTIONS = [
  { value: 'Call', label: 'Call' },
  { value: 'Email', label: 'Email' },
  { value: 'Meeting', label: 'Meeting' },
  { value: 'Note', label: 'Note' },
];

const ContactDetail: React.FC = () => {
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();

  const query = useContact(contactId);
  const { data: companyData } = useCompanies();
  const { update, archive } = useContactMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // CRM directory access = the master-data roles (Engineer = ○) — mirrors Companies §D.
  const canView = may('view', 'contact');
  const canEdit = may('edit', 'contact');
  const canArchive = may('archive', 'contact');

  const companies = useMemo(() => companyData ?? [], [companyData]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const companyOptions = useMemo(
    () => companies.map((c) => ({ value: c.id, label: c.name })),
    [companies],
  );

  const goBack = () => navigate('/contacts');

  if (!canView) {
    return (
      <AccessDenied
        title="You don't have access to Contacts"
        sub="The CRM directory is shared master data for managers and finance. Your work lives on your dashboard, projects, and tasks."
        onBack={() => navigate('/')}
      />
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (query.isPending) {
    return (
      <>
        <BackBar label="Contacts" onBack={goBack} />
        <div data-testid="contact-loading">
          <ListState variant="loading" rows={5} />
        </div>
      </>
    );
  }

  // ── Error (a genuine transient failure — offer Retry) ─────────────────────
  if (query.isError) {
    return (
      <>
        <BackBar label="Contacts" onBack={goBack} />
        <ListState
          variant="error"
          title="Couldn't load contact"
          sub="Something went wrong fetching this contact."
          onRetry={() => query.refetch()}
        />
      </>
    );
  }

  // ── Not found / no access — a calm empty state ────────────────────────────
  const contact = query.data;
  if (!contact) {
    return (
      <>
        <BackBar label="Contacts" onBack={goBack} />
        <div data-testid="contact-not-found">
          <ListState
            variant="empty"
            icon="folder"
            title="Contact not found"
            sub="This contact either doesn't exist or isn't visible to you. Return to the directory to find them."
          />
        </div>
      </>
    );
  }

  const companyName = companyById.get(contact.company_id) ?? '—';

  const onMutationError = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  const onArchiveConfirm = async () => {
    try {
      await archive.mutateAsync(contact.id);
      toast('Contact archived', contact.full_name, 'success');
      setArchiveOpen(false);
      navigate('/contacts');
    } catch (err) {
      onMutationError(err);
    }
  };

  const hasActions = canEdit || canArchive;

  return (
    <div>
      {/* Mobile escape route (rail collapses ≤920px). */}
      <div data-testid="mobile-back-bar" className="hidden max-[920px]:block">
        <BackBar label="Contacts" onBack={goBack} />
      </div>

      {/* The ONE RecordHeader anatomy — icon + name + categorical "Contact" pill + the
          role-allowed action zone (Edit + Archive). The job title is the meta line. */}
      <RecordHeader
        name={contact.full_name}
        icon={(contact.full_name.trim().charAt(0) || '•').toUpperCase()}
        status={<StatusPill variant="violet">Contact</StatusPill>}
        meta={contact.title ? <span>{contact.title}</span> : undefined}
        actions={
          hasActions ? (
            <>
              {canEdit && (
                <Button variant="outline" size="sm" data-testid="contact-edit" onClick={() => setEditOpen(true)}>
                  Edit
                </Button>
              )}
              {canArchive && (
                <Button variant="ghost" size="sm" data-testid="contact-archive" onClick={() => setArchiveOpen(true)}>
                  Archive
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {/* Body — the contact's fields (read-only; edit-in-modal). */}
      <Card variant="bare" className="mb-4">
        <CardHead>Contact detail</CardHead>
        <CardPad>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field
              label="Company"
              value={
                contact.company_id ? (
                  <Link
                    to={`/companies/${contact.company_id}`}
                    className="text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {companyName}
                  </Link>
                ) : (
                  companyName
                )
              }
            />
            <Field label="Title" value={contact.title || '—'} />
            <Field
              label="Email"
              value={
                contact.email ? (
                  <a
                    href={`mailto:${contact.email}`}
                    className="text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {contact.email}
                  </a>
                ) : (
                  '—'
                )
              }
            />
            <Field
              label="Phone"
              value={
                contact.phone ? (
                  <a
                    href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}
                    className="text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {contact.phone}
                  </a>
                ) : (
                  '—'
                )
              }
            />
            {contact.notes && <Field label="Notes" value={contact.notes} />}
          </dl>
        </CardPad>
      </Card>

      {/* CRM activity timeline + Log-activity form — moved here off the retired drawer. */}
      <Card variant="bare">
        <CardHead>Activity</CardHead>
        <CardPad>
          <ContactActivityPanel contactId={contact.id} />
        </CardPad>
      </Card>

      {/* Edit modal — reuses the shared create/edit form. */}
      {editOpen && (
        <ContactEditModal
          contact={contact}
          companyOptions={companyOptions}
          onClose={() => setEditOpen(false)}
          onUpdate={async (id, input) => {
            await update.mutateAsync({ id, input });
            toast('Contact updated', input.full_name, 'success');
            setEditOpen(false);
          }}
          onError={onMutationError}
        />
      )}

      {/* Archive confirm (default tone — reversible soft-archive, ADR-0018). */}
      <ConfirmDialog
        open={archiveOpen}
        tone="default"
        title={`Archive ${contact.full_name}?`}
        description="They will be hidden from the default list. Existing activity stays intact. You can restore them any time."
        confirmLabel="Archive contact"
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveOpen(false)}
      />
    </div>
  );
};

/** A labelled read-only field (definition-list row). */
const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
      {label}
    </dt>
    <dd className="text-[13.5px] text-foreground">{value}</dd>
  </div>
);

// ── Activity timeline + log form (moved off the retired drawer) ───────────────

const formatOccurred = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

/** Returns the route to the related object for an activity, or null when neither id is set.
 *  project_id takes precedence over company_id (a project is more specific context). */
const hrefForActivity = (a: { project_id: string | null; company_id: string | null }): string | null => {
  if (a.project_id) return `/projects/${a.project_id}`;
  if (a.company_id) return `/companies/${a.company_id}`;
  return null;
};

const ContactActivityPanel: React.FC<{ contactId: string }> = ({ contactId }) => {
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useContactActivities(contactId);
  const { logActivity, updateActivity, deleteActivity } = useContactMutations();
  const canLog = may('create', 'contactActivity');
  const canEdit = may('edit', 'contactActivity');
  const canDelete = may('delete', 'contactActivity');

  const [kind, setKind] = useState<CrmActivityKind>('Call');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // Edit modal state
  const [editingActivity, setEditingActivity] = useState<CrmActivityRow | null>(null);
  // Delete confirm state
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null);

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

  const onDeleteConfirm = async () => {
    if (!deletingActivityId) return;
    try {
      await deleteActivity.mutateAsync(deletingActivityId);
      toast('Activity deleted', '', 'success');
      setDeletingActivityId(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <div>
      {canLog && (
        <form onSubmit={onSubmit} className="mb-5 flex flex-col gap-3 rounded-md border border-border bg-card p-3">
          <FormGrid>
            <SelectField
              label="Activity type"
              value={kind}
              onChange={(v) => setKind(v as CrmActivityKind)}
              options={KIND_OPTIONS}
            />
            <TextField label="Subject" value={subject} onChange={setSubject} placeholder="e.g. Kickoff call" />
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
          {activities.map((a) => {
            const relatedHref = hrefForActivity(a);
            return (
              <li key={a.id} className="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <StatusPill variant={crmActivityVariant(a.kind)}>{a.kind}</StatusPill>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-muted-foreground">{formatOccurred(a.occurred_at)}</span>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Edit activity"
                        onClick={() => setEditingActivity(a)}
                      >
                        <Icon name="pencil" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Delete activity"
                        onClick={() => setDeletingActivityId(a.id)}
                      >
                        <Icon name="trash" />
                      </Button>
                    )}
                  </div>
                </div>
                {a.subject && (
                  relatedHref ? (
                    <Link
                      to={relatedHref}
                      className="text-[13.5px] font-medium text-foreground hover:text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                    >
                      {a.subject}
                    </Link>
                  ) : (
                    <span className="text-[13.5px] font-medium text-foreground">{a.subject}</span>
                  )
                )}
                {a.body && <p className="text-[13px] text-muted-foreground">{a.body}</p>}
              </li>
            );
          })}
        </ol>
      )}

      {/* Edit activity modal */}
      {editingActivity && (
        <EditActivityModal
          activity={editingActivity}
          onClose={() => setEditingActivity(null)}
          onSave={async (patch) => {
            await updateActivity.mutateAsync({ id: editingActivity.id, ...patch });
            toast('Activity updated', patch.subject ?? editingActivity.kind, 'success');
            setEditingActivity(null);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
          isPending={updateActivity.isPending}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={deletingActivityId !== null}
        tone="destructive"
        title="Delete this activity?"
        description="This action cannot be undone. The activity log entry will be permanently removed."
        confirmLabel="Delete"
        loading={deleteActivity.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeletingActivityId(null)}
      />
    </div>
  );
};

// ── EditActivityModal — inline edit for a single crm_activity row ────────────

interface ActivityFormValues {
  kind: CrmActivityKind;
  subject: string;
  body: string;
}

interface EditActivityModalProps {
  activity: CrmActivityRow;
  onClose: () => void;
  onSave: (patch: { kind: CrmActivityKind; subject: string | null; body: string | null }) => Promise<void>;
  onError: (err: unknown) => void;
  isPending: boolean;
}

const EditActivityModal: React.FC<EditActivityModalProps> = ({
  activity,
  onClose,
  onSave,
  onError,
  isPending,
}) => {
  const form = useEntityForm<ActivityFormValues>({
    initialValues: {
      kind: activity.kind,
      subject: activity.subject ?? '',
      body: activity.body ?? '',
    },
    validate: () => ({}),
    idPrefix: 'edit-activity-form',
    requiredFields: [],
  });

  const kindField = form.fieldProps('kind');
  const subjectField = form.fieldProps('subject');
  const bodyField = form.fieldProps('body');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      try {
        await onSave({
          kind: values.kind,
          subject: values.subject.trim() || null,
          body: values.body.trim() || null,
        });
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title="Edit activity"
      subtitle="Update this activity log entry"
      submitLabel="Save"
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={isPending}
      dirty={form.isDirty}
    >
      <FormSection legend="Details">
        <FormGrid>
          <SelectField
            id={kindField.id}
            label="Activity type"
            value={kindField.value}
            onChange={(v) => kindField.onChange(v as CrmActivityKind)}
            options={KIND_OPTIONS}
          />
          <TextField
            id={subjectField.id}
            label="Subject"
            value={subjectField.value}
            onChange={subjectField.onChange}
            onBlur={subjectField.onBlur}
            placeholder="e.g. Kickoff call"
          />
        </FormGrid>
        <TextArea
          id={bodyField.id}
          label="Notes"
          value={bodyField.value}
          onChange={bodyField.onChange}
          onBlur={bodyField.onBlur}
          rows={3}
          fullWidth
          placeholder="What was discussed?"
        />
      </FormSection>
    </EntityFormModal>
  );
};

// ── Edit form modal (CW-4b — edit-in-modal stays on the record page) ──────────

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

interface ContactEditModalProps {
  contact: {
    id: string;
    full_name: string;
    company_id: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
  };
  companyOptions: { value: string; label: string }[];
  onClose: () => void;
  onUpdate: (id: string, input: ContactInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const ContactEditModal: React.FC<ContactEditModalProps> = ({
  contact,
  companyOptions,
  onClose,
  onUpdate,
  onError,
}) => {
  const form = useEntityForm<FormValues>({
    initialValues: {
      full_name: contact.full_name,
      company_id: contact.company_id,
      title: contact.title ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      notes: contact.notes ?? '',
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
        await onUpdate(contact.id, input);
      } catch (err) {
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title="Edit contact"
      subtitle="Update this contact record"
      submitLabel="Save contact"
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

export default ContactDetail;
