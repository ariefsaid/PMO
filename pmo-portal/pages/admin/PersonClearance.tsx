import React, { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, ConfirmDialog, DateField, EntityFormModal, FormGrid, ListState, RecordHeader, StatusPill, TextField, useToast,
  type StatusVariant, type SubmitError,
} from '@/src/components/ui';
import { CanWrite } from '@/src/auth/usePermission';
import { usePerson } from '@/src/hooks/useDocumentExpiry';
import { useClearanceStateMutations, useClearanceSummary, usePersonChecklist } from '@/src/hooks/useClearance';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatIsoDay } from '@/src/lib/format';
import type { ClearanceState, PersonChecklistRow } from '@/src/lib/repositories/clearance';

const STATE_VARIANT: Record<ClearanceState, StatusVariant> = { done: 'won', expiring: 'warn', expired: 'overdue', missing: 'neutral' };

/** Record or correct when one item was done, with an optional expiry and a short note. */
const StateForm: React.FC<{ personId: string; row: PersonChecklistRow; onClose: () => void }> = ({ personId, row, onClose }) => {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const { save } = useClearanceStateMutations(personId);
  const [doneOn, setDoneOn] = useState(row.done_on ?? '');
  const [expiresOn, setExpiresOn] = useState(row.expires_on ?? '');
  const [note, setNote] = useState(row.note ?? '');
  const [doneError, setDoneError] = useState<string>();
  const [expiryError, setExpiryError] = useState<string>();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setDoneError(undefined); setExpiryError(undefined);
    if (!doneOn) { setDoneError(t('clearance.person.errDone', 'Enter the date it was done')); return; }
    if (expiresOn && expiresOn < doneOn) { setExpiryError(t('clearance.person.errExpiry', 'The expiry date cannot be before the date done')); return; }
    save.mutateAsync({ itemId: row.item_id, input: { done_on: doneOn, expires_on: expiresOn || null, note: note.trim() || null } })
      .then(() => { toast(t('clearance.person.saved', 'Saved'), undefined, 'success'); onClose(); })
      .catch((err: unknown) => { const c = classifyMutationError(err); setSubmitError({ headline: c.headline, detail: c.detail }); });
  };

  return (
    <EntityFormModal open title={row.name} submitLabel={t('clearance.person.save', 'Save')} onSubmit={submit} onClose={onClose}
      loading={save.isPending} dirty submitError={submitError}>
      <FormGrid>
        <DateField label={t('clearance.person.doneOn', 'Date done')} required value={doneOn} onChange={setDoneOn} error={doneError} />
        <DateField label={t('clearance.person.expiresOn', 'Expires on (optional)')} value={expiresOn} onChange={setExpiresOn} error={expiryError} />
        <TextField id="clearance-note" label={t('clearance.person.note', 'Note (optional)')} value={note} onChange={setNote}
          helper={t('clearance.person.noteHelp', 'Keep it short. Do not record medical detail here.')} />
      </FormGrid>
    </EntityFormModal>
  );
};

