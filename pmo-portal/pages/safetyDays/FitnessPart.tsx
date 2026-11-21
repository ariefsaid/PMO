import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, RecordSection, SelectField, TextField, useToast } from '@/src/components/ui';
import { useSafetyList, useSafetyMutations } from '@/src/hooks/useSafetyDays';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { RosterWorker, SafetyDayDetail, SafetyFitnessCheck } from '@/src/lib/db/safetyDays';
import { workerName } from './partHelpers';

/** Fitness check (FR-DSF-002/004): per rostered worker or named visitor, fit / not fit with a note; the check type is a client list. */
export const FitnessPart: React.FC<{ detail: SafetyDayDetail; roster: RosterWorker[]; editable: boolean; seePeople: boolean }> = ({ detail, roster, editable, seePeople }) => {
  const { t } = useTranslation('safety');
  const { toast } = useToast();
  const m = useSafetyMutations();
  const types = useSafetyList('check_type');
  const [workerId, setWorkerId] = useState('');
  const [visitor, setVisitor] = useState('');
  const [typeId, setTypeId] = useState('');
  const [result, setResult] = useState<SafetyFitnessCheck['result']>('fit');
  const [note, setNote] = useState('');
  const dayId = detail.day.id;
  const fail = (err: unknown) => { const { headline, detail: d } = classifyMutationError(err); toast(headline, d, 'warning'); };
  const typeLabel = (id: string | null) => types.data?.find((x) => x.id === id)?.label;
  const resultLabel = (r: SafetyFitnessCheck['result']) => t(`fitness.result.${r}`, r);
  const canAdd = (workerId || visitor.trim()) && (result !== 'not_fit' || note.trim());

  const add = async () => {
    try {
      await m.saveFitness.mutateAsync({ dayId, workerId: workerId || null, visitorName: workerId ? null : visitor.trim(), checkTypeId: typeId || null, result, note });
      setWorkerId(''); setVisitor(''); setNote('');
    } catch (err) { fail(err); }
  };

  return (
    <RecordSection title={t('fitness.title', 'Fitness check')} data-testid="safety-fitness">
      {detail.fitness.length === 0 && <p className="text-muted-foreground">{t('fitness.none', 'No fitness checks recorded')}</p>}
      <ul className="divide-y divide-border">
        {detail.fitness.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="safety-fitness-row">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{f.visitor_name ?? workerName(roster, f.worker_id, t('fitness.worker', 'Worker'))}</span>
              {typeLabel(f.check_type_id) && <span className="text-muted-foreground">{typeLabel(f.check_type_id)}</span>}
              <span>{resultLabel(f.result)}</span>
              {f.note && <span className="text-muted-foreground">{f.note}</span>}
            </span>
            {editable && <Button variant="ghost" size="sm" aria-label={`${t('form.remove', 'Remove')} ${f.visitor_name ?? workerName(roster, f.worker_id, '')}`} onClick={() => void m.deleteFitness.mutateAsync(f.id).catch(fail)}>{t('form.remove', 'Remove')}</Button>}
          </li>
        ))}
      </ul>
      {editable && (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (canAdd) void add(); }}>
          {seePeople && roster.length > 0 && (
            <SelectField label={t('fitness.pickWorker', 'Worker on the roster')} value={workerId} onChange={setWorkerId}
              options={[{ value: '', label: t('fitness.pickWorkerNone', 'Choose a worker') }, ...roster.map((w) => ({ value: w.worker_id, label: w.display_name }))]} />
          )}
          {!workerId && <TextField label={t('fitness.visitor', 'Or a named visitor')} value={visitor} onChange={setVisitor} />}
          {(types.data?.length ?? 0) > 0 && (
            <SelectField label={t('fitness.type', 'Check')} value={typeId} onChange={setTypeId}
              options={[{ value: '', label: t('fitness.typeNone', 'No specific check') }, ...(types.data ?? []).map((x) => ({ value: x.id, label: x.label }))]} />
          )}
          <SelectField label={t('fitness.resultLabel', 'Result')} value={result} onChange={(v) => setResult(v as SafetyFitnessCheck['result'])}
            options={(['fit', 'not_fit', 'not_checked'] as const).map((r) => ({ value: r, label: resultLabel(r) }))} />
          {result === 'not_fit' && <TextField label={t('fitness.note', 'Note (required when not fit)')} value={note} onChange={setNote} required />}
          <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={!canAdd || m.saveFitness.isPending} data-testid="safety-fitness-add">{t('fitness.add', 'Add check')}</Button></div>
        </form>
      )}
    </RecordSection>
  );
};
