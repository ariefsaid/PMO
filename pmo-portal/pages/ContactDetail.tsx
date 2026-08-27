import React, { useLayoutEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
  type SubmitError,
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
import { useContact, useContactActivities, useContactMeetings, useContactMutations } from '@/src/hooks/useContacts';
import type { ContactMeetingRef } from '@/src/lib/db/meetings';
import { useCompanies } from '@/src/hooks/useCompanies';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDate } from '@/src/lib/format';
import { useAgentContext } from '@/src/lib/agent/context/useAgentContext';
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
const kindOptions = (t: TFunction) => [
  { value: 'Call', label: t('contactDetail.activityKind.call', 'Call') },
  { value: 'Email', label: t('contactDetail.activityKind.email', 'Email') },
  { value: 'Meeting', label: t('contactDetail.activityKind.meeting', 'Meeting') },
  { value: 'Note', label: t('contactDetail.activityKind.note', 'Note') },
];

const ContactDetail: React.FC = () => {
  const { t } = useTranslation();
  const { contactId } = useParams<{ contactId: string }>();
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();

  const query = useContact(contactId);
  const { data: companyData } = useCompanies();
  const { update, archive } = useContactMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // FR-AXP-021 (Track C): publish the loaded record to the live agent context so a
  // follow-up like "summarize this" grounds to the viewed contact — grounding only
  // (NFR-AXP-SEC-003), never an authorization signal. Placed before any early return
  // (Rules of Hooks) — cleared on unmount/navigate.
  const { setEntity } = useAgentContext();
  useLayoutEffect(() => {
    const loaded = query.data;
    if (!loaded) return;
    setEntity({ type: 'contact', id: loaded.id, label: loaded.full_name });
    return () => setEntity(undefined);
  }, [query.data, setEntity]);

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
        title={t('contactDetail.accessDenied.title', "You don't have access to Contacts")}
        sub={t(
          'contactDetail.accessDenied.sub',
          'The CRM directory is shared master data for managers and finance. Your work lives on your dashboard, projects, and tasks.',
        )}
        onBack={() => navigate('/')}
      />
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (query.isPending) {
    return (
      <>
        <BackBar label={t('contactDetail.backToContacts', 'Contacts')} onBack={goBack} />
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
        <BackBar label={t('contactDetail.backToContacts', 'Contacts')} onBack={goBack} />
        <ListState
          variant="error"
          title={t('contactDetail.error.title', "Couldn't load contact")}
          sub={t('contactDetail.error.sub', 'Something went wrong fetching this contact.')}
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
        <BackBar label={t('contactDetail.backToContacts', 'Contacts')} onBack={goBack} />
        <div data-testid="contact-not-found">
          <ListState
            variant="empty"
            icon="folder"
            title={t('contactDetail.notFound.title', 'Contact not found')}
            sub={t(
              'contactDetail.notFound.sub',
              "This contact either doesn't exist or isn't visible to you. Return to the directory to find them.",
            )}
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
      toast(t('contactDetail.toast.archived', 'Contact archived'), contact.full_name, 'success');
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
        <BackBar label={t('contactDetail.backToContacts', 'Contacts')} onBack={goBack} />
      </div>

      {/* The ONE RecordHeader anatomy — icon + name + categorical "Contact" pill + the
          role-allowed action zone (Edit + Archive). The job title is the meta line. */}
      <RecordHeader
        name={contact.full_name}
        icon={(contact.full_name.trim().charAt(0) || '•').toUpperCase()}
        status={<StatusPill variant="violet">{t('contactDetail.pill', 'Contact')}</StatusPill>}
        meta={contact.title ? <span>{contact.title}</span> : undefined}
        actions={
          hasActions ? (
            <>
              {canEdit && (
                <Button variant="outline" size="sm" data-testid="contact-edit" onClick={() => setEditOpen(true)}>
                  {t('contactDetail.edit', 'Edit')}
                </Button>
              )}
              {canArchive && (
                <Button variant="ghost" size="sm" data-testid="contact-archive" onClick={() => setArchiveOpen(true)}>
                  {t('contactDetail.archive', 'Archive')}
                </Button>
              )}
            </>
          ) : undefined
        }
      />

      {/* Body — the contact's fields (read-only; edit-in-modal). */}
      <Card variant="bare" className="mb-4">
        <CardHead>{t('contactDetail.sectionTitle', 'Contact detail')}</CardHead>
        <CardPad>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field
              label={t('contactDetail.field.company', 'Company')}
              value={
                contact.company_id ? (
                  <Link
                    to={`/companies/${contact.company_id}`}
                    className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {companyName}
                  </Link>
                ) : (
                  companyName
                )
              }
            />
            <Field label={t('contactDetail.field.title', 'Title')} value={contact.title || '—'} />
            <Field
              label={t('contactDetail.field.email', 'Email')}
              value={
                contact.email ? (
                  <a
                    href={`mailto:${contact.email}`}
                    className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {contact.email}
                  </a>
                ) : (
                  '—'
                )
              }
            />
            <Field
              label={t('contactDetail.field.phone', 'Phone')}
              value={
                contact.phone ? (
                  <a
                    href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}
                    className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {contact.phone}
                  </a>
                ) : (
                  '—'
                )
              }
            />
            {contact.notes && (
              <Field label={t('contactDetail.field.notes', 'Notes')} value={contact.notes} />
            )}
          </dl>
        </CardPad>
      </Card>

      {/* CRM activity timeline + Log-activity form — moved here off the retired drawer. */}
      <Card variant="bare">
        <CardHead>{t('contactDetail.activity.title', 'Activity')}</CardHead>
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
            toast(t('contactDetail.toast.updated', 'Contact updated'), input.full_name, 'success');
            setEditOpen(false);
          }}
          onError={onMutationError}
        />
      )}

      {/* Archive confirm (default tone — reversible soft-archive, ADR-0018). */}
      <ConfirmDialog
        open={archiveOpen}
        tone="default"
        title={t('contactDetail.archiveConfirm.title', 'Archive {{name}}?', {
          name: contact.full_name,
        })}
        description={t(
          'contactDetail.archiveConfirm.description',
          'They will be hidden from the default list. Existing activity stays intact. You can restore them any time.',
        )}
        confirmLabel={t('contactDetail.archiveConfirm.confirmLabel', 'Archive contact')}
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
  return formatDate(iso);
};

