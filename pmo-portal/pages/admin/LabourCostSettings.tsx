import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ConfirmDialog, DateField, EntityFormModal, FormGrid, ListState, SelectField, TextField, useToast, type SubmitError } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useUsers } from '@/src/hooks/useUsers';
import { useLabourClasses, useLabourCostEnabled, useLabourCostMutations, useLabourRates } from '@/src/hooks/useLabourCost';
import { validateRateInput, type LabourClass, type LabourRate, type LabourRateInput, type RateBasis, type RateSubject } from '@/src/lib/db/labourCost';
import { formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import LabourClassAssignments from './LabourClassAssignments';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * Administration › Labour cost (#2670, spec docs/specs/labour-cost-money.spec.md). Admin and Finance switch labour
 * cost in money on, keep the labour classes and the cost rates (per person or per role). OFF by default. The
 * migration-1250 RPCs and RLS are the authority (ADR-0016); `can()` only hides what would be refused. Cost words only.
 * Role choices come from the roles the organisation's people actually hold, never a list written in code.
 */
const BASES: RateBasis[] = ['hourly', 'daily', 'monthly'];

type ClassForm = { mode: 'add' } | { mode: 'rename'; row: LabourClass };

export default function LabourCostSettings() {
  const { t } = useTranslation('administration');
  const may = usePermission();
  const canView = may('view', 'labourCost');
  const canManage = may('manage', 'labourCost');
  const { toast } = useToast();
  const enabledQ = useLabourCostEnabled(canView);
  const enabled = enabledQ.data === true;
  const classesQ = useLabourClasses(canView && enabled);
  const ratesQ = useLabourRates(canView && enabled);
  const m = useLabourCostMutations();
  const [classForm, setClassForm] = useState<ClassForm | null>(null);
  const [rateForm, setRateForm] = useState(false);
  const [endFor, setEndFor] = useState<LabourRate | null>(null);
  const [archiveFor, setArchiveFor] = useState<LabourRate | null>(null);
  const [endDate, setEndDate] = useState('');
  if (!canView) return null;

  const refusals = {
    '42501': t('labourCost.adminOnly', 'Only an Admin or Finance can change labour cost settings.'),
    '23514': t('labourCost.locked', 'This would change hours already priced on approved timesheets. Start the new rate after the last priced day.'),
    '23505': t('labourCost.duplicate', 'A rate for this person, role or class already starts on that date.'),
  };
  const fail = (e: unknown) => { const c = classifyMutationError(e, refusals); toast(c.headline, c.detail, 'warning'); };
  const classes = classesQ.data ?? [];
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? '';
  const money = (v: string) => formatExactMoney(v, '', getNumberLocale()) ?? v;
  const rates = ratesQ.data ?? [];
  const title = t('labourCost.title', 'Labour cost');

  return <section aria-label={title} className="max-w-3xl space-y-4" data-testid="labour-cost-settings">
    <h3 className="text-base font-semibold">{title}</h3>
    <p className="text-sm text-muted-foreground">{t('labourCost.intro', 'Turn approved timesheet hours into cost in money on each work order, at a cost rate you set for a person or a role. This is cost only, not pay.')}</p>
    {enabledQ.isError ? <ListState variant="error" title={t('labourCost.loadError', "Couldn't load labour cost settings")} retryLabel={t('admin.retry', 'Retry')} onRetry={() => void enabledQ.refetch()} />
      : enabledQ.data === undefined ? <ListState variant="loading" rows={2} />
      : <Checkbox checked={enabled} disabled={!canManage || m.setEnabled.isPending}
          label={t('labourCost.switch', 'Cost approved hours in money')}
          onChange={(v) => m.setEnabled.mutate(v, { onError: fail })}>{t('labourCost.switch', 'Cost approved hours in money')}</Checkbox>}
    {!canManage && <p className="text-sm text-muted-foreground">{t('labourCost.adminOnly', 'Only an Admin or Finance can change labour cost settings.')}</p>}

    {enabled && <>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold">{t('labourCost.classes', 'Labour classes')}</h4>
        {canManage && <Button variant="outline" size="sm" onClick={() => setClassForm({ mode: 'add' })}>{t('labourCost.addClass', 'Add class')}</Button>}
      </div>
      {classesQ.isError ? <ListState variant="error" title={t('labourCost.loadError', "Couldn't load labour cost settings")} retryLabel={t('admin.retry', 'Retry')} onRetry={() => void classesQ.refetch()} />
        : !classesQ.data ? <ListState variant="loading" rows={2} />
        : <ul className="divide-y divide-border text-sm" data-testid="labour-classes">{classes.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-2">
            <span className={c.archivedAt ? 'text-muted-foreground' : 'font-medium'}>{c.name}{c.archivedAt ? ` (${t('labourCost.archived', 'archived')})` : ''}</span>
            {canManage && <span className="flex gap-1.5">
              <Button variant="ghost" size="sm" aria-label={t('labourCost.renameLabel', 'Rename {{name}}', { name: c.name })} onClick={() => setClassForm({ mode: 'rename', row: c })}>{t('labourCost.rename', 'Rename')}</Button>
              <Button variant="ghost" size="sm" aria-label={t('labourCost.archiveClassLabel', '{{action}} {{name}}', { action: c.archivedAt ? t('labourCost.restore', 'Restore') : t('labourCost.archive', 'Archive'), name: c.name })}
                onClick={() => m.archiveClass.mutate({ id: c.id, archived: !c.archivedAt }, { onError: fail })}>{c.archivedAt ? t('labourCost.restore', 'Restore') : t('labourCost.archive', 'Archive')}</Button>
            </span>}
          </li>))}</ul>}

      <div className="flex items-center justify-between gap-3 pt-2">
        <h4 className="text-sm font-semibold">{t('labourCost.rates', 'Cost rates')}</h4>
        {canManage && classes.some((c) => !c.archivedAt) && <Button variant="outline" size="sm" onClick={() => setRateForm(true)}>{t('labourCost.addRate', 'Add rate')}</Button>}
      </div>
      {ratesQ.isError ? <ListState variant="error" title={t('labourCost.loadError', "Couldn't load labour cost settings")} retryLabel={t('admin.retry', 'Retry')} onRetry={() => void ratesQ.refetch()} />
        : !ratesQ.data ? <ListState variant="loading" rows={2} />
        : rates.length === 0 ? <p className="text-sm text-muted-foreground">{t('labourCost.noRates', 'No rates yet. Hours with no rate stay as hours, with no money.')}</p>
        : <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="labour-rates">
          <thead><tr className="text-left text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-normal">{t('labourCost.appliesTo', 'Applies to')}</th>
            <th scope="col" className="py-2 pr-4 font-normal">{t('labourCost.class', 'Class')}</th>
            <th scope="col" className="py-2 pr-4 text-right font-normal">{t('labourCost.rate', 'Rate')}</th>
            <th scope="col" className="py-2 pr-4 font-normal">{t('labourCost.period', 'From – to')}</th>
            {canManage && <th scope="col" className="py-2 font-normal"><span className="sr-only">{t('labourCost.actions', 'Actions')}</span></th>}
          </tr></thead>
          <tbody>{rates.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="py-2 pr-4 font-medium">{r.subjectKind === 'person' ? (r.personName ?? '') : r.subjectKind === 'class' ? t('labourCost.subjectClassCell', 'People with no login in this class') : r.roleKey}</td>
              <td className="py-2 pr-4">{className(r.classId)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{money(r.amount)} {t(`labourCost.basis.${r.basis}`, r.basis)}
                {Number(r.overtimeMultiplier) > 1 && <div className="text-muted-foreground">{t('labourCost.overtimeShort', 'Overtime ×{{n}}', { n: Number(r.overtimeMultiplier) })}</div>}</td>
              <td className="py-2 pr-4 tabular-nums">{r.effectiveFrom} – {r.effectiveTo ?? t('labourCost.open', 'open')}</td>
              {canManage && <td className="py-2 text-right"><span className="flex justify-end gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => { setEndFor(r); setEndDate(''); }}>{t('labourCost.end', 'End')}</Button>
                <Button variant="ghost" size="sm" onClick={() => setArchiveFor(r)}>{t('labourCost.archive', 'Archive')}</Button>
              </span></td>}
            </tr>))}</tbody>
        </table></div>}
      <LabourClassAssignments classes={classes} canManage={canManage} />
    </>}

    {classForm && <ClassFormModal target={classForm} refusals={refusals} onClose={() => setClassForm(null)}
      onSave={async (code, name) => {
        if (classForm.mode === 'add') await m.addClass.mutateAsync({ code, name });
        else await m.renameClass.mutateAsync({ id: classForm.row.id, name });
        toast(t('labourCost.classSaved', 'Class saved'), name, 'success');
        setClassForm(null);
      }} />}
    {rateForm && <RateFormModal classes={classes.filter((c) => !c.archivedAt)} refusals={refusals} onClose={() => setRateForm(false)}
      onSave={async (input) => { await m.saveRate.mutateAsync(input); toast(t('labourCost.rateSaved', 'Rate saved'), undefined, 'success'); setRateForm(false); }} />}
    <EntityFormModal open={Boolean(endFor)} title={t('labourCost.endTitle', 'End this rate')} submitLabel={t('labourCost.end', 'End')}
      submitDisabled={!endDate || m.endRate.isPending} loading={m.endRate.isPending} dirty={false} submitError={null}
      onClose={() => setEndFor(null)}
      onSubmit={(e) => { e.preventDefault(); if (!endFor || !endDate) return;
        m.endRate.mutate({ id: endFor.id, endDate }, { onSuccess: () => setEndFor(null), onError: fail }); }}>
      <DateField label={t('labourCost.lastDay', 'Last day of this rate')} required value={endDate} min={endFor?.effectiveFrom} onChange={setEndDate} fullWidth />
    </EntityFormModal>
    <ConfirmDialog open={Boolean(archiveFor)} tone="default" title={t('labourCost.archiveTitle', 'Archive this rate?')}
      description={t('labourCost.archiveDescription', 'It stops applying. A rate that already priced approved hours cannot be archived: end it instead.')}
      confirmLabel={t('labourCost.archiveRate', 'Archive rate')} loading={m.archiveRate.isPending}
      onConfirm={() => archiveFor && m.archiveRate.mutate(archiveFor.id, { onSuccess: () => setArchiveFor(null), onError: (e) => { setArchiveFor(null); fail(e); } })}
      onCancel={() => setArchiveFor(null)} />
  </section>;
}

