import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, DateField, EntityFormModal, FormGrid, ReasonDialog, SelectField, StatusPill, TextArea, useToast, type SubmitError,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useCanEnterRelease, useMedicalReleaseMutations, useMedicalReleases, useReleasePeople } from '@/src/hooks/useMedicalRelease';
import type { MedicalReleaseRow } from '@/src/lib/repositories/medicalRelease';
import { formatDay } from '@/src/lib/format';
import { toIso } from '../equipment/equipmentWeek';
import { useReleaseErrorText } from '../crews/crewErrors';

const PILL: Record<MedicalReleaseRow['status'], 'warn' | 'won' | 'lost'> = { Pending: 'warn', Approved: 'won', Deferred: 'lost' };

/** The people team opens a release (a person and a date, a short note: never medical detail). */
const OpenReleaseForm: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation('crews');
  const writeError = useReleaseErrorText();
  const { toast } = useToast();
  const people = useReleasePeople(true);
  const { create } = useMedicalReleaseMutations();
  const [personId, setPersonId] = useState('');
  const [date, setDate] = useState(toIso(new Date()));
  const [note, setNote] = useState('');
  const [error, setError] = useState<SubmitError | null>(null);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({ personId, date, note: note || null });
      toast(t('crews:release.opened', 'Release opened'), undefined, 'success');
      onClose();
    } catch (err) {
      setError({ headline: t('crews:saveFailed', 'Not saved'), detail: writeError(err) });
    }
  };
  return (
    <EntityFormModal open title={t('crews:release.formTitle', 'Open a medical release')} submitLabel={t('crews:release.open', 'Open release')}
      onSubmit={(e) => void send(e)} onClose={onClose} loading={create.isPending} dirty={Boolean(personId || note)}
      submitDisabled={!personId || !date} submitError={error}>
      <FormGrid>
        <SelectField label={t('crews:leave.person', 'Person')} required value={personId} onChange={setPersonId}
          placeholder={t('crews:release.pickPerson', 'Choose a person')} options={(people.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
        <DateField label={t('crews:release.date', 'Return date')} required value={date} onChange={setDate} />
        <TextArea label={t('crews:release.note', 'Note (no medical detail)')} value={note} onChange={setNote} fullWidth />
      </FormGrid>
    </EntityFormModal>
  );
};

/**
 * "Medical releases" on /approvals: the direct manager approves or defers; the people team opens one. UX only: the
 * database refuses anyone else, and refuses to roster the person until the release is approved. Renders nothing while
 * there is no release and the viewer cannot open one.
 */
export const MedicalReleaseSection: React.FC = () => {
  const { t } = useTranslation('crews');
  const writeError = useReleaseErrorText();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const record = { viewOnly: realRole !== effectiveRole };
  const canEnter = useCanEnterRelease() && may('create', 'medicalRelease', { record });
  const canDecide = may('decide', 'medicalRelease', { record });
  const { data } = useMedicalReleases();
  const { decide } = useMedicalReleaseMutations();
  const [deferring, setDeferring] = useState<MedicalReleaseRow | null>(null);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const rows = (data ?? []).filter((r) => r.status !== 'Approved');
  if (rows.length === 0 && !canEnter) return null;
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setProblem(null);
    try { await fn(); toast(done, undefined, 'success'); } catch (err) { setProblem(writeError(err)); }
  };
  const statusLabel: Record<MedicalReleaseRow['status'], string> = {
    Pending: t('crews:release.status.pending', 'Release pending'), Approved: t('crews:release.status.approved', 'Released'),
    Deferred: t('crews:release.status.deferred', 'Release deferred'),
  };
  return (
    <section aria-label={t('crews:release.sectionLabel', 'Medical releases')} className="mb-4">
      <Card seam>
        <CardHead className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg">
          <span>{t('crews:release.heading', 'Medical releases ({{count}})', { count: rows.length })}</span>
          {canEnter && <Button variant="outline" size="sm" onClick={() => setOpening(true)}>{t('crews:release.openButton', 'Open a release')}</Button>}
        </CardHead>
        {problem && <p role="alert" className="px-4 py-2 text-sm text-destructive-text">{problem}</p>}
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{t('crews:release.none', 'No release is waiting. The people team opens one when a worker is ready to return.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} aria-label={r.person_name} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm">
                <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                  <div className="font-medium text-foreground">{r.person_name}</div>
                  <div className="text-muted-foreground">{t('crews:release.from', 'Return date {{date}}', { date: formatDay(r.release_date) })}</div>
                  {r.note && <div className="text-muted-foreground">{r.note}</div>}
                  {r.decision_note && <div className="text-muted-foreground">{t('crews:leave.note', 'Note: {{note}}', { note: r.decision_note })}</div>}
                  {!r.can_decide && <div className="text-muted-foreground">{t('crews:release.managerDecides', "Their direct manager decides. They cannot be rostered until it is approved.")}</div>}
                </div>
                <StatusPill variant={PILL[r.status]}>{statusLabel[r.status]}</StatusPill>
                {r.can_decide && canDecide && (
                  <>
                    <Button variant="primary" size="sm" onClick={() => void run(() => decide.mutateAsync({ id: r.id, decision: 'Approved', note: null }), t('crews:release.approved', 'Release approved'))}>
                      {t('crews:leave.approve', 'Approve')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDeferring(r)}>{t('crews:release.defer', 'Defer')}</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {opening && <OpenReleaseForm onClose={() => setOpening(false)} />}
      <ReasonDialog open={deferring !== null} kind="return" subject={t('crews:release.subject', 'medical release')}
        title={t('crews:release.deferTitle', 'Defer the release')} label={t('crews:release.deferLabel', 'Reason for deferring')}
        helper={t('crews:release.deferHelp', 'The people team sees this. Do not write medical detail.')}
        confirmLabel={t('crews:release.defer', 'Defer')} loading={decide.isPending} onCancel={() => setDeferring(null)}
        onConfirm={(note) => {
          const r = deferring;
          setDeferring(null);
          if (r) void run(() => decide.mutateAsync({ id: r.id, decision: 'Deferred', note }), t('crews:release.deferred', 'Release deferred'));
        }} />
    </section>
  );
};
