import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Combobox, ConfirmDialog, DateField, EntityFormModal, FormGrid, ListState, SelectField, useToast, type SubmitError } from '@/src/components/ui';
import { useLabourClassAssignments, useLabourCostMutations, usePeopleWithoutLogin } from '@/src/hooks/useLabourCost';
import { validateAssignmentInput, type LabourClass, type LabourClassAssignment } from '@/src/lib/db/labourCost';
import { useRefusalText } from '@/src/lib/refusals';
import { formatDay } from '@/src/lib/format';

/**
 * Administration › Labour cost › Crew member classes (no-login-labour-cost, FR-NLL-002/011). A person in the people
 * register with no login holds a labour class from a date; their approved attendance is costed at that class's rate.
 * The 1720 actions and RLS are the authority (ADR-0016); `canManage` only hides what would be refused. A change that
 * would re-cost a day already costed is refused by the database and explained from the refusals catalogue.
 */
interface Props { classes: LabourClass[]; canManage: boolean }

export default function LabourClassAssignments({ classes, canManage }: Props) {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const refusal = useRefusalText();
  const listQ = useLabourClassAssignments();
  const m = useLabourCostMutations();
  const [adding, setAdding] = useState(false);
  const [endFor, setEndFor] = useState<LabourClassAssignment | null>(null);
  const [endDate, setEndDate] = useState('');
  const [archiveFor, setArchiveFor] = useState<LabourClassAssignment | null>(null);
  const fail = (e: unknown) => { const r = refusal(e); toast(r.headline, r.detail || undefined, 'warning'); };
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? '';
  const live = classes.filter((c) => !c.archivedAt);
  const rows = listQ.data ?? [];
  const title = t('labourCost.assignments.title', 'Crew member classes');

  return <div className="space-y-2 pt-2">
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-sm font-semibold">{title}</h4>
      {canManage && live.length > 0 && <Button variant="outline" size="sm" onClick={() => setAdding(true)}>{t('labourCost.assignments.add', 'Assign a class')}</Button>}
    </div>
    <p className="text-sm text-muted-foreground">{t('labourCost.assignments.intro', 'People with no login are costed by their class: a class rate prices their approved attendance.')}</p>
    {listQ.isError ? <ListState variant="error" title={t('labourCost.loadError', "Couldn't load labour cost settings")} retryLabel={t('admin.retry', 'Retry')} onRetry={() => void listQ.refetch()} />
      : !listQ.data ? <ListState variant="loading" rows={2} />
      : rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('labourCost.assignments.empty', 'No crew member has a labour class yet. Admin or Finance adds one here; until then their approved hours carry no rate.')}</p>
      : <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="labour-class-assignments">
        <thead><tr className="text-left text-muted-foreground">
          <th scope="col" className="py-2 pr-4 font-normal">{t('labourCost.assignments.person', 'Person')}</th>
          <th scope="col" className="py-2 pr-4 font-normal">{t('labourCost.class', 'Class')}</th>
          <th scope="col" className="py-2 pr-4 font-normal">{t('labourCost.period', 'From – to')}</th>
          {canManage && <th scope="col" className="py-2 font-normal"><span className="sr-only">{t('labourCost.actions', 'Actions')}</span></th>}
        </tr></thead>
        <tbody>{rows.map((r) => {
          const name = r.workerName ?? '';
          return <tr key={r.id} className="border-t border-border align-top">
            <td className="py-2 pr-4 font-medium">{name}</td>
            <td className="py-2 pr-4">{className(r.classId)}</td>
            <td className="py-2 pr-4 tabular-nums">{formatDay(r.effectiveFrom)} – {r.effectiveTo ? formatDay(r.effectiveTo) : t('labourCost.open', 'open')}</td>
            {canManage && <td className="py-2 text-right"><span className="flex justify-end gap-1.5">
              <Button variant="ghost" size="sm" aria-label={t('labourCost.assignments.endLabel', 'End {{name}}', { name })} onClick={() => { setEndFor(r); setEndDate(''); }}>{t('labourCost.end', 'End')}</Button>
              <Button variant="ghost" size="sm" aria-label={t('labourCost.assignments.archiveLabel', 'Archive {{name}}', { name })} onClick={() => setArchiveFor(r)}>{t('labourCost.archive', 'Archive')}</Button>
            </span></td>}
          </tr>;
        })}</tbody>
      </table></div>}

    {adding && <AssignmentFormModal classes={live} onClose={() => setAdding(false)}
      onSave={async (input) => { await m.saveAssignment.mutateAsync(input); toast(t('labourCost.assignments.saved', 'Class assigned'), undefined, 'success'); setAdding(false); }} />}
    <EntityFormModal open={Boolean(endFor)} title={t('labourCost.assignments.endTitle', 'End this class')} submitLabel={t('labourCost.end', 'End')}
      submitDisabled={!endDate || m.endAssignment.isPending} loading={m.endAssignment.isPending} dirty={false} submitError={null}
      onClose={() => setEndFor(null)}
      onSubmit={(e) => { e.preventDefault(); if (!endFor || !endDate) return;
        m.endAssignment.mutate({ id: endFor.id, endDate }, { onSuccess: () => setEndFor(null), onError: fail }); }}>
      <DateField label={t('labourCost.assignments.lastDay', 'Last day in this class')} required value={endDate} min={endFor?.effectiveFrom} onChange={setEndDate} fullWidth />
    </EntityFormModal>
    <ConfirmDialog open={Boolean(archiveFor)} tone="default" title={t('labourCost.assignments.archiveTitle', 'Archive this class?')}
      description={t('labourCost.assignments.archiveDescription', 'It stops applying. A class that already costs approved days cannot be archived: end it instead.')}
      confirmLabel={t('labourCost.assignments.archiveConfirm', 'Archive class')} loading={m.archiveAssignment.isPending}
      onConfirm={() => archiveFor && m.archiveAssignment.mutate(archiveFor.id, { onSuccess: () => setArchiveFor(null), onError: (e) => { setArchiveFor(null); fail(e); } })}
      onCancel={() => setArchiveFor(null)} />
  </div>;
}

