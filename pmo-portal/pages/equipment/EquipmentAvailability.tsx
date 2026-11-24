import React, { useMemo, useState } from 'react';
import { DateField } from '@/src/components/ui/DateField';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DataTable, ListPage, ListState, SelectField, TextField, useToast, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useEquipmentAssetPages } from '@/src/hooks/useEquipment';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useOrgBusinessTimezone } from '@/src/hooks/useResolvedLocale';
import { useEquipmentMetrics, useEquipmentWorkingHours } from '@/src/hooks/useEquipmentAvailability';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { monthStart } from './equipmentWeek';
import RentalInvoiceCheck from './RentalInvoiceCheck';
import { EquipmentTargetSettings, EquipmentTargetsProvider } from './EquipmentTargets';
import { useEquipmentTargetValues } from '@/src/hooks/useEquipmentTargets';
import { MachineStatusSection } from './MachineStatusSection';
import { STATUSES, statusEffect, statusLabel } from './equipmentStatusLabels';
import { formatIsoDay } from '@/src/lib/format';

const EquipmentAvailabilityScreen: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const writeCtx = { record: { viewOnly: realRole !== effectiveRole } };
  const timezone = useOrgBusinessTimezone();
  const today = useOrgToday(timezone);
  const monthFrom = monthStart(today);

  const [view, setView] = useState<'status' | 'check'>('status');
  // 1600: the equipment manager reads the invoice check; only Admin and Finance may state a reason to include unproven days.
  const canCheck = may('manage', 'equipmentAvailability', writeCtx) || may('approve', 'equipmentAvailability', writeCtx);
  const canIncludeUnproven = may('approve', 'equipmentAvailability', writeCtx);
  const canConfigure = may('configure', 'equipmentAvailability', writeCtx);
  const assets = useEquipmentAssetPages();
  const [assetPage, setAssetPage] = useState(0);
  const [dirty, setDirty] = useState(false);
  const pages = assets.data?.pages ?? [];
  const rows = pages[assetPage]?.rows ?? [];
  const nextPage = async () => {
    if (assetPage + 1 < pages.length) { setAssetPage(assetPage + 1); setMetricAssets([]); return; }
    const next = await assets.fetchNextPage();
    if (next.data && next.data.pages.length > assetPage + 1) { setAssetPage(assetPage + 1); setMetricAssets([]); }
  };
  const [problem, setProblem] = useState<string | null>(null);

  const canMetrics = may('view', 'equipmentMetrics');
  const [chosenMetricFrom, setMetricFrom] = useState<string | null>(null);
  const [chosenMetricTo, setMetricTo] = useState<string | null>(null);
  const metricFrom = chosenMetricFrom ?? monthFrom;
  const metricTo = chosenMetricTo ?? today;
  const [grain, setGrain] = useState<'day' | 'week' | 'month'>('month');
  const [metricAssets, setMetricAssets] = useState<string[]>([]);
  const [hours, setHours] = useState('');
  const workingHours = useEquipmentWorkingHours();
  const targets = useEquipmentTargetValues();
  const availabilityTarget = targets.availability_target_pct;
  const utilisationTarget = targets.utilisation_target_pct;
  const belowTarget = (value: string | number | null | undefined, target: number | null) => target != null && value != null && Number(value) < Number(target);
  const metrics = useEquipmentMetrics(metricAssets.length ? rows.filter((a) => metricAssets.includes(a.id)).map((a) => a.id) : rows.map((a) => a.id), metricFrom, metricTo, grain, canMetrics && rows.length > 0);
  const byAsset = new Map(rows.map((a) => [a.id, a]));
  type MetricRow = NonNullable<typeof metrics.data>[number];
  const metricRows = useMemo(() => (metrics.data ?? []).filter((m) => byAsset.has(m.asset_id)), [metrics.data, rows]); // eslint-disable-line react-hooks/exhaustive-deps -- byAsset derives from rows
  const metricColumns: Column<MetricRow>[] = [
    { key: 'asset', header: t('equipment:availability.asset', 'Asset'), kind: 'primary', rowHeader: true, cell: (m) => <span className="record-id whitespace-nowrap font-medium">{byAsset.get(m.asset_id)?.code}</span> },
    { key: 'period', header: t('equipment:availability.period', 'Period'), cell: (m) => <span className="whitespace-nowrap">{formatIsoDay(m.bucket_start)}</span> },
    { key: 'availability', align: 'num',
      header: <span>{t('equipment:availability.availability', 'Availability')}{availabilityTarget != null && <span className="ml-1 font-normal text-muted-foreground">{t('equipment:availability.targetNote', '(target {{target}}%)', { target: availabilityTarget })}</span>}</span>,
      cell: (m) => <span className="whitespace-nowrap">{m.availability_pct != null ? `${m.availability_pct}%` : '—'}
        {belowTarget(m.availability_pct, availabilityTarget) && <span className="ml-1 text-destructive-text">{t('equipment:availability.belowTarget', 'Below target')}</span>}
        {m.in_service_days > 0 && <span className="block text-muted-foreground">{t('equipment:availability.daysOf', '{{available}} of {{inService}} days', { available: m.available_days, inService: m.in_service_days })}</span>}</span> },
    { key: 'utilisation', align: 'num',
      header: <span>{t('equipment:availability.utilisation', 'Utilisation')}{utilisationTarget != null && <span className="ml-1 font-normal text-muted-foreground">{t('equipment:availability.targetNote', '(target {{target}}%)', { target: utilisationTarget })}</span>}</span>,
      cell: (m) => <span>{m.utilisation_pct != null ? `${m.utilisation_pct}%` : '—'}
        {belowTarget(m.utilisation_pct, utilisationTarget) && <span className="ml-1 text-destructive-text">{t('equipment:availability.belowTarget', 'Below target')}</span>}
        {m.pending_usage_entries > 0 && <span className="ml-1 text-muted-foreground">{t('equipment:availability.pendingUsage', '({{n}} awaiting approval)', { n: m.pending_usage_entries })}</span>}</span> },
    { key: 'unrecorded', header: t('equipment:availability.unrecordedDays', 'Unrecorded days'), align: 'num', cell: (m) => m.unrecorded_days ?? '—' },
  ];

  return (
    <ListPage title={t('equipment:availability.title', 'Availability')}>

      {canCheck && <nav aria-label={t('equipment:availability.views', 'Availability views')} className="mb-4 flex gap-2">
        <Button variant="outline" aria-pressed={view === 'status'} onClick={() => setView('status')}>{t('equipment:availability.statusHeading', 'Equipment status')}</Button>
        <Button variant="outline" aria-pressed={view === 'check'} onClick={() => setView('check')}>{t('equipment:availability.checkHeading', 'Rental invoice check')}</Button>
      </nav>}
      {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
      {assets.isPending && <ListState variant="loading" shape="table" rows={4} />}
      {assets.isError && <ListState variant="error" title={t('equipment:availability.assetsError', "Couldn't load equipment")} onRetry={() => void assets.refetch()} />}
      {!assets.isPending && !assets.isError && rows.length === 0 && (
        <ListState variant="empty" title={t('equipment:availability.empty', 'No equipment yet')}
          sub={t('equipment:availability.emptySub', 'Add equipment from the Equipment screen, then set its daily status here.')} />
      )}
      {view === 'status' && !assets.isError && rows.length > 0 && (
        <>
          <MachineStatusSection rows={rows} allowDate onDirtyChange={setDirty} onProblem={setProblem} />
          <section aria-labelledby="eav-effects-h" className="mb-6">
            <h2 id="eav-effects-h" className="text-base font-semibold mb-2">{t('equipment:availability.effectsHeading', 'What each status does to planning')}</h2>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
              {STATUSES.map((st) => <React.Fragment key={st}><dt className="font-medium">{statusLabel(t, st)}</dt><dd className="text-muted-foreground">{statusEffect(t, st)}</dd></React.Fragment>)}
            </dl>
          </section>
        </>
      )}

      {(assetPage > 0 || assetPage + 1 < pages.length || assets.hasNextPage) && <div className="flex gap-2 mb-4">
        <Button variant="outline" disabled={assetPage === 0 || dirty} onClick={() => { setAssetPage(assetPage - 1); setMetricAssets([]); }}>{t('equipment:availability.previousPage', 'Previous equipment page')}</Button>
        <Button variant="outline" disabled={(!assets.hasNextPage && assetPage + 1 >= pages.length) || dirty || assets.isFetchingNextPage} onClick={() => void nextPage()}>{t('equipment:availability.nextPage', 'Next equipment page')}</Button>
      </div>}

      {view === 'status' && canMetrics && rows.length > 0 && (
        <section aria-labelledby="eav-metrics-h" className="mb-6">
          <h2 id="eav-metrics-h" className="text-base font-semibold mb-2">{t('equipment:availability.metricsHeading', 'This month')}</h2>
          <details className="mb-3">
            <summary>{t('equipment:availability.metricAssets', 'Assets for metrics')}</summary>
            <p className="text-sm text-muted-foreground">{t('equipment:availability.allWhenNone', 'Select none to show all on this page.')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {rows.map((a) => <Checkbox key={a.id} label={`${a.code} ${a.name}`} checked={metricAssets.includes(a.id)} onChange={(checked) => setMetricAssets((selected) => checked ? [...selected, a.id] : selected.filter((id) => id !== a.id))}>{a.code} {a.name}</Checkbox>)}
            </div>
          </details>
          <div className="grid gap-3 sm:grid-cols-3 mb-3">
            <SelectField label={t('equipment:availability.interval', 'Metric interval')} value={grain} onChange={(v) => setGrain(v as 'day' | 'week' | 'month')} options={[{ value: 'day', label: t('equipment:availability.day', 'Day') }, { value: 'week', label: t('equipment:availability.week', 'Week') }, { value: 'month', label: t('equipment:availability.month', 'Month') }]} />
            <DateField label={t('equipment:availability.metricFrom', 'Metric period from')} value={metricFrom} onChange={setMetricFrom} />
            <DateField label={t('equipment:availability.metricTo', 'Metric period to')} value={metricTo} onChange={setMetricTo} />
          </div>
          {canConfigure && <div className="mb-3 flex flex-wrap items-end gap-2">
            <TextField label={t('equipment:availability.workingHours', 'Working hours per day')} inputMode="decimal" value={hours} onChange={setHours} />
            <Button variant="outline" disabled={!hours || workingHours.isPending} onClick={() => { void workingHours.mutateAsync(hours).then(() => { setHours(''); toast(t('equipment:availability.hoursSaved', 'Working hours saved'), undefined, 'success'); }).catch((err: unknown) => setProblem(classifyMutationError(err).headline)); }}>{t('equipment:availability.saveHours', 'Save working hours')}</Button>
          </div>}
          {canConfigure && <EquipmentTargetSettings onProblem={setProblem} />}
          {metrics.isError && <p role="alert">{t('equipment:availability.metricsError', 'Could not load metrics for this period.')}</p>}
          <p className="mb-2 text-sm text-muted-foreground">{t('equipment:availability.unrecordedNote', 'Unrecorded days are days in service with no status. Days before the organisation started recording are not counted.')}</p>
          <DataTable<MetricRow> embedded rows={metricRows} columns={metricColumns} rowKey={(m) => `${m.asset_id}-${m.bucket_start}`} tableId="equipment-metrics"
            accessibleName={t('equipment:availability.metricsHeading', 'This month')}
            state={metricRows.length === 0 && !metrics.isPending && !metrics.isError ? 'empty' : undefined}
            emptyTitle={t('equipment:availability.metricsEmpty', 'No figures for this period')} />
        </section>
      )}

      {view === 'check' && canCheck && <RentalInvoiceCheck assets={rows.filter((a) => (a as { ownership?: string }).ownership === 'rented')} today={today} monthFrom={monthFrom} canIncludeUnproven={canIncludeUnproven} statusLabel={(value) => statusLabel(t, value)} />}
    </ListPage>
  );
};
const EquipmentAvailabilityPage: React.FC = () => <EquipmentTargetsProvider><EquipmentAvailabilityScreen /></EquipmentTargetsProvider>;
export default EquipmentAvailabilityPage;
