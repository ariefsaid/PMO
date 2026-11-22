import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, ConfirmDialog, DataTable, DateField, EntityFormModal, FormGrid, Icon, ListState, SelectField,
  useEntityForm, useToast, type Column, type SubmitError,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useCrewMembers, useCrewSchedule, useCrewWorkers, useCrews } from '@/src/hooks/useCrews';
import { useCrewLoanMutations, useCrewLoans } from '@/src/hooks/useCrewLoans';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import type { CrewLoanRow } from '@/src/lib/repositories/crews';
import { formatDay } from '@/src/lib/format';
import { toIso } from '../equipment/equipmentWeek';
import { uncoveredLoanDays } from '@/src/lib/crewLoanCoverage';
import { useCrewErrorText } from './crewErrors';

/** Lend a worker from their home crew to another crew for a period (FR-LOAN-001/002). */
const LendWorkerModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation('crews');
  const writeError = useCrewErrorText();
  const { toast } = useToast();
  const { lend } = useCrewLoanMutations();
  const crews = useCrews();
  const workers = useCrewWorkers();
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const today = toIso(new Date());
  const form = useEntityForm({
    initialValues: { home: '', worker: '', host: '', from: today, to: today },
    idPrefix: 'crew-loan',
    requiredFields: ['home', 'worker', 'host', 'from', 'to'],
    validate: (v) => (v.to && v.from && v.to < v.from ? { to: t('crews:loans.toBeforeFrom', 'The end cannot be before the start') } : {}),
  });
  const members = useCrewMembers(form.values.home || null);
  const hostSchedule = useCrewSchedule(form.values.host || null);
  // A lent person shows on a roster only on days the host crew is on a work order: say so before lending.
  const uncovered = form.values.host && hostSchedule.data
    ? uncoveredLoanDays(form.values.from, form.values.to, hostSchedule.data) : [];
  const hostName = crews.data?.find((c) => c.id === form.values.host)?.name ?? '';
  // The database keeps a lent person on the home crew on a day the host is not scheduled (1630): name that roster.
  const homeName = crews.data?.find((c) => c.id === form.values.home)?.name ?? '';
  const spanDays = form.values.from && form.values.to && form.values.to >= form.values.from
    ? Math.round((Date.parse(form.values.to) - Date.parse(form.values.from)) / 86_400_000) + 1 : 0;
  const hostNeverScheduled = uncovered.length > 0 && uncovered.length === spanDays;
  const live = (crews.data ?? []).filter((c) => !c.archived_at);
  const crewOptions = (exclude?: string) => [{ value: '', label: t('crews:loans.chooseCrew', 'Choose a crew') },
    ...live.filter((c) => c.id !== exclude).map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))];
  const people = useMemo(() => {
    const seen = new Set<string>();
    return (members.data ?? []).filter((m) => (!m.valid_to || m.valid_to >= today) && !seen.has(m.worker_id) && seen.add(m.worker_id))
      .map((m) => ({ value: m.worker_id, label: workers.data?.find((w) => w.id === m.worker_id)?.display_name ?? '—' }));
  }, [members.data, workers.data, today]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (v) => {
      try {
        await lend.mutateAsync({ worker_id: v.worker, home_crew_id: v.home, host_crew_id: v.host, valid_from: v.from, valid_to: v.to });
        toast(t('crews:loans.lent', 'Worker lent'), undefined, 'success');
        onClose();
      } catch (err) {
        setSubmitError({ headline: t('crews:saveFailed', 'Not saved'), detail: writeError(err) });
      }
    });
  };
  return (
    <EntityFormModal open title={t('crews:loans.lendTitle', 'Lend a worker to another crew')} submitLabel={t('crews:loans.lend', 'Lend worker')}
      onSubmit={submit} onClose={onClose} loading={form.isSubmitting} dirty={form.isDirty} submitDisabled={!form.isComplete || hostNeverScheduled}
      submitError={submitError}>
      <FormGrid>
        <SelectField label={t('crews:loans.homeCrew', 'Home crew')} required value={form.values.home}
          onChange={(v) => { form.setValue('home', v); form.setValue('worker', ''); if (form.values.host === v) form.setValue('host', ''); }}
          options={crewOptions()} />
        <SelectField label={t('crews:person', 'Person')} required value={form.values.worker} onChange={(v) => form.setValue('worker', v)}
          disabled={!form.values.home}
          options={[{ value: '', label: t('crews:loans.choosePerson', 'Choose a person') }, ...people]} />
        <SelectField label={t('crews:loans.hostCrew', 'Host crew')} required value={form.values.host} onChange={(v) => form.setValue('host', v)}
          options={crewOptions(form.values.home)} />
        {uncovered.length > 0 && (
          <p role={hostNeverScheduled ? 'alert' : 'status'} data-testid="loan-host-coverage"
            className={`sm:col-span-2 text-sm ${hostNeverScheduled ? 'text-destructive-text' : 'text-warning-foreground'}`}>
            {hostNeverScheduled
              ? t('crews:loans.hostNotScheduled', '{{crew}} is not on any work order on these days, so this person would show on no roster and no hours would count. Schedule {{crew}} on a work order first, or choose another crew.', { crew: hostName })
              : t('crews:loans.hostPartlyScheduled', '{{crew}} is not on any work order on {{days}}. On those days this person stays on the {{home}} roster.', { crew: hostName, days: uncovered.map((d) => formatDay(d)).join(', '), home: homeName })}
          </p>
        )}
        <DateField label={t('crews:from', 'From')} required value={form.values.from} onChange={(v) => form.setValue('from', v)} />
        <DateField label={t('crews:to', 'To')} required value={form.values.to} onChange={(v) => form.setValue('to', v)} min={form.values.from}
          error={form.errors.to} />
      </FormGrid>
    </EntityFormModal>
  );
};