const ClassFormModal: React.FC<{ target: ClassForm; refusals: Record<string, string>; onClose: () => void; onSave: (code: string, name: string) => Promise<void> }> = ({ target, refusals, onClose, onSave }) => {
  const { t } = useTranslation('administration');
  const [name, setName] = useState(target.mode === 'rename' ? target.row.name : '');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<SubmitError | null>(null);
  const codeOk = target.mode === 'rename' || /^[a-z0-9_]{1,40}$/.test(code.trim());
  const invalid = !name.trim() || name.trim().length > 60 || !codeOk;
  return <EntityFormModal open title={target.mode === 'add' ? t('labourCost.addClass', 'Add class') : t('labourCost.renameTitle', 'Rename class')}
    submitLabel={t('labourCost.save', 'Save')} submitDisabled={invalid} dirty={name !== ''} submitError={err} onClose={onClose}
    onSubmit={(e) => { e.preventDefault(); if (invalid) return; setErr(null); onSave(code.trim(), name.trim()).catch((x: unknown) => setErr(classifyMutationError(x, refusals))); }}>
    <FormGrid>
      {target.mode === 'add' && <TextField id="labour-class-code" label={t('labourCost.classCode', 'Code (lower case letters, digits, _)')} value={code} onChange={setCode} required autoComplete="off" />}
      <TextField id="labour-class-name" label={t('labourCost.className', 'Name')} value={name} onChange={setName} required maxLength={60} autoComplete="off" />
    </FormGrid>
  </EntityFormModal>;
};

