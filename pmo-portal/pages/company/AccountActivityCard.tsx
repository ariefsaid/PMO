import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Card,
  CardHead,
  CardPad,
  Button,
  Icon,
  StatusPill,
  ListState,
  ConfirmDialog,
  TextField,
  TextArea,
  SelectField,
  FormGrid,
  useToast,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { ContactNameLink } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import { crmActivityVariant } from '@/src/lib/status/statusVariants';
import type { CrmActivityKind, CrmActivityInput, CrmActivityRow } from '@/src/lib/db/crmActivities';
import { useContactsByCompany, useCompanyActivities, useContactMutations } from '@/src/hooks/useContacts';
import { EditActivityModal } from '@/pages/activity/EditActivityModal';
import { ActivityShowMore } from '@/pages/activity/ActivityShowMore';

/**
 * The company record page's account activity timeline (CROSS-68), moved off CompanyDetail.
 * Aggregates crm_activities across ALL of this company's contacts client-side (fan-in via
 * useCompanyActivities) and owns the gated "Log activity" form — since crm_activities.contact_id
 * is NOT NULL, the form requires/defaults to a contact of this company.
 *
 * PGA02-002: a FAILED contacts read is never read as "this company has no contacts" — the card
 * names the read failure with a retry before any empty-state decision, instead of the old
 * behavior that rendered the add-contact cold-start prompt (and hid the timeline) on a
 * transient fetch error while existing contacts and activity existed.
 *
 * CD-4: when the company genuinely has no contacts (cold-start), renders an empty Activity card
 * with a prompt whose button opens the Add-contact modal (via the `onAddContact` callback).
 */
const kindOptions = (t: TFunction) => [
  { value: 'Call', label: t('companyDetail.activityKind.call', 'Call') },
  { value: 'Email', label: t('companyDetail.activityKind.email', 'Email') },
  { value: 'Meeting', label: t('companyDetail.activityKind.meeting', 'Meeting') },
  { value: 'Note', label: t('companyDetail.activityKind.note', 'Note') },
];

const formatOccurred = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDay(iso);
};

