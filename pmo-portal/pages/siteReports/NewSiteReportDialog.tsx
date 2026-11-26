import React, { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, DateField, EntityFormModal, SelectField } from '@/src/components/ui';
import { useProjects } from '@/src/hooks/useProjects';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { useDailySiteReportMutations } from '@/src/hooks/useDailySiteReports';
import { useCrews } from '@/src/hooks/useCrews';
import { classifyMutationError, joinSentences } from '@/src/lib/classifyMutationError';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { orgDayNow as todayIso } from '@/src/hooks/useOrgToday';

/**
 * Start a report: project, work order, work date (FR-DSR-001). The create carries one client request id for the
 * dialog's life, so a retried tap returns the same report (NFR-DSR-004); a second report for the same work order
 * and date is refused by the server and explained here.
 */
export const NewSiteReportDialog: React.FC<{ onClose: () => void; onCreated: (id: string) => void }> = ({ onClose, onCreated }) => {
  const { t } = useTranslation('siteReport');
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const crews = useCrews();
  const projects = useProjects();
  const requestId = useRef(crypto.randomUUID());
  const [projectId, setProjectId] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [workDate, setWorkDate] = useState(todayIso());
  const [pickedCrew, setPickedCrew] = useState<string | null>(null);
  const [pickedPerson, setPickedPerson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { save } = useDailySiteReportMutations(projectId);
  const workOrders = useQuery({
    queryKey: ['daily-site-reports', orgId, 'new', 'work-orders', projectId],
    queryFn: () => repositories.workOrder.list(projectId),
    enabled: Boolean(orgId && projectId),
  });
  const people = useQuery({
    queryKey: ['daily-site-reports', orgId, 'new', 'link-people'],
    queryFn: () => repositories.dailySiteReport.listLinkPeople(),
    enabled: Boolean(orgId),
    staleTime: 300_000,
  });
  const projectOptions = useMemo(() => (projects.data ?? []).map((p) => ({ value: p.id, label: projectDisplayName(p) })), [projects.data]);
  const workOrderOptions = useMemo(() => (workOrders.data ?? [])
    .filter((w) => w.status !== 'Cancelled' && w.status !== 'Closed')
    .map((w) => ({ value: w.id, label: [w.wo_number, w.title].filter(Boolean).join(' · ') })), [workOrders.data]);

  // A foreman's report defaults to the crew they lead; any crew can be chosen, or none.
  const ownCrew = useMemo(() => (crews.data ?? []).find((c) => c.field_controller_id === (currentUser?.id ?? null))?.id ?? '', [crews.data, currentUser?.id]);
  const crewId = pickedCrew ?? ownCrew;
  const crewOptions = useMemo(() => (crews.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })), [crews.data]);
  const personOptions = useMemo(() => (people.data ?? []).map((p) => ({ value: p.id, label: p.name })), [people.data]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const id = await save.mutateAsync({ clientRequestId: requestId.current, workOrderId, workDate,
        ...(crewId ? { crewId } : {}), ...(!crewId && pickedPerson ? { personId: pickedPerson } : {}), progress: [], idle: [], consumables: [] });
      onCreated(id);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') setError(t('new.exists', 'A report exists for this date'));
      else { const { headline, detail } = classifyMutationError(err); setError(detail ? joinSentences(headline, detail) : headline); }
    }
  };

  return (
    <EntityFormModal
      open
      title={t('newReport', 'New report')}
      submitLabel={t('new.create', 'Start report')}
      onSubmit={(e) => void submit(e)}
      onClose={onClose}
      submitDisabled={!workOrderId || !workDate}
      loading={save.isPending}
      submitError={error ? { headline: error } : null}
    >
      <SelectField
        label={t('new.project', 'Project')}
        required
        value={projectId}
        onChange={(v) => { setProjectId(v); setWorkOrderId(''); }}
        options={[{ value: '', label: t('new.pickProject', 'Choose a project') }, ...projectOptions]}
      />
      <SelectField
        label={t('new.workOrder', 'Work order')}
        required
        value={workOrderId}
        onChange={setWorkOrderId}
        disabled={!projectId}
        options={[{ value: '', label: t('new.pickWorkOrder', 'Choose a work order') }, ...workOrderOptions]}
      />
      <DateField label={t('new.date', 'Work date')} required value={workDate} onChange={setWorkDate} max={todayIso()} />
      {crewOptions.length > 0 && (
        <SelectField label={t('new.crew', 'Crew (optional)')} value={crewId} onChange={(v) => { setPickedCrew(v); if (v) setPickedPerson(''); }}
          options={[{ value: '', label: t('new.noCrew', 'No crew') }, ...crewOptions]} />
      )}
      <SelectField label={t('new.person', 'Person (when no crew applies)')} value={pickedPerson}
        onChange={(v) => { setPickedPerson(v); if (v) setPickedCrew(''); }}
        disabled={Boolean(crewId) || people.isPending || people.isError}
        options={[{ value: '', label: people.isPending ? t('new.loadingPeople', 'Loading people…') : people.isError ? t('new.peopleError', "Couldn't load people") : t('new.noPerson', 'No person') }, ...personOptions]} />
      {people.isError && <p role="alert" className="text-sm text-destructive-text">
        {t('new.peopleError', "Couldn't load people.")} <Button variant="ghost" size="sm" onClick={() => void people.refetch()}>{t('new.retryPeople', 'Retry')}</Button>
      </p>}
    </EntityFormModal>
  );
};