const RateFormModal: React.FC<{ classes: LabourClass[]; refusals: Record<string, string>; onClose: () => void; onSave: (i: LabourRateInput) => Promise<void> }> = ({ classes, refusals, onClose, onSave }) => {
  const { t } = useTranslation('administration');
  const users = useUsers();
  const [subjectKind, setSubjectKind] = useState<RateSubject>('role');
  const [personId, setPersonId] = useState('');
  const [roleKey, setRoleKey] = useState('');
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [basis, setBasis] = useState<RateBasis>('hourly');
  const [amount, setAmount] = useState('');
  const [overtime, setOvertime] = useState('1');
  const [dayHours, setDayHours] = useState('8');
  const [monthHours, setMonthHours] = useState('173');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [err, setErr] = useState<SubmitError | null>(null);
  const roles = useMemo(() => [...new Set((users.data ?? []).map((u) => String(u.role)))].sort(), [users.data]);
  const input: LabourRateInput = { subjectKind, personId, roleKey, classId, basis, amount, overtimeMultiplier: overtime, dayHours, monthHours, effectiveFrom: from, effectiveTo: to || null };
  const problem = validateRateInput(input);
  const bad = (p: string) => (problem === p ? t(`labourCost.problem.${p}`, 'Check this field.') : undefined);
  return <EntityFormModal open title={t('labourCost.addRate', 'Add rate')} submitLabel={t('labourCost.saveRate', 'Save rate')}
    submitDisabled={problem !== null} dirty={amount !== '' || from !== ''} submitError={err} onClose={onClose}
    onSubmit={(e) => { e.preventDefault(); if (problem) return; setErr(null); onSave(input).catch((x: unknown) => setErr(classifyMutationError(x, refusals))); }}>
    <FormGrid>
      <SelectField label={t('labourCost.appliesTo', 'Applies to')} value={subjectKind} onChange={(v) => setSubjectKind(v as RateSubject)} fullWidth
        options={[{ value: 'role', label: t('labourCost.subjectRole', 'A role') }, { value: 'person', label: t('labourCost.subjectPerson', 'One person') },
          { value: 'class', label: t('labourCost.subjectClass', 'A labour class (people with no login)') }]} />
      {subjectKind === 'class' ? null : subjectKind === 'person'
        ? <SelectField label={t('labourCost.person', 'Person')} value={personId} onChange={setPersonId} fullWidth
            options={[{ value: '', label: t('labourCost.choosePerson', 'Choose a person') }, ...(users.data ?? []).map((u) => ({ value: u.id, label: u.full_name ?? u.email ?? u.id }))]} />
        : <SelectField label={t('labourCost.role', 'Role')} value={roleKey} onChange={setRoleKey} fullWidth required
            options={[{ value: '', label: t('labourCost.chooseRole', 'Choose a role') }, ...roles.map((r) => ({ value: r, label: r }))]} />}
      <SelectField label={t('labourCost.class', 'Class')} value={classId} onChange={setClassId} fullWidth required options={classes.map((c) => ({ value: c.id, label: c.name }))} />
      <SelectField label={t('labourCost.basisLabel', 'Rate is')} value={basis} onChange={(v) => setBasis(v as RateBasis)} fullWidth
        options={BASES.map((b) => ({ value: b, label: t(`labourCost.basis.${b}`, b) }))} />
      <TextField id="labour-rate-amount" label={t('labourCost.amount', 'Amount')} value={amount} onChange={setAmount} required inputMode="decimal" error={amount !== '' ? bad('amount') : undefined} autoComplete="off" />
      <TextField id="labour-rate-overtime" label={t('labourCost.overtime', 'Overtime multiplier')} value={overtime} onChange={setOvertime} inputMode="decimal" error={bad('multiplier')} autoComplete="off" />
      <TextField id="labour-rate-day" label={t('labourCost.dayHours', 'Hours in a working day')} value={dayHours} onChange={setDayHours} inputMode="decimal" error={bad('dayHours')} autoComplete="off" />
      {basis === 'monthly' && <TextField id="labour-rate-month" label={t('labourCost.monthHours', 'Hours in a month')} value={monthHours} onChange={setMonthHours} inputMode="decimal" error={bad('monthHours')} autoComplete="off" />}
      <DateField label={t('labourCost.from', 'From')} required value={from} onChange={setFrom} fullWidth />
      <DateField label={t('labourCost.to', 'To (optional)')} value={to} min={from || undefined} onChange={setTo} fullWidth />
    </FormGrid>
  </EntityFormModal>;
};