export const AccountActivityCard: React.FC<{ companyId: string; onAddContact?: () => void }> = ({
  companyId,
  onAddContact,
}) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { toast } = useToast();
  const {
    data: contacts,
    isPending: contactsPending,
    isError: contactsError,
    refetch: refetchContacts,
  } = useContactsByCompany(companyId);
  const contactList = useMemo(() => contacts ?? [], [contacts]);
  const contactIds = useMemo(() => contactList.map((c) => c.id), [contactList]);

  const { data, isPending, isError, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useCompanyActivities(contactIds);
  const { logActivity, updateActivity, deleteActivity } = useContactMutations();
  const canLog = may('create', 'contactActivity');
  const canEdit = may('edit', 'contactActivity');
  const canDelete = may('delete', 'contactActivity');

  const activities = data ?? [];

  // CD-2 (AC-JR-W3B-E1): lookup map from contact_id → {id, name} for activity row links.
  const contactById = useMemo(
    () => new Map(contactList.map((c) => [c.id, c])),
    [contactList],
  );

  // Log-activity form state
  const [kind, setKind] = useState<CrmActivityKind>('Call');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // When there's more than one contact the user must pick; with a single contact we
  // pre-populate and hide the selector.
  const [selectedContactId, setSelectedContactId] = useState<string>('');

  // Edit/delete state for activity rows (CD-1)
  const [editingActivity, setEditingActivity] = useState<CrmActivityRow | null>(null);
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null);

  // When contactList changes, auto-select the first contact if there's only one.
  const effectiveContactId = contactList.length === 1 ? contactList[0].id : selectedContactId;

  const contactOptions = useMemo(
    () => contactList.map((c) => ({ value: c.id, label: c.full_name })),
    [contactList],
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!subject.trim() && !body.trim()) || !effectiveContactId) return;
    const input: CrmActivityInput = {
      contact_id: effectiveContactId,
      kind,
      subject: subject.trim() || null,
      body: body.trim() || null,
      occurred_at: new Date().toISOString(),
      company_id: companyId,
      project_id: null,
    };
    try {
      await logActivity.mutateAsync(input);
      toast(t('companyDetail.toast.activityLogged', 'Activity logged'), subject.trim() || kind, 'success');
      setSubject('');
      setBody('');
      setKind('Call');
      setSelectedContactId('');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onDeleteConfirm = async () => {
    if (!deletingActivityId) return;
    try {
      await deleteActivity.mutateAsync(deletingActivityId);
      toast(t('companyDetail.toast.activityDeleted', 'Activity deleted'), '', 'success');
      setDeletingActivityId(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  // Don't render the card until we know if there are any contacts (to avoid a flash).
  if (contactsPending) return null;

  // PGA02-002: a failed contacts read gets the section's error surface with retry. Only a
  // SUCCESSFUL read decides the empty state — a fetch failure must never pose as "no contacts".
  if (contactsError) {
    return (
      <Card variant="bare" className="mb-4">
        <CardHead>{t('companyDetail.activity.title', 'Activity')}</CardHead>
        <CardPad>
          <ListState
            variant="error"
            title={t('companyDetail.contacts.error.title', "Couldn't load contacts")}
            sub={t('companyDetail.contacts.error.sub', 'Something went wrong. Try again.')}
            onRetry={() => refetchContacts()}
          />
        </CardPad>
      </Card>
    );
  }

  // CD-4: contactless company — show an empty Activity card with a cold-start prompt
  // instead of returning null (which was a dead-end for first-time setup).
  if (contactList.length === 0 && activities.length === 0) {
    return (
      <Card variant="bare" className="mb-4">
        <CardHead>{t('companyDetail.activity.title', 'Activity')}</CardHead>
        <CardPad>
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-4 py-8 text-center">
            <p className="text-control text-muted-foreground">
              {t('companyDetail.activity.coldStart', 'Add a contact to start logging activity')}
            </p>
            {onAddContact && (
              <Button variant="outline" size="sm" onClick={onAddContact}>
                <Icon name="plus" />
                {t('companyDetail.contacts.addContact', 'Add contact')}
              </Button>
            )}
          </div>
        </CardPad>
      </Card>
    );
  }

  return (
    <Card className="mb-4">
      <CardHead>{t('companyDetail.activity.title', 'Activity')}</CardHead>
      <CardPad>
        {/* Log-activity form (gated by contactActivity create permission) */}
        {canLog && contactList.length > 0 && (
          <form
            onSubmit={onSubmit}
            // One surface level: the form is a section of the Activity card, not a card inside
            // it — a divider separates it from the activity list (tidy sweep, nested-cards fix).
            className="mb-5 flex flex-col gap-3 border-b border-border pb-5"
          >
            <FormGrid>
              <SelectField
                label={t('companyDetail.activity.type', 'Activity type')}
                value={kind}
                onChange={(v) => setKind(v as CrmActivityKind)}
                options={kindOptions(t)}
              />
              {/* Contact selector: shown only when there are multiple contacts */}
              {contactList.length > 1 && (
                <SelectField
                  label={t('companyDetail.activity.contact', 'Contact')}
                  value={selectedContactId}
                  onChange={setSelectedContactId}
                  options={[
                    {
                      value: '',
                      label: t('companyDetail.activity.contactPlaceholder', 'Select a contact…'),
                    },
                    ...contactOptions,
                  ]}
                />
              )}
              <TextField
                label={t('companyDetail.activity.subject', 'Subject')}
                value={subject}
                onChange={setSubject}
                placeholder={t('companyDetail.activity.subjectPlaceholder', 'e.g. Kickoff call')}
              />
            </FormGrid>
            <TextArea
              label={t('companyDetail.activity.notes', 'Notes')}
              value={body}
              onChange={setBody}
              rows={2}
              fullWidth
              placeholder={t('companyDetail.activity.notesPlaceholder', 'What was discussed?')}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={logActivity.isPending}
                disabled={(!subject.trim() && !body.trim()) || !effectiveContactId}
              >
                {t('companyDetail.activity.logAction', 'Log activity')}
              </Button>
            </div>
          </form>
        )}

        {isPending && <ListState variant="loading" rows={3} />}

        {!isPending && isError && (
          <ListState
            variant="error"
            title={t('companyDetail.activity.error.title', "Couldn't load activity")}
            sub={t('companyDetail.activity.error.sub', 'The request failed. Try again.')}
            onRetry={() => refetch()}
          />
        )}

        {!isPending && !isError && activities.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-control text-muted-foreground">
            {t('companyDetail.activity.empty', 'No activity logged yet.')}
          </p>
        )}

        {!isPending && !isError && activities.length > 0 && (
          <ol data-testid="account-activity-timeline" className="flex flex-col gap-3">
            {activities.map((a) => {
              const contact = contactById.get(a.contact_id);
              return (
                <li
                  key={a.id}
                  className="flex flex-col gap-1 rounded-md border border-border bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <StatusPill variant={crmActivityVariant(a.kind)}>{a.kind}</StatusPill>
                    <div className="flex items-center gap-1">
                      <span className="text-control text-muted-foreground">
                        {formatOccurred(a.occurred_at)}
                      </span>
                      {canEdit && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('companyDetail.activity.editAction', 'Edit activity')}
                          onClick={() => setEditingActivity(a)}
                        >
                          <Icon name="pencil" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('companyDetail.activity.deleteAction', 'Delete activity')}
                          onClick={() => setDeletingActivityId(a.id)}
                        >
                          <Icon name="trash" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* CD-2 (AC-JR-W3B-E1): contact name links to /contacts/:id */}
                  {contact && (
                    <ContactNameLink
                      contactId={contact.id}
                      name={contact.full_name}
                      className="text-control"
                    />
                  )}
                  {a.subject && (
                    <span className="text-control font-medium text-foreground">{a.subject}</span>
                  )}
                  {a.body && <p className="text-control text-muted-foreground">{a.body}</p>}
                </li>
              );
            })}
          </ol>
        )}

        {!isPending && !isError && activities.length > 0 && (
          <ActivityShowMore
            shown={activities.length}
            hasNextPage={Boolean(hasNextPage)}
            isFetchingNextPage={isFetchingNextPage}
            onShowMore={() => void fetchNextPage()}
          />
        )}

        {/* Edit activity modal (CD-1) — the ONE shared CRM activity edit form (PGA02-006). */}
        {editingActivity && (
          <EditActivityModal
            activity={editingActivity}
            module="companies"
            onClose={() => setEditingActivity(null)}
            onSave={async (patch) => {
              await updateActivity.mutateAsync({ id: editingActivity.id, ...patch });
              toast(
                t('companyDetail.toast.activityUpdated', 'Activity updated'),
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

        {/* Delete confirm (CD-1) */}
        <ConfirmDialog
          open={deletingActivityId !== null}
          tone="destructive"
          title={t('companyDetail.activity.deleteConfirm.title', 'Delete this activity?')}
          description={t(
            'companyDetail.activity.deleteConfirm.description',
            'This action cannot be undone. The activity log entry will be permanently removed.',
          )}
          confirmLabel={t('companyDetail.activity.deleteConfirm.confirmLabel', 'Delete')}
          loading={deleteActivity.isPending}
          onConfirm={onDeleteConfirm}
          onCancel={() => setDeletingActivityId(null)}
        />
      </CardPad>
    </Card>
  );
};