/** One person's cleared-for-site checklist (#2707). The state and the cleared answer come from the database. */
export default function PersonClearance() {
  const { t } = useTranslation('administration');
  const { personId = '' } = useParams();
  const { toast } = useToast();
  const enabled = useOrgSwitch('clearance');
  const person = usePerson(personId);
  const checklist = usePersonChecklist(personId, enabled.data === true);
  const summary = useClearanceSummary();
  const { clear } = useClearanceStateMutations(personId);
  const [editing, setEditing] = useState<PersonChecklistRow | null>(null);
  const [clearing, setClearing] = useState<PersonChecklistRow | null>(null);

  const stateLabel: Record<ClearanceState, string> = {
    done: t('clearance.state.done', 'Done'),
    expiring: t('clearance.state.expiring', 'Expiring soon'),
    expired: t('clearance.state.expired', 'Expired'),
    missing: t('clearance.state.missing', 'Not done'),
  };

  if (enabled.isPending || person.isPending) return <ListState variant="loading" rows={3} />;
  if (enabled.isError || person.isError) return <ListState variant="error" title={t('clearance.person.loadError', 'Couldn’t load this checklist')} onRetry={() => { void enabled.refetch(); void person.refetch(); }} />;
  if (!enabled.data) return <ListState variant="empty" title={t('clearance.off.title', 'The clearance checklist is not turned on')} sub={t('clearance.off.sub', 'An Admin can turn it on under Modules, in People and crews.')} />;
  if (!person.data) return <ListState variant="empty" title={t('clearance.person.notFound', 'This person was not found')} sub={t('clearance.person.notFoundSub', 'They may have been archived, or you may not have access.')} />;

  const cleared = summary.data?.find((s) => s.person_id === personId)?.cleared === true;
  return (
    <div className="min-w-0">
      <p className="mb-2"><Link to="/administration/clearance" className="text-control underline-offset-2 hover:underline">{t('clearance.person.back', 'Back to Clearance')}</Link></p>
      <RecordHeader name={person.data.name}
        status={<StatusPill variant={cleared ? 'won' : 'warn'}>{cleared ? t('clearance.cleared', 'Cleared') : t('clearance.notCleared', 'Not cleared')}</StatusPill>} />
      <section aria-labelledby="clearance-checklist-heading" className="mt-4">
        <h2 id="clearance-checklist-heading" className="text-group font-semibold">{t('clearance.person.heading', 'Cleared-for-site checklist')}</h2>
        <div className="mt-3">
          {checklist.isError ? <ListState variant="error" title={t('clearance.person.loadError', 'Couldn’t load this checklist')} onRetry={() => void checklist.refetch()} />
            : checklist.isPending ? <ListState variant="loading" rows={4} />
            : checklist.data.length === 0 ? (
              <ListState variant="empty" title={t('clearance.person.emptyTitle', 'No checklist items yet')}
                sub={t('clearance.person.emptySub', 'An Admin lists what a person needs under Clearance; the items then appear here.')} />
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {checklist.data.map((row) => (
                  <li key={row.item_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{row.name}{!row.is_required && <span className="ml-2 text-control font-normal text-muted-foreground">{t('clearance.items.optionalTag', 'Optional')}</span>}</p>
                      {row.done_on && (
                        <p className="text-control text-muted-foreground">
                          {t('clearance.person.doneLine', 'Done {{date}}', { date: formatIsoDay(row.done_on) })}
                          {row.expires_on && ` · ${t('clearance.person.expiresLine', 'Expires {{date}}', { date: formatIsoDay(row.expires_on) })}`}
                        </p>
                      )}
                      {row.note && <p className="break-words text-control text-muted-foreground">{row.note}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill variant={STATE_VARIANT[row.state]}>{stateLabel[row.state]}</StatusPill>
                      <CanWrite action="edit" entity="personClearance">
                        <Button variant="outline" size="sm" aria-label={t('clearance.person.editLabel', '{{action}} {{name}}', { action: row.done_on ? t('clearance.person.edit', 'Edit') : t('clearance.person.record', 'Record'), name: row.name })} onClick={() => setEditing(row)}>{row.done_on ? t('clearance.person.edit', 'Edit') : t('clearance.person.record', 'Record')}</Button>
                        {row.done_on && <Button variant="ghost" size="sm" aria-label={t('clearance.person.removeLabel', 'Remove {{name}}', { name: row.name })} onClick={() => setClearing(row)}>{t('clearance.person.remove', 'Remove')}</Button>}
                      </CanWrite>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </section>
      {editing && <StateForm personId={personId} row={editing} onClose={() => setEditing(null)} />}
      {clearing && (
        <ConfirmDialog open title={t('clearance.person.removeTitle', 'Remove this date?')}
          description={t('clearance.person.removeBody', 'The item goes back to not done for this person.')}
          confirmLabel={t('clearance.person.remove', 'Remove')} cancelLabel={t('clearance.cancel', 'Cancel')} tone="destructive"
          onCancel={() => setClearing(null)}
          onConfirm={() => {
            clear.mutateAsync(clearing.item_id)
              .then(() => toast(t('clearance.person.removed', 'Date removed'), undefined, 'success'))
              .catch((err: unknown) => toast(classifyMutationError(err).headline, undefined, 'error'))
              .finally(() => setClearing(null));
          }} />
      )}
    </div>
  );
}