/** Returns the route to the related object for an activity, or null when neither id is set.
 *  project_id takes precedence over company_id (a project is more specific context). */
const hrefForActivity = (a: { project_id: string | null; company_id: string | null }): string | null => {
  if (a.project_id) return `/projects/${a.project_id}`;
  if (a.company_id) return `/companies/${a.company_id}`;
  return null;
};

const ContactActivityPanel: React.FC<{ contactId: string }> = ({ contactId }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useContactActivities(contactId);
  // DD-MTG-6 (second half): the timeline unions the touchpoint log with MINUTED meetings this
  // contact attended. RLS filters the meetings to what the viewer may read (FR-MTG-031) — most
  // viewers legitimately see none, so empty is a normal state, never an error.
  const meetingsQuery = useContactMeetings(contactId);
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
  const contactMeetings = meetingsQuery.data ?? [];

  // One timeline, newest-first: touchpoints (editable) + minuted meetings (read-only links).
  type TimelineEntry =
    | { kind: 'activity'; occurredAt: string; activity: CrmActivityRow }
    | { kind: 'meeting'; occurredAt: string; meeting: ContactMeetingRef };
  const timeline: TimelineEntry[] = [
    ...activities.map((a): TimelineEntry => ({ kind: 'activity', occurredAt: a.occurred_at, activity: a })),
    ...contactMeetings.map((m): TimelineEntry => ({ kind: 'meeting', occurredAt: m.occurred_at, meeting: m })),
  ].sort((x, y) => (x.occurredAt < y.occurredAt ? 1 : x.occurredAt > y.occurredAt ? -1 : 0));

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
      toast(t('contactDetail.toast.activityLogged', 'Activity logged'), subject.trim() || kind, 'success');
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
      toast(t('contactDetail.toast.activityDeleted', 'Activity deleted'), '', 'success');
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
              label={t('contactDetail.activity.type', 'Activity type')}
              value={kind}
              onChange={(v) => setKind(v as CrmActivityKind)}
              options={kindOptions(t)}
            />
            <TextField label={t('contactDetail.activity.subject', 'Subject')} value={subject} onChange={setSubject} placeholder={t('contactDetail.activity.subjectPlaceholder', 'e.g. Kickoff call')} />
          </FormGrid>
          <TextArea
            label={t('contactDetail.activity.notes', 'Notes')}
            value={body}
            onChange={setBody}
            rows={2}
            fullWidth
            placeholder={t('contactDetail.activity.notesPlaceholder', 'What was discussed?')}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={logActivity.isPending}
              disabled={!subject.trim() && !body.trim()}
            >
              {t('contactDetail.activity.logAction', 'Log activity')}
            </Button>
          </div>
        </form>
      )}

      {isPending && <ListState variant="loading" rows={3} />}

      {!isPending && isError && (
        <ListState
          variant="error"
          title={t('contactDetail.activity.error.title', "Couldn't load activity")}
          sub={t('contactDetail.activity.error.sub', 'The request failed. Try again.')}
          onRetry={() => refetch()}
        />
      )}

      {/* The meetings half of the union failing must not take down the touchpoint log — a quiet
          one-line note, never an error card (the activities query above owns the error surface). */}
      {!isPending && !isError && meetingsQuery.isError && (
        <p className="mb-2 text-[12px] text-muted-foreground">
          {t('contactDetail.meetings.error', 'Minuted meetings could not be loaded.')}
        </p>
      )}

      {!isPending && !isError && timeline.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
          {t('contactDetail.activity.empty', 'No activity logged yet.')}
        </p>
      )}

      {!isPending && !isError && timeline.length > 0 && (
        <ol data-testid="activity-timeline" className="flex flex-col gap-3">
          {timeline.map((entry) => {
            // DD-MTG-6: a minuted meeting renders READ-ONLY — its record lives in the meeting
            // module (edit rights are the author's there), the timeline only links across.
            if (entry.kind === 'meeting') {
              const m = entry.meeting;
              return (
                <li
                  key={`meeting-${m.id}`}
                  data-testid="timeline-meeting"
                  className="flex flex-col gap-1 rounded-md border border-border bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <StatusPill variant="violet">
                      {t('contactDetail.meetings.pill', 'Minuted meeting')}
                    </StatusPill>
                    <span className="text-[11px] text-muted-foreground">
                      {formatOccurred(m.occurred_at)}
                    </span>
                  </div>
                  <Link
                    to={`/meetings/${m.id}`}
                    className="text-[13.5px] font-medium text-foreground hover:text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                  >
                    {m.title}
                  </Link>
                </li>
              );
            }
            const a = entry.activity;
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
                        aria-label={t('contactDetail.activity.editAction', 'Edit activity')}
                        onClick={() => setEditingActivity(a)}
                      >
                        <Icon name="pencil" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('contactDetail.activity.deleteAction', 'Delete activity')}
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
                      className="text-[13.5px] font-medium text-foreground hover:text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
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
            toast(
              t('contactDetail.toast.activityUpdated', 'Activity updated'),
              patch.subject ?? editingActivity.kind,
              'success',
            );
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
        title={t('contactDetail.activity.deleteConfirm.title', 'Delete this activity?')}
        description={t(
          'contactDetail.activity.deleteConfirm.description',
          'This action cannot be undone. The activity log entry will be permanently removed.',
        )}
        confirmLabel={t('contactDetail.activity.deleteConfirm.confirmLabel', 'Delete')}
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
  const { t } = useTranslation();
  const form = useEntityForm<ActivityFormValues>({
    initialValues: {
      kind: activity.kind,
      subject: activity.subject ?? '',
      body: activity.body ?? '',
    },
    validate: () => ({}),
    idPrefix: 'edit-activity-form',
    requiredFields: [],
    module: 'contacts',
  });

  const kindField = form.fieldProps('kind');
  const subjectField = form.fieldProps('subject');
  const bodyField = form.fieldProps('body');

  // #559 / AC-ERR-001: a rejected save must leave PERSISTENT evidence in the dialog. The toast
  // auto-dismisses after 4s, ~700px from where the user is looking, after which the modal is
  // indistinguishable from a pristine form with data in it — so the save looks like it worked.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

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
      title={t('contactDetail.editActivity.title', 'Edit activity')}
      subtitle={t('contactDetail.editActivity.subtitle', 'Update this activity log entry')}
      submitLabel={t('contactDetail.editActivity.submitLabel', 'Save')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={isPending}
      dirty={form.isDirty}
    >
      <FormSection legend={t('contactDetail.editActivity.legend', 'Details')}>
        <FormGrid>
          <SelectField
            id={kindField.id}
            label={t('contactDetail.activity.type', 'Activity type')}
            value={kindField.value}
            onChange={(v) => kindField.onChange(v as CrmActivityKind)}
            options={kindOptions(t)}
          />
          <TextField
            id={subjectField.id}
            label={t('contactDetail.activity.subject', 'Subject')}
            value={subjectField.value}
            onChange={subjectField.onChange}
            onBlur={subjectField.onBlur}
            placeholder={t('contactDetail.activity.subjectPlaceholder', 'e.g. Kickoff call')}
          />
        </FormGrid>
        <TextArea
          id={bodyField.id}
          label={t('contactDetail.activity.notes', 'Notes')}
          value={bodyField.value}
          onChange={bodyField.onChange}
          onBlur={bodyField.onBlur}
          rows={3}
          fullWidth
          placeholder={t('contactDetail.activity.notesPlaceholder', 'What was discussed?')}
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

const makeValidate =
  (t: TFunction) =>
  (v: FormValues): Partial<Record<keyof FormValues, string>> => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    if (!v.full_name.trim())
      errors.full_name = t('contactDetail.form.errors.nameRequired', 'Contact name is required.');
    if (!v.company_id)
      errors.company_id = t('contactDetail.form.errors.companyRequired', 'A company is required.');
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
  const { t } = useTranslation();
  const form = useEntityForm<FormValues>({
    initialValues: {
      full_name: contact.full_name,
      company_id: contact.company_id,
      title: contact.title ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      notes: contact.notes ?? '',
    },
    validate: makeValidate(t),
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

  const errorSummary = [
    form.errors.full_name ? { fieldId: nameField.id, message: form.errors.full_name } : null,
    form.errors.company_id ? { fieldId: companyField.id, message: form.errors.company_id } : null,
  ].filter(Boolean) as { fieldId: string; message: string }[];

  // #559 / AC-ERR-001: a rejected save must leave PERSISTENT evidence in the dialog. The toast
  // auto-dismisses after 4s, ~700px from where the user is looking, after which the modal is
  // indistinguishable from a pristine form with data in it — so the save looks like it worked.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

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
      title={t('contactDetail.editContact.title', 'Edit contact')}
      subtitle={t('contactDetail.editContact.subtitle', 'Update this contact record')}
      submitLabel={t('contactDetail.editContact.submitLabel', 'Save contact')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      <FormSection legend={t('contactDetail.editContact.legendIdentity', 'Identity')}>
        <FormGrid>
          <TextField
            id={nameField.id}
            label={t('contactDetail.field.fullName', 'Full name')}
            required
            value={nameField.value}
            onChange={nameField.onChange}
            onBlur={nameField.onBlur}
            error={nameField.error}
            placeholder={t('contactDetail.field.fullNamePlaceholder', 'e.g. Jane Doe')}
            autoComplete="name"
            fullWidth
          />
          <SelectField
            id={companyField.id}
            label={t('contactDetail.field.company', 'Company')}
            required
            value={companyField.value}
            onChange={(v) => companyField.onChange(v)}
            onBlur={companyField.onBlur}
            error={companyField.error}
            options={[
              { value: '', label: t('contactDetail.field.companyPlaceholder', 'Select a company…') },
              ...companyOptions,
            ]}
          />
          <TextField
            id={titleField.id}
            label={t('contactDetail.field.title', 'Title')}
            value={titleField.value}
            onChange={titleField.onChange}
            onBlur={titleField.onBlur}
            placeholder={t('contactDetail.field.titlePlaceholder', 'e.g. Procurement Lead')}
          />
        </FormGrid>
      </FormSection>
      <FormSection legend={t('contactDetail.editContact.legendContact', 'Contact details')}>
        <FormGrid>
          <TextField
            id={emailField.id}
            label={t('contactDetail.field.email', 'Email')}
            type="email"
            value={emailField.value}
            onChange={emailField.onChange}
            onBlur={emailField.onBlur}
            placeholder={t('contactDetail.field.emailPlaceholder', 'name@example.com')}
            autoComplete="email"
          />
          <TextField
            id={phoneField.id}
            label={t('contactDetail.field.phone', 'Phone')}
            value={phoneField.value}
            onChange={phoneField.onChange}
            onBlur={phoneField.onBlur}
            placeholder={t('contactDetail.field.phonePlaceholder', 'e.g. +1 555 010 0000')}
            autoComplete="tel"
          />
          <TextArea
            id={notesField.id}
            label={t('contactDetail.field.notes', 'Notes')}
            value={notesField.value}
            onChange={notesField.onChange}
            onBlur={notesField.onBlur}
            rows={3}
            fullWidth
            placeholder={t(
              'contactDetail.field.notesPlaceholder',
              'Anything worth remembering about this contact',
            )}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default ContactDetail;