/**
 * Crew loans (#2704): who is lent to which crew, and when. Shown only where the organisation turned crew loans on
 * (Administration); otherwise the Crews page is exactly as it was. Lending is for those who manage crews (UX gate;
 * RLS is the authority, ADR-0016).
 */
export const CrewLoans: React.FC = () => {
  const { t } = useTranslation('crews');
  const writeError = useCrewErrorText();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const canManage = may('manage', 'crew', { record: { viewOnly: realRole !== effectiveRole } });
  const enabled = useOrgSwitch('crewLoans');
  const on = enabled.data === true;
  const loans = useCrewLoans(on);
  const crews = useCrews();
  const workers = useCrewWorkers();
  const { endLoan } = useCrewLoanMutations();
  const [lending, setLending] = useState(false);
  const [ending, setEnding] = useState<CrewLoanRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!on) return null;
  const today = toIso(new Date());
  const crewName = (id: string) => crews.data?.find((c) => c.id === id)?.name ?? '—';
  const workerName = (id: string) => workers.data?.find((w) => w.id === id)?.display_name ?? '—';
  const end = async () => {
    const l = ending;
    if (!l) return;
    setEnding(null);
    setProblem(null);
    try {
      await endLoan.mutateAsync({ id: l.id, version: l.version, valid_from: l.valid_from, valid_to: today < l.valid_from ? l.valid_from : today });
      toast(t('crews:loans.ended', 'Loan ended'), undefined, 'success');
    } catch (err) { setProblem(writeError(err)); }
  };
  const columns: Column<CrewLoanRow>[] = [
    { key: 'person', header: t('crews:person', 'Person'), kind: 'primary', rowHeader: true, cell: (l) => workerName(l.worker_id) },
    { key: 'home', header: t('crews:loans.homeCrew', 'Home crew'), cell: (l) => crewName(l.home_crew_id) },
    { key: 'host', header: t('crews:loans.hostCrew', 'Host crew'), cell: (l) => crewName(l.host_crew_id) },
    { key: 'from', header: t('crews:from', 'From'), cell: (l) => formatDay(l.valid_from) },
    { key: 'to', header: t('crews:to', 'To'), cell: (l) => formatDay(l.valid_to) },
  ];
  return (
    <Card className="mt-6" data-testid="crew-loans">
      <CardHead actions={canManage ? <Button variant="outline" size="sm" onClick={() => setLending(true)}><Icon name="plus" />{t('crews:loans.lend', 'Lend worker')}</Button> : undefined}>
        {t('crews:loans.title', 'Crew loans')}
      </CardHead>
      <CardPad>
        {!canManage && (
          <p className="mb-3 text-sm text-muted-foreground" data-testid="crew-loans-who">
            {t('crews:loans.whoLends', 'Only people who manage crews (administrator, executive, project manager) can lend a worker. Ask one of them.')}
          </p>
        )}
        {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
        {loans.isPending ? <ListState variant="loading" shape="table" rows={3} /> : loans.isError ? (
          <ListState variant="error" title={t('crews:loans.error', "Couldn't load crew loans")} onRetry={() => void loans.refetch()}
            retryLabel={t('crews:retry', 'Retry')} />
        ) : (
          <DataTable<CrewLoanRow> rows={loans.data ?? []} columns={columns} rowKey={(l) => l.id} tableId="crew-loans-table"
            rowMenu={(l) => (canManage && l.valid_to >= today ? [{ label: t('crews:loans.end', 'End loan'), onClick: () => setEnding(l) }] : [])}
            state={(loans.data ?? []).length === 0 ? 'empty' : undefined}
            emptyTitle={t('crews:loans.empty', 'No crew loans yet')}
            emptyAction={canManage ? { label: t('crews:loans.lend', 'Lend worker'), onClick: () => setLending(true) } : undefined}
            emptyActionVariant="outline" />
        )}
      </CardPad>
      {lending && <LendWorkerModal onClose={() => setLending(false)} />}
      <ConfirmDialog open={ending !== null} title={t('crews:loans.endTitle', 'End this loan?')}
        description={t('crews:loans.endBody', '{{name}} returns to the home crew after today. Recorded attendance stays.', { name: ending ? workerName(ending.worker_id) : '' })}
        confirmLabel={t('crews:loans.end', 'End loan')} onCancel={() => setEnding(null)} onConfirm={() => void end()} />
    </Card>
  );
};
