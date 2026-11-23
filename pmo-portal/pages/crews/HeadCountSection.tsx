import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ConfirmDialog, ListState, SelectField, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useHeadcountDay, useHeadcountMutations } from '@/src/hooks/useHeadcount';
import { useLabourClasses } from '@/src/hooks/useLabourCost';
import type { HeadcountLine } from '@/src/lib/repositories/headcount';
import { refusalLine, useRefusalText } from '@/src/lib/refusals';

interface Props {
  crewId: string;
  fieldControllerId: string | null;
  workOrderId: string;
  date: string;
  /** Named people of this crew ticked present that day: shown so the keeper never counts one of them again. */
  namedPresent: number;
}

/**
 * Head count of one crew on one day: people who are not named on the roster (for example guards or helpers with no login),
 * entered as a number per labour class. Cost = number x the class's daily rate, priced by the database once a different
 * approver approves the line (docs/specs/guard-headcount.spec.md). The screen shows no money and no rate.
 */
export const HeadCountSection: React.FC<Props> = ({ crewId, fieldControllerId, workOrderId, date, namedPresent }) => {
  const { t } = useTranslation('crews');
  const refusal = useRefusalText();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  const userId = useAuth().currentUser?.id ?? null;
  const day = useHeadcountDay(workOrderId, date);
  const classes = useLabourClasses();
  const { record, approve, clear } = useHeadcountMutations();
  const [classId, setClassId] = useState('');
  const [count, setCount] = useState('');
  const [countError, setCountError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState<HeadcountLine | null>(null);

  const canRecord = may('create', 'headcount', { currentUserId: userId, record: { field_controller_id: fieldControllerId, viewOnly } });
  const canApproveRole = may('approve', 'headcount', { currentUserId: userId, record: { viewOnly } });
  const className = (id: string) => classes.data?.find((c) => c.id === id)?.name ?? '—';
  const lines = (day.data ?? []).filter((l) => l.crewId === crewId);
  const text = (err: unknown) => String((err as { message?: string })?.message ?? '').startsWith('separation of duties')
    ? t('headCount.sod', 'You entered this head count, so someone else approves it.')
    : refusalLine(refusal(err));

  const save = async () => {
    setProblem(null);
    const n = /^\d{1,4}$/.test(count.trim()) ? Number(count.trim()) : NaN;
    if (!classId) { setCountError(null); setProblem(t('headCount.pickClass', 'Choose a labour class.')); return; }
    if (!(n >= 1 && n <= 500)) { setCountError(t('headCount.countRange', 'Enter a whole number from 1 to 500.')); return; }
    setCountError(null);
    setBusy(true);
    try {
      await record.mutateAsync({ workOrderId, crewId, workDate: date, classId, count: n });
      setCount('');
      toast(t('headCount.saved', 'Head count saved'), undefined, 'success');
    } catch (err) { setProblem(text(err)); } finally { setBusy(false); }
  };
  const approveLine = async (l: HeadcountLine) => {
    setProblem(null);
    try { await approve.mutateAsync(l.id); toast(t('headCount.approvedToast', 'Head count approved'), undefined, 'success'); } catch (err) { setProblem(text(err)); }
  };
  const confirmClear = async () => {
    const l = clearing;
    if (!l) return;
    setProblem(null);
    try { await clear.mutateAsync(l.id); setClearing(null); } catch (err) { setClearing(null); setProblem(text(err)); }
  };

  return (
    <Card>
      <CardHead>{t('headCount.title', 'Head count')}</CardHead>
      <CardPad>
        <p className="mb-3 text-control text-muted-foreground">
          {t('headCount.named', '{{n}} named people are ticked present on this crew today. Count here only the people not named on the roster.', { n: namedPresent })}
        </p>
        {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
        {day.isPending && <ListState variant="loading" shape="table" rows={2} />}
        {!day.isPending && day.isError && (
          <ListState variant="error" title={t('headCount.error', "Couldn't load the head count")} onRetry={() => { void day.refetch(); }} retryLabel={t('crews:retry', 'Retry')} />
        )}
        {!day.isPending && !day.isError && lines.length === 0 && (
          <p className="mb-3 text-control text-foreground">
            {t('headCount.empty', 'No head count entered for this day. The crew\'s Foreman or a crew manager adds it here. A person is either named and ticked above or counted here, never both.')}
          </p>
        )}
        {lines.length > 0 && (
          <table className="mb-4 w-full text-sm">
            <thead><tr className="text-left text-muted-foreground">
              <th scope="col" className="py-2 font-normal">{t('headCount.class', 'Labour class')}</th>
              <th scope="col" className="w-28 py-2 font-normal">{t('headCount.people', 'People')}</th>
              <th scope="col" className="py-2 font-normal">{t('headCount.state', 'Status')}</th>
              <th scope="col" className="py-2 text-right font-normal"><span className="sr-only">{t('headCount.actions', 'Actions')}</span></th>
            </tr></thead>
            <tbody>
              {lines.map((l) => {
                const entrant = !!userId && l.recordedByIds.includes(userId);
                return (
                  <tr key={l.id} aria-label={className(l.classId)} className="border-t border-border align-top">
                    <th scope="row" className="py-2 pr-2 text-left font-normal text-foreground">{className(l.classId)}</th>
                    <td className="py-2 pr-2 tabular-nums">{l.headCount}</td>
                    <td className="py-2 pr-2">{l.approvedAt ? t('headCount.approved', 'Approved') : t('headCount.waiting', 'Waiting for approval')}</td>
                    <td className="py-2 text-right">
                      {!l.approvedAt && (
                        <div className="inline-flex flex-wrap items-center justify-end gap-2">
                          {canApproveRole && entrant && <span className="text-control text-muted-foreground">{t('headCount.differentApprover', 'A different approver must approve this line.')}</span>}
                          {canApproveRole && <Button variant="primary" size="sm" disabled={entrant || viewOnly} onClick={() => void approveLine(l)}>{t('headCount.approve', 'Approve')}</Button>}
                          {canRecord && <Button variant="outline" size="sm" onClick={() => setClearing(l)}>{t('headCount.clear', 'Clear')}</Button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {canRecord ? (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
            <SelectField label={t('headCount.class', 'Labour class')} value={classId} onChange={setClassId} placeholder={t('headCount.chooseClass', 'Choose a class')}
              options={(classes.data ?? []).filter((c) => c.archivedAt === null).map((c) => ({ value: c.id, label: c.name }))} disabled={busy} />
            <TextField label={t('headCount.number', 'Number of people')} value={count} inputMode="numeric" onChange={setCount} error={countError ?? undefined}
              helper={t('headCount.replace', 'Saving a class again before approval replaces its number.')} disabled={busy} />
            <Button variant="primary" onClick={() => void save()} disabled={busy}>{t('headCount.save', 'Save head count')}</Button>
          </div>
        ) : (
          <p className="text-control text-foreground">{t('headCount.readOnly', "Only this crew's Foreman or a crew manager enters a head count.")}</p>
        )}
      </CardPad>
      <ConfirmDialog open={clearing !== null} tone="destructive" title={t('headCount.clearTitle', 'Clear this head count?')}
        description={t('headCount.clearBody', 'The number for this class and day is removed. You can enter it again.')}
        confirmLabel={t('headCount.clearConfirm', 'Clear head count')} loading={clear.isPending} onCancel={() => setClearing(null)} onConfirm={() => void confirmClear()} />
    </Card>
  );
};