const AssignmentFormModal: React.FC<{ classes: LabourClass[]; onClose: () => void; onSave: (i: { workerId: string; classId: string; effectiveFrom: string; effectiveTo: string | null }) => Promise<void> }> = ({ classes, onClose, onSave }) => {
  const { t } = useTranslation('administration');
  const refusal = useRefusalText();
  const peopleQ = usePeopleWithoutLogin();
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [err, setErr] = useState<SubmitError | null>(null);
  const options = useMemo(() => (peopleQ.data ?? []).map((p) => ({ value: p.id, label: p.name, sub: p.code })), [peopleQ.data]);
  const input = { workerId: workerId ?? '', classId, effectiveFrom: from, effectiveTo: to || null };
  const problem = validateAssignmentInput(input);
  return <EntityFormModal open title={t('labourCost.assignments.add', 'Assign a class')} submitLabel={t('labourCost.save', 'Save')}
    submitDisabled={problem !== null} dirty={workerId !== null || from !== ''} submitError={err} onClose={onClose}
    onSubmit={(e) => { e.preventDefault(); if (problem) return; setErr(null);
      onSave(input).catch((x: unknown) => { const r = refusal(x); setErr({ headline: r.headline, detail: r.detail }); }); }}>
    <FormGrid>
      <Combobox label={t('labourCost.assignments.person', 'Person')} value={workerId} required
        selectedOption={options.find((o) => o.value === workerId) ?? null}
        onChange={(v) => setWorkerId(v)} loadOptions={async () => options}
        statusOverride={peopleQ.isError ? 'error' : peopleQ.isPending ? 'loading' : undefined} onRetry={() => void peopleQ.refetch()}
        noun={t('labourCost.assignments.personNoun', 'person')} nounPlural={t('labourCost.assignments.personNounPlural', 'people')}
        helper={t('labourCost.assignments.personHelp', 'People in the register with no login.')}
        emptyMessage={t('labourCost.assignments.noPeople', 'Everyone in the people register has a login. Add the crew member under People first.')} />
      <SelectField label={t('labourCost.class', 'Class')} value={classId} onChange={setClassId} fullWidth required options={classes.map((c) => ({ value: c.id, label: c.name }))} />
      <DateField label={t('labourCost.from', 'From')} required value={from} onChange={setFrom} fullWidth />
      <DateField label={t('labourCost.to', 'To (optional)')} value={to} min={from || undefined} onChange={setTo} fullWidth />
    </FormGrid>
  </EntityFormModal>;
};
