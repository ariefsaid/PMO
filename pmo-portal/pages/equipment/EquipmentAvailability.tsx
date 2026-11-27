import React, { useMemo, useState } from 'react';
import { DateField } from '@/src/components/ui/DateField';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DataTable, Drawer, ListPage, ListState, RecordSection, RecordStack, SelectField, TextField, ViewToggle, useToast, type Column } from '@/src/components/ui';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 1600: the equipment manager reads the invoice check; only Admin and Finance may state a reason to include unproven days.
  const canCheck = may('transition', 'equipmentAvailability', writeCtx) || may('manage', 'equipmentAvailability', writeCtx) || may('approve', 'equipmentAvailability', writeCtx);
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
  const metricRows = useMemo(() => (metrics.data ?? []).filter((m) => byAsset.has(m.asset_id)).sort((a, b) => (a.availability_pct == null ? Infinity : Number(a.availability_pct)) - (b.availability_pct == null ? Infinity : Number(b.availability_pct))), [metrics.data, rows]); // eslint-disable-line react-hooks/exhaustive-deps -- byAsset derives from rows
  const metricColumns: Column<MetricRow>[] = [
    { key: 'asset', header: t('equipment:availability.machine', 'Machine'), kind: 'primary', rowHeader: true, cell: (m) => <span className="record-id whitespace-nowrap font-medium">{byAsset.get(m.asset_id)?.code}</span> },
    { key: 'period', header: t('equipment:availability.period', 'Period'), cell: (m) => <span className="whitespace-nowrap">{formatIsoDay(m.bucket_start)}</span> },
    // One figure per cell; a figure under its target is red and says so on the line beneath it.
    { key: 'availability', align: 'num', kind: 'percent',
      header: <span>{t('equipment:availability.availability', 'Availability')}{availabilityTarget != null && <span className="block font-normal text-muted-foreground">{t('equipment:availability.targetShort', 'target {{target}}%', { target: availabilityTarget })}</span>}</span>,
      cell: (m) => <span className="whitespace-nowrap tabular-nums">
        <span className={belowTarget(m.availability_pct, availabilityTarget) ? 'text-destructive-text' : undefined}>{m.availability_pct != null ? `${m.availability_pct}%` : '—'}</span>
        {belowTarget(m.availability_pct, availabilityTarget) && <span className="block text-destructive-text">{t('equipment:availability.belowTarget', 'Below target')}</span>}</span> },
    { key: 'days', align: 'num', header: t('equipment:availability.daysAvailable', 'Days available'),
      cell: (m) => m.in_service_days > 0 ? <span className="whitespace-nowrap tabular-nums">{t('equipment:availability.daysOf', '{{available}} of {{inService}} days', { available: m.available_days, inService: m.in_service_days })}</span> : null },
    { key: 'utilisation', align: 'num', kind: 'percent',
      header: <span>{t('equipment:availability.utilisation', 'Utilisation')}{utilisationTarget != null && <span className="block font-normal text-muted-foreground">{t('equipment:availability.targetShort', 'target {{target}}%', { target: utilisationTarget })}</span>}</span>,
      cell: (m) => <span className="whitespace-nowrap tabular-nums">
        <span className={belowTarget(m.utilisation_pct, utilisationTarget) ? 'text-destructive-text' : undefined}>{m.utilisation_pct != null ? `${m.utilisation_pct}%` : '—'}</span>
        {belowTarget(m.utilisation_pct, utilisationTarget) && <span className="block text-destructive-text">{t('equipment:availability.belowTarget', 'Below target')}</span>}</span> },
    { key: 'pending', align: 'num', header: t('equipment:availability.awaitingApproval', 'Awaiting approval'),
      cell: (m) => m.pending_usage_entries > 0 ? <span className="tabular-nums">{m.pending_usage_entries}</span> : null },
    { key: 'unrecorded', header: t('equipment:availability.unrecordedDays', 'Unrecorded days'), align: 'num', cell: (m) => <span className="tabular-nums">{m.unrecorded_days ?? '—'}</span> },
  ];
  const statusView = view === 'status' || !canCheck;
  const help = <>
    <p className="mb-2 font-semibold">{t('equipment:availability.effectsHeading', 'What each status does to planning')}</p>
    <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {STATUSES.map((st) => <React.Fragment key={st}><dt className="font-medium">{statusLabel(t, st)}</dt><dd className="text-muted-foreground">{statusEffect(t, st)}</dd></React.Fragment>)}
    </dl>
    <p className="text-muted-foreground">{t('equipment:availability.unrecordedNote', 'Unrecorded days are days in service with no status. Days before the organisation started recording are not counted.')}</p>
  </>;

  return (
    <ListPage title={t('equipment:availability.title', 'Availability')} help={help}
      filters={canCheck ? <ViewToggle semantics="toggle" ariaLabel={t('equipment:availability.views', 'Availability views')} value={view} onChange={setView}
        options={[{ value: 'status', label: t('equipment:availability.statusHeading', 'Equipment status') }, { value: 'check', label: t('equipment:availability.checkHeading', 'Rental invoice check') }]} /> : undefined}>
      <RecordStack>
      {problem && <p role="alert" className="text-destructive-text">{problem}</p>}
      {assets.isPending && <ListState variant="loading" shape="table" rows={4} />}
      {assets.isError && <ListState variant="error" title={t('equipment:availability.assetsError', "Couldn't load equipment")} onRetry={() => void assets.refetch()} />}
      {!assets.isPending && !assets.isError && rows.length === 0 && (
        <ListState variant="empty" title={t('equipment:availability.empty', 'No equipment yet')}
          sub={t('equipment:availability.emptySub', 'Add equipment from the Equipment screen, then set its daily status here.')} />
      )}
      {statusView && !assets.isError && rows.length > 0 && <MachineStatusSection rows={rows} allowDate onDirtyChange={setDirty} onProblem={setProblem} />}

      {(assetPage > 0 || assetPage + 1 < pages.length || assets.hasNextPage) && <div className="flex gap-2">
        <Button variant="outline" disabled={assetPage === 0 || dirty} onClick={() => { setAssetPage(assetPage - 1); setMetricAssets([]); }}>{t('equipment:availability.previousPage', 'Previous equipment page')}</Button>
        <Button variant="outline" disabled={(!assets.hasNextPage && assetPage + 1 >= pages.length) || dirty || assets.isFetchingNextPage} onClick={() => void nextPage()}>{t('equipment:availability.nextPage', 'Next equipment page')}</Button>
      </div>}

      {statusView && canMetrics && rows.length > 0 && (
        <RecordSection headingId="eav-metrics-h" title={t('equipment:availability.metricsHeading', 'This month')} flush
          actions={canConfigure ? <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>{t('equipment:availability.settings', 'Targets and hours')}</Button> : undefined}>
          <div className="flex flex-wrap items-end gap-3 px-[var(--panel-inset)] pb-4">
            <div className="w-40"><SelectField label={t('equipment:availability.interval', 'Metric interval')} value={grain} onChange={(v) => setGrain(v as 'day' | 'week' | 'month')} options={[{ value: 'day', label: t('equipment:availability.day', 'Day') }, { value: 'week', label: t('equipment:availability.week', 'Week') }, { value: 'month', label: t('equipment:availability.month', 'Month') }]} /></div>
            <div className="w-44"><DateField label={t('equipment:availability.metricFrom', 'Metric period from')} value={metricFrom} onChange={setMetricFrom} /></div>
            <div className="w-44"><DateField label={t('equipment:availability.metricTo', 'Metric period to')} value={metricTo} onChange={setMetricTo} /></div>
            <details className="relative min-h-10 self-end">
              <summary className="touch-target inline-flex cursor-pointer items-center rounded-md border border-border px-3">{metricAssets.length ? t('equipment:availability.metricAssetsCount', 'Machines: {{count}}', { count: metricAssets.length }) : t('equipment:availability.metricAssets', 'Assets for metrics')}</summary>
              <div className="mt-2 grid gap-2 rounded-md border border-border bg-card p-3 sm:grid-cols-2">
                <p className="text-muted-foreground sm:col-span-2">{t('equipment:availability.allWhenNone', 'Select none to show all on this page.')}</p>
                {rows.map((a) => <Checkbox key={a.id} label={`${a.code} ${a.name}`} checked={metricAssets.includes(a.id)} onChange={(checked) => setMetricAssets((selected) => checked ? [...selected, a.id] : selected.filter((id) => id !== a.id))}>{a.code} {a.name}</Checkbox>)}
              </div>
            </details>
          </div>
          {metrics.isError && <p role="alert" className="px-[var(--panel-inset)] pb-3">{t('equipment:availability.metricsError', 'Could not load metrics for this period.')}</p>}
          <DataTable<MetricRow> embedded rows={metricRows} columns={metricColumns} rowKey={(m) => `${m.asset_id}-${m.bucket_start}`} tableId="equipment-metrics"
            accessibleName={t('equipment:availability.metricsHeading', 'This month')}
            state={metricRows.length === 0 && !metrics.isPending && !metrics.isError ? 'empty' : undefined}
            emptyTitle={t('equipment:availability.metricsEmpty', 'No figures for this period')} />
        </RecordSection>
      )}

      {view === 'check' && canCheck && <RentalInvoiceCheck assets={pages.flatMap((p) => p.rows).filter((a) => (a as { ownership?: string }).ownership === 'rented')} today={today} monthFrom={monthFrom} canIncludeUnproven={canIncludeUnproven} statusLabel={(value) => statusLabel(t, value)} />}
      </RecordStack>
      {/* Organisation settings for the figures above: working hours (utilisation) and the targets (#2701). */}
      {canConfigure && <Drawer open={settingsOpen} onClose={() => setSettingsOpen(false)} title={t('equipment:availability.settings', 'Targets and hours')}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-end gap-2">
            <TextField label={t('equipment:availability.workingHours', 'Working hours per day')} inputMode="decimal" value={hours} onChange={setHours} />
            <Button variant="outline" disabled={!hours || workingHours.isPending} onClick={() => { void workingHours.mutateAsync(hours).then(() => { setHours(''); toast(t('equipment:availability.hoursSaved', 'Working hours saved'), undefined, 'success'); }).catch((err: unknown) => setProblem(classifyMutationError(err).headline)); }}>{t('equipment:availability.saveHours', 'Save working hours')}</Button>
          </div>
          <EquipmentTargetSettings onProblem={setProblem} />
        </div>
      </Drawer>}
    </ListPage>
  );
};
const EquipmentAvailabilityPage: React.FC = () => <EquipmentTargetsProvider><EquipmentAvailabilityScreen /></EquipmentTargetsProvider>;
export default EquipmentAvailabilityPage;
