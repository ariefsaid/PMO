import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Button, Card, CardHead, CardPad, ConfirmDialog, DataTable, DateField, EntityFormModal, FormGrid, Icon, ListState,
  SelectField, StatusPill, useToast, useUrlFilters, type Column, type SubmitError,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useCrewMutations, useCrews, useWorkOrderCrews, useWorkOrderRoster } from '@/src/hooks/useCrews';
import { useLeaveOnDate } from '@/src/hooks/useLeave';
import { useReleaseHolds } from '@/src/hooks/useMedicalRelease';
import type { ReleaseState } from '@/src/lib/repositories/medicalRelease';
import type { RosterCrew, WorkOrderCrewRow } from '@/src/lib/repositories/crews';
import { formatDay } from '@/src/lib/format';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { WorkOrderPicker } from './CrewPickers';
import { useCrewErrorText } from './crewErrors';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Roster a crew on the work order for a date range (FR-CRW-006). */
const RosterCrewModal: React.FC<{ workOrderId: string; from: string; onClose: () => void }> = ({ workOrderId, from, onClose }) => {
  const { t } = useTranslation('crews');
  const writeError = useCrewErrorText();
  const { toast } = useToast();
  const crews = useCrews();
  const { roster } = useCrewMutations();
  const [crewId, setCrewId] = useState('');
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSubmitError(null);
    try {
      await roster.mutateAsync({ work_order_id: workOrderId, crew_id: crewId, valid_from: start, valid_to: end || null });
      toast(t('crews:rostered', 'Crew rostered'), undefined, 'success');
      onClose();
    } catch (err) {
      setSubmitError({ headline: t('crews:saveFailed', 'Not saved'), detail: writeError(err) });
    } finally { setBusy(false); }
  };
  return (
    <EntityFormModal open title={t('crews:rosterTitle', 'Roster a crew')} submitLabel={t('crews:rosterCrew', 'Roster a crew')}
      onSubmit={(e) => void submit(e)} onClose={onClose} loading={busy} dirty={Boolean(crewId)} submitDisabled={!crewId || !start}
      submitError={submitError}>
      <FormGrid>
        <SelectField label={t('crews:crew', 'Crew')} required value={crewId} onChange={setCrewId} placeholder={t('crews:pickCrew', 'Choose a crew')}
          options={(crews.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
        <DateField label={t('crews:from', 'From')} required value={start} onChange={setStart} />
        <DateField label={t('crews:to', 'To')} value={end} onChange={setEnd} min={start} />
      </FormGrid>
    </EntityFormModal>
  );
};

/** One rostered crew on the date: its people and standard-role headcount against placed (FR-CRW-007). */
const RosterCrewCard: React.FC<{ crew: RosterCrew; onLeave: ReadonlySet<string>; releaseHolds?: ReadonlyMap<string, ReleaseState> }> = ({ crew, onLeave, releaseHolds }) => {
  const { t } = useTranslation('crews');
  const headingId = `roster-crew-${crew.crew_id}`;
  const roleName = (id: string | null) => crew.roles.find((r) => r.standard_role_id === id)?.name ?? null;
  const noRole = crew.members.filter((m) => !m.standard_role_id).length;
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHead id={headingId} actions={crew.shortfall > 0
        ? <StatusPill variant="warn">{t('crews:shortTotal', '{{count}} short in total', { count: crew.shortfall })}</StatusPill> : undefined}>
        {crew.crew_code} · {crew.crew_name}
      </CardHead>
      <CardPad>
        {crew.roles.length > 0 && (
          <table className="mb-4 w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="py-2 text-left font-normal">{t('crews:roleName', 'Crew role')}</th>
              <th scope="col" className="w-24 py-2 text-right font-normal">{t('crews:placedOf', 'Placed')}</th>
              <th scope="col" className="w-24 py-2 text-right font-normal">{t('crews:shortfall', 'Shortfall')}</th>
            </tr></thead>
            <tbody>
              {crew.roles.map((r) => (
                <tr key={r.standard_role_id} aria-label={r.name} className="border-b border-border last:border-b-0">
                  <th scope="row" className="py-2 text-left font-normal text-foreground">{r.name}</th>
                  <td className="py-2 text-right tabular-nums text-foreground">{t('crews:placedCount', '{{placed}} of {{headcount}}', { placed: r.placed, headcount: r.headcount })}</td>
                  <td className="py-2 text-right tabular-nums">{r.shortfall > 0 && <span className="text-warning-foreground">{t('crews:short', '{{count}} short', { count: r.shortfall })}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {noRole > 0 && crew.roles.length > 0 && (
          <p className="mb-3 text-sm text-warning-foreground" data-testid="roster-no-role-note">
            {t('crews:noRoleNote', { defaultValue: 'Not counted above: {{count}} with no crew role set.', count: noRole })}
            {' '}<Link to="/crews" className="underline underline-offset-2">{t('crews:noRoleFix', 'Set their crew role under Crews')}</Link>
          </p>
        )}
        {crew.members.length === 0 ? <p className="text-sm text-muted-foreground">{t('crews:noMembersDay', 'Nobody is placed in this crew that day')}</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-muted-foreground">
              <th scope="col" className="py-2 text-left font-normal">{t('crews:person', 'Person')}</th>
              <th scope="col" className="py-2 text-left font-normal">{t('crews:roleName', 'Crew role')}</th>
            </tr></thead>
            <tbody>
              {crew.members.map((m) => (
                <tr key={m.worker_id} aria-label={m.display_name} className="border-b border-border last:border-b-0">
                  <th scope="row" className="py-2 pr-3 text-left font-normal text-foreground">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      {m.display_name}
                      {onLeave.has(m.worker_id) && <StatusPill variant="neutral">{t('crews:leave.onLeave', 'On leave')}</StatusPill>}
                      {releaseHolds?.has(m.worker_id) && <StatusPill variant="warn">{releaseHolds.get(m.worker_id) === 'deferred' ? t('crews:release.status.deferred', 'Release deferred') : t('crews:release.status.pending', 'Release pending')}</StatusPill>}
                    </span>
                  </th>
                  <td className="py-2 text-muted-foreground">{roleName(m.standard_role_id) ?? t('crews:roleNotSet', 'Crew role not set')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardPad>
    </Card>
  );
};

/** Crews → Roster: who serves a work order on a date, with shortfall, and the work order's roster placements. */
export const WorkOrderRoster: React.FC = () => {
  const { t } = useTranslation('crews');
  const writeError = useCrewErrorText();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const canManage = may('manage', 'workOrderRoster', { record: { viewOnly: realRole !== effectiveRole } });
  const { values, setFilter } = useUrlFilters(['wo', 'date']);
  const today = useOrgToday();
  const workOrderId = values.wo || null;
  const date = ISO.test(values.date) ? values.date : today;
  const roster = useWorkOrderRoster(workOrderId, date);
  const placements = useWorkOrderCrews(workOrderId);
  // #2708: an additive marker. Empty while leave requests are off or nobody is on approved leave, so the roster is unchanged.
  const onLeave = new Set(useLeaveOnDate(workOrderId ? date : null).data ?? []);
  // A person whose medical release is not approved is shown as such; the database refuses to roster them on those days.
  const releaseHolds = useReleaseHolds(workOrderId ? date : null).data;
  const crews = useCrews();
  const { endRoster } = useCrewMutations();
  const [rostering, setRostering] = useState(false);
  const [ending, setEnding] = useState<WorkOrderCrewRow | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const crewName = (id: string) => crews.data?.find((c) => c.id === id)?.name ?? '—';
  const end = async () => {
    const p = ending;
    if (!p) return;
    setEnding(null);
    setProblem(null);
    try {
      await endRoster.mutateAsync({ id: p.id, version: p.version, valid_from: p.valid_from, valid_to: today < p.valid_from ? p.valid_from : today });
      toast(t('crews:rosterEnded', 'Roster placement ended'), undefined, 'success');
    } catch (err) { setProblem(writeError(err)); }
  };
  const columns: Column<WorkOrderCrewRow>[] = [
    { key: 'crew', header: t('crews:crew', 'Crew'), kind: 'primary', rowHeader: true, cell: (p) => crewName(p.crew_id) },
    { key: 'from', header: t('crews:from', 'From'), cell: (p) => formatDay(p.valid_from) },
    { key: 'to', header: t('crews:to', 'To'), cell: (p) => (p.valid_to ? formatDay(p.valid_to) : t('crews:open', 'Open')) },
  ];
  const rosterAction = canManage && workOrderId
    ? <Button variant="outline" size="sm" onClick={() => setRostering(true)}><Icon name="plus" />{t('crews:rosterCrew', 'Roster a crew')}</Button>
    : undefined;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <WorkOrderPicker id="roster-work-order" remember value={workOrderId} onChange={(v) => setFilter('wo', v ?? '')} />
        <DateField label={t('crews:date', 'Date')} value={date} onChange={(v) => setFilter('date', v === today ? '' : v)} />
      </div>
      {problem && <p role="alert" className="text-sm text-destructive-text">{problem}</p>}
      {!workOrderId && <p className="text-sm text-muted-foreground">{t('crews:pickWorkOrderFirst', 'Choose a work order to see who serves it')}</p>}
      {workOrderId && roster.isPending && <ListState variant="loading" shape="table" rows={3} />}
      {workOrderId && !roster.isPending && roster.isError && (
        <ListState variant="error" title={t('crews:rosterError', "Couldn't load the roster")} onRetry={() => void roster.refetch()} retryLabel={t('crews:retry', 'Retry')} />
      )}
      {workOrderId && !roster.isPending && !roster.isError && (
        (roster.data ?? []).length === 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-foreground">{t('crews:noCrewThatDay', 'No crew serves this work order that day')}</p>
            {rosterAction}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">{(roster.data ?? []).map((c) => <RosterCrewCard key={c.crew_id} crew={c} onLeave={onLeave} releaseHolds={releaseHolds} />)}</div>
        )
      )}
      {workOrderId && (
        <Card>
          <CardHead actions={rosterAction}>{t('crews:placements', 'Roster placements')}</CardHead>
          <CardPad>
            <DataTable<WorkOrderCrewRow> rows={placements.data ?? []} columns={columns} rowKey={(p) => p.id} tableId="work-order-crews-table"
              rowMenu={(p) => (canManage && (!p.valid_to || p.valid_to >= today) ? [{ label: t('crews:endRoster', 'End roster placement'), onClick: () => setEnding(p) }] : [])}
              state={(placements.data ?? []).length === 0 ? 'empty' : undefined}
              emptyTitle={t('crews:noPlacements', 'No crew has been rostered here')} />
          </CardPad>
        </Card>
      )}
      {rostering && workOrderId && <RosterCrewModal workOrderId={workOrderId} from={date} onClose={() => setRostering(false)} />}
      <ConfirmDialog open={ending !== null} title={t('crews:endRosterTitle', 'End this roster placement?')}
        description={t('crews:endRosterBody', '{{name}} stops serving this work order after today.', { name: ending ? crewName(ending.crew_id) : '' })}
        confirmLabel={t('crews:endRoster', 'End roster placement')} onCancel={() => setEnding(null)} onConfirm={() => void end()} />
    </div>
  );
};
