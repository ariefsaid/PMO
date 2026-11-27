import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormGrid, ListState, SelectField, TextField, useToast, type SubmitError } from '@/src/components/ui';
import { useSectionReadinessEvents, useSetSectionReadiness } from '@/src/hooks/useWorkOrderSections';
import { READINESS_VALUES, type Readiness, type SectionRollupRow } from '@/src/lib/repositories/workOrderSections';
import { useSectionRefusal } from './useSectionRefusal';
import { formatDate } from '@/src/lib/format';

interface Props {
  workOrderId: string;
  section: SectionRollupRow;
  /** Who may write: the form is read-only history for everyone else. */
  canSet: boolean;
  names: Map<string, string>;
  onClose: () => void;
}

/** A section's readiness, its note and its history (FR-WOS-019, AC-WOS-013): each change with who, when and the note. */
export const SectionReadinessModal: React.FC<Props> = ({ workOrderId, section, canSet, names, onClose }) => {
  const { t } = useTranslation('workOrderSections');
  const sectionRefusal = useSectionRefusal();
  const { toast } = useToast();
  const set = useSetSectionReadiness(workOrderId);
  const events = useSectionReadinessEvents(section.sectionId);
  const [readiness, setReadiness] = useState<Readiness>(section.readiness ?? 'not_ready');
  const [note, setNote] = useState(section.readinessNote ?? '');
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const dirty = readiness !== (section.readiness ?? 'not_ready') || note !== (section.readinessNote ?? '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    try {
      await set.mutateAsync({ id: section.sectionId as string, readiness, note: note.trim() || null });
      toast(t('saved', 'Saved'), undefined, 'success');
      onClose();
    } catch (err) {
      setSubmitError(sectionRefusal(err));
    }
  };
  const label = (r: Readiness) => t(`readiness.${r}`, r === 'ready' ? 'Ready' : r === 'blocked' ? 'Blocked' : 'Not ready');
  return (
    <EntityFormModal open title={t('readinessTitle', 'Readiness of {{code}}', { code: section.code })}
      submitLabel={t('readinessSave', 'Save readiness')} onSubmit={(e) => void submit(e)} onClose={onClose}
      hideSubmit={!canSet} loading={set.isPending} dirty={dirty} submitError={submitError}>
      <FormGrid>
        {canSet && (
          <>
            <SelectField label={t('readiness.label', 'Readiness of {{code}}', { code: section.code })} hideLabel value={readiness}
              onChange={(v) => setReadiness(v as Readiness)} options={READINESS_VALUES.map((r) => ({ value: r, label: label(r) }))} />
            <TextField label={t('readinessNote', 'Note')} maxLength={500} value={note} onChange={setNote} />
          </>
        )}
      </FormGrid>
      <h3 className="mt-4 text-body font-semibold">{t('history', 'History')}</h3>
      {events.isError ? <ListState variant="error" title={t('common:readError')} onRetry={() => void events.refetch()} /> : events.isPending ? null : (events.data ?? []).length === 0 ? (
        <p className="text-control text-muted-foreground">{t('historyEmpty', 'No changes yet.')}</p>
      ) : (
        <ul className="mt-2 space-y-2 text-control" data-testid="wos-readiness-history">
          {(events.data ?? []).map((ev) => (
            <li key={ev.id}>
              <span className="font-medium">{label(ev.readiness)}</span>
              <span className="text-muted-foreground"> · {ev.setBy ? names.get(ev.setBy) ?? t('unknownUser', 'Someone') : t('unknownUser', 'Someone')} · {formatDate(ev.setAt)}</span>
              {ev.note ? <div className="text-muted-foreground">{ev.note}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </EntityFormModal>
  );
};
