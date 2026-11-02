import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, ConfirmDialog, DataTable, Icon, ListState, RecordHeader, StatusPill, Switch, useToast, type Column,
} from '@/src/components/ui';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import {
  useEndCosting, useEquipmentAllocations, useEquipmentAssets, useEquipmentCosting, useEquipmentUsageTotals,
} from '@/src/hooks/useEquipment';
import { useProjects } from '@/src/hooks/useProjects';
import type { EquipmentAllocationRow, EquipmentCostingRow, EquipmentUsageTotalRow } from '@/src/lib/db/equipment';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrencyAuto, formatNumberMax2, formatMonthYear } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { EquipmentCostingForm } from './EquipmentCostingForm';
import { basisLabel, driverLabel, unitLabel } from './equipmentLabels';
import { fromIso, monthStart, toIso } from './equipmentWeek';

type T = ReturnType<typeof useTranslation>['t'];
const rangeFor = (today: string) => ({ from: monthStart(today, -11), to: today });

/** FR-EQU-044: every allocated amount exposes its inputs so it can be recomputed by hand. The server withholds what a role may not see. */
const Calculation: React.FC<{ r: EquipmentAllocationRow; t: T; money: (n: number) => string }> = ({ r, t, money }) => {
  const unit = unitLabel(t, r.unit);
  const rows: Array<[string, React.ReactNode]> = [];
  if (r.basis === 'hire_rate') {
    rows.push([t('equipment:calc.work', 'Work'), t('equipment:calc.workLine', 'Work {{units}} {{unit}} at {{rate}} per {{perUnit}}', { units: formatNumberMax2(Number(r.work_units ?? 0)), unit, rate: formatNumberMax2(Number(r.work_rate ?? 0)), perUnit: unit })]);
    if (r.standby_rate != null) rows.push([t('equipment:calc.standby', 'Standby'), t('equipment:calc.standbyLine', 'Standby {{units}} {{unit}} at {{rate}} per {{perUnit}}', { units: formatNumberMax2(Number(r.standby_units ?? 0)), unit, rate: formatNumberMax2(Number(r.standby_rate)), perUnit: unit })]);
  } else {
    if (r.pool != null) rows.push([t('equipment:calc.pool', 'Pool'), t('equipment:calc.poolLine', 'Pool {{amount}}', { amount: money(Number(r.pool)) }) + (r.line_count ? ` · ${t('equipment:calc.lines', 'Ledger lines: {{count}}', { count: r.line_count })}` : '')]);
    rows.push([t('equipment:calc.driver', 'Driver'), t('equipment:calc.driverLine', 'Shared by {{driver}}', { driver: driverLabel(t, r.driver) })]);
    if (r.driver_value != null) rows.push([t('equipment:calc.share', 'Share'),
      `${t('equipment:calc.driverOf', '{{value}} of {{total}}', { value: formatNumberMax2(Number(r.driver_value)), total: r.driver_total != null ? formatNumberMax2(Number(r.driver_total)) : '—' })}${r.share != null ? ` · ${formatNumberMax2(Number(r.share) * 100)}%` : ''}`]);
  }
  rows.push([t('equipment:calc.version', 'Setting'), t('equipment:calc.versionLine', 'Version {{version}}', { version: r.version }) + ` · ${t('equipment:calc.entries', 'Entries: {{count}}', { count: r.entry_count })}`]);
  return (
    <div role="group" aria-label={t('equipment:calc.label', 'Calculation')} className="grid gap-1 py-2 text-sm sm:grid-cols-[8rem_1fr]">
      {rows.map(([k, v]) => <React.Fragment key={k}><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{v}</span></React.Fragment>)}
    </div>
  );
};

const AllocationsCard: React.FC<{ assetId: string; today: string; projectName: (id: string) => string; money: (n: number, projectId: string | null) => string }> = ({ assetId, today, projectName, money }) => {
  const { t } = useTranslation();
  const q = useEquipmentAllocations({ assetId, ...rangeFor(today) });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rowId = (r: EquipmentAllocationRow) => `${r.month}|${r.project_id ?? 'pool'}|${r.basis}|${r.status}`;
  const rows = q.data?.rows ?? [];
  const columns: Column<EquipmentAllocationRow>[] = [
    { key: 'month', header: t('equipment:allocations.month', 'Month'), kind: 'primary', rowHeader: true, cell: (r) => formatMonthYear(fromIso(r.month)) },
    { key: 'project', header: t('equipment:allocations.project', 'Project'),
      cell: (r) => r.project_id ? projectName(r.project_id) : <span className="text-warning-foreground">{r.status === 'unallocated' ? t('equipment:allocations.unallocated', 'Unallocated: no approved usage this month') : '—'}</span> },
    { key: 'basis', header: t('equipment:allocations.basis', 'Basis'), cell: (r) => r.status === 'usage_only' ? <span className="text-muted-foreground">{t('equipment:allocations.usageOnly', 'Usage recorded; no costing set')}</span> : basisLabel(t, r.basis) },
    { key: 'units', header: t('equipment:allocations.units', 'Used'), align: 'num',
      cell: (r) => {
        const used = Number(r.work_units ?? r.driver_value ?? 0) + Number(r.standby_units ?? 0);
        return r.project_id && used > 0 ? <span className="whitespace-nowrap tabular-nums">{formatNumberMax2(used)} {r.basis === 'actual_cost' ? driverLabel(t, r.driver) : unitLabel(t, r.unit)}</span> : '—';
      } },
    { key: 'amount', header: t('equipment:allocations.amount', 'Amount'), align: 'num',
      cell: (r) => r.amount == null ? <span className="text-muted-foreground">—</span> : <span className="tabular-nums">{money(Number(r.amount), r.project_id)}</span> },
    { key: 'why', header: <span className="sr-only">{t('equipment:allocations.how', 'Calculation')}</span>,
      cell: (r) => r.status === 'usage_only' ? null : (
        <Button variant="ghost" size="sm" aria-expanded={open.has(rowId(r))}
          aria-label={t('equipment:allocations.howLabel', 'Show how this was calculated for {{month}}', { month: formatMonthYear(fromIso(r.month)) })}
          onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(rowId(r))) n.delete(rowId(r)); else n.add(rowId(r)); return n; })}>
          <Icon name="info" />
        </Button>) },
  ];
  return (
    <Card role="region" aria-label={t('equipment:allocations.title', 'Allocations')} className="mb-4">
      <CardHead>{t('equipment:allocations.title', 'Allocations')}</CardHead>
      <CardPad className="pt-0">
        {q.isPending && <ListState variant="loading" rows={3} />}
        {!q.isPending && (q.isError || !q.data) && <ListState variant="error" title={t('equipment:allocations.error', "Couldn't load allocations")}
          sub={t('equipment:allocations.errorSub', 'No figure is shown rather than a wrong one. Try again.')} onRetry={() => void q.refetch()} retryLabel={t('equipment:usage.retry', 'Retry')} />}
        {!q.isPending && !q.isError && q.data && (
          <>
            {q.data.truncated && <p role="status" className="mb-2 text-sm text-muted-foreground">{t('equipment:allocations.truncated', 'Showing the first rows only. Narrow the range to see the rest.')}</p>}
            <DataTable<EquipmentAllocationRow> embedded rows={rows} columns={columns} rowKey={rowId} tableId="equipment-allocations"
              accessibleName={t('equipment:allocations.title', 'Allocations')}
              state={rows.length === 0 ? 'empty' : undefined}
              emptyTitle={t('equipment:allocations.empty', 'No usage or costing in the last 12 months')}
              emptySub={t('equipment:allocations.emptySub', 'Approved usage shows here by month and project.')} />
            {rows.filter((r) => open.has(rowId(r))).map((r) => (
              <div key={rowId(r)} className="mt-2 border-t border-border pt-1">
                <p className="text-xs font-medium text-muted-foreground">{formatMonthYear(fromIso(r.month))}{r.project_id ? ` · ${projectName(r.project_id)}` : ''}</p>
                <Calculation r={r} t={t} money={(n) => money(n, r.project_id)} />
              </div>))}
          </>
        )}
      </CardPad>
    </Card>
  );
};

const CostingCard: React.FC<{ asset: { id: string; name: string; default_unit: string }; assetRow: Parameters<typeof EquipmentCostingForm>[0]['asset']; projectName: (id: string) => string; money: (n: number, projectId: string | null) => string }> = ({ asset, assetRow, projectName, money }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { realRole, effectiveRole } = useEffectiveRole();
  const [history, setHistory] = useState(false);
  const [changing, setChanging] = useState(false);
  const [ending, setEnding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const q = useEquipmentCosting(history);
  const end = useEndCosting();
  const mine = useMemo(() => (q.data ?? []).filter((s) => s.asset_id === asset.id), [q.data, asset.id]);
  const current = mine.find((s) => s.is_current && !s.voided);
  const settingLine = (s: EquipmentCostingRow) => {
    const bits: string[] = [];
    if (s.basis === 'hire_rate') {
      bits.push(t('equipment:costing.workRateLine', 'Work {{rate}} per {{unit}}', { rate: formatNumberMax2(Number(s.work_rate ?? 0)), unit: unitLabel(t, s.rate_unit) }));
      if (s.standby_rate != null) bits.push(t('equipment:costing.standbyRateLine', 'Standby {{rate}} per {{unit}}', { rate: formatNumberMax2(Number(s.standby_rate)), unit: unitLabel(t, s.rate_unit) }));
    }
    if (s.basis === 'actual_cost') {
      bits.push(t('equipment:costing.sharedBy', 'Shared by {{driver}}', { driver: driverLabel(t, s.driver) }));
      for (const m of [s.match_account, s.match_account_group, s.match_cost_center, s.match_party]) if (m) bits.push(m);
      if (s.count_standby) bits.push(t('equipment:costing.standbyCounts', 'standby counts'));
    }
    return bits.join(' · ');
  };
  const columns: Column<EquipmentCostingRow>[] = [
    { key: 'from', header: t('equipment:costing.effectiveFrom', 'Effective from'), kind: 'primary', rowHeader: true, cell: (s) => s.effective_from },
    { key: 'to', header: t('equipment:costing.effectiveTo', 'Effective to'), cell: (s) => s.effective_to ?? '—' },
    { key: 'basis', header: t('equipment:costing.basis', 'Costing basis'), cell: (s) => basisLabel(t, s.basis) },
    { key: 'detail', header: t('equipment:costing.detail', 'Detail'), cell: (s) => settingLine(s) || '—' },
    { key: 'version', header: t('equipment:costing.version', 'Version'), align: 'num', cell: (s) => s.version },
    { key: 'state', header: t('equipment:costing.state', 'State'),
      cell: (s) => s.voided ? <StatusPill variant="lost">{t('equipment:costing.voided', 'Voided')}</StatusPill> : s.is_current ? <StatusPill variant="won">{t('equipment:costing.current', 'Current')}</StatusPill> : <StatusPill variant="superseded">{t('equipment:costing.past', 'Past')}</StatusPill> },
  ];
  const doEnd = async () => {
    if (!current) return;
    setProblem(null);
    try {
      await end.mutateAsync({ settingKey: current.setting_key, effectiveTo: toIso(new Date()), expectedVersion: current.version });
      toast(t('equipment:costing.ended', 'Costing ended'), undefined, 'success');
    } catch (err) { const c = classifyMutationError(err); setProblem(`${c.headline}. ${c.detail}`); }
    setEnding(false);
  };
  return (
    <Card role="region" aria-label={t('equipment:costing.title', 'Costing')} className="mb-4">
      <CardHead actions={<CanWrite entity="equipmentCosting" action="manage" ctx={{ record: { viewOnly: realRole !== effectiveRole } }}>
        <span className="flex gap-2">
          {current && current.basis !== 'none' && <Button variant="outline" size="sm" onClick={() => setEnding(true)}>{t('equipment:costing.end', 'End costing')}</Button>}
          <Button variant="primary" size="sm" onClick={() => setChanging(true)}>{t('equipment:costing.change', 'Change costing')}</Button>
        </span>
      </CanWrite>}>{t('equipment:costing.title', 'Costing')}</CardHead>
      <CardPad className="pt-0">
        {q.isPending && <ListState variant="loading" rows={2} />}
        {!q.isPending && (q.isError || !q.data) && <ListState variant="error" title={t('equipment:costing.error', "Couldn't load the costing setting")}
          sub={t('equipment:costing.errorSub', 'Try again.')} onRetry={() => void q.refetch()} retryLabel={t('equipment:usage.retry', 'Retry')} />}
        {!q.isPending && !q.isError && q.data && (
          <>
            {problem && <p role="alert" className="mb-2 text-sm text-destructive-text">{problem}</p>}
            {current
              ? <div className="space-y-1">
                <p className="text-sm font-semibold">{basisLabel(t, current.basis)}</p>
                <p className="text-sm text-muted-foreground">{settingLine(current)}</p>
                <p className="text-xs text-muted-foreground">{t('equipment:costing.since', 'From {{date}} · version {{version}}', { date: current.effective_from, version: current.version })}</p>
              </div>
              : <p className="text-sm text-muted-foreground">{t('equipment:costing.none', 'No costing set. Usage is recorded and totalled per project, with no amount.')}</p>}
            <div className="mt-3 flex items-center gap-2 text-sm">
              <Switch checked={history} onChange={setHistory} label={t('equipment:costing.showHistory', 'Show history')} />
              <span aria-hidden="true">{t('equipment:costing.showHistory', 'Show history')}</span>
            </div>
            {history && <div className="mt-2"><DataTable<EquipmentCostingRow> embedded rows={mine} columns={columns} rowKey={(s) => s.id} tableId="equipment-costing-history"
              accessibleName={t('equipment:costing.historyLabel', 'Costing history')} state={mine.length === 0 ? 'empty' : undefined}
              emptyTitle={t('equipment:costing.historyEmpty', 'No costing history')} /></div>}
          </>
        )}
      </CardPad>
      {changing && <EquipmentCostingForm asset={assetRow} current={current} projectName={projectName} money={money} onClose={() => setChanging(false)} />}
      <ConfirmDialog open={ending} tone="destructive" title={t('equipment:costing.endTitle', 'End this costing?')}
        description={t('equipment:costing.endBody', 'From today the asset has no costing. Earlier months keep their amounts.')}
        confirmLabel={t('equipment:costing.end', 'End costing')} onCancel={() => setEnding(false)} onConfirm={() => void doEnd()} />
    </Card>
  );
};

const UsageCard: React.FC<{ assetId: string; today: string; projectName: (id: string) => string }> = ({ assetId, today, projectName }) => {
  const { t } = useTranslation();
  const q = useEquipmentUsageTotals({ assetId, ...rangeFor(today) });
  const rows = q.data?.rows ?? [];
  const columns: Column<EquipmentUsageTotalRow>[] = [
    { key: 'month', header: t('equipment:allocations.month', 'Month'), kind: 'primary', rowHeader: true, cell: (r) => formatMonthYear(fromIso(r.month)) },
    { key: 'project', header: t('equipment:allocations.project', 'Project'), cell: (r) => projectName(r.project_id) },
    { key: 'work', header: t('equipment:usage.kindWork', 'Work'), align: 'num', cell: (r) => <span className="whitespace-nowrap tabular-nums">{formatNumberMax2(Number(r.work_units ?? 0))} {unitLabel(t, r.unit)}</span> },
    { key: 'standby', header: t('equipment:usage.kindStandby', 'Standby'), align: 'num', cell: (r) => <span className="whitespace-nowrap tabular-nums">{formatNumberMax2(Number(r.standby_units ?? 0))} {unitLabel(t, r.unit)}</span> },
    { key: 'fuel', header: t('equipment:usage.fuel', 'Fuel (litres)'), align: 'num', cell: (r) => formatNumberMax2(Number(r.fuel_litres ?? 0)) },
    { key: 'trips', header: t('equipment:usage.trips', 'Trips'), align: 'num', cell: (r) => Number(r.trips ?? 0) },
    { key: 'waiting', header: t('equipment:usage.waiting', 'Waiting approval'), align: 'num', cell: (r) => Number(r.submitted_count ?? 0) },
  ];
  return (
    <Card role="region" aria-label={t('equipment:usage.cardTitle', 'Usage')} className="mb-4">
      <CardHead>{t('equipment:usage.cardTitle', 'Usage')}</CardHead>
      <CardPad className="pt-0">
        {q.isPending && <ListState variant="loading" rows={3} />}
        {!q.isPending && (q.isError || !q.data) && <ListState variant="error" title={t('equipment:usage.totalsError', "Couldn't load usage totals")}
          sub={t('equipment:usage.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void q.refetch()} retryLabel={t('equipment:usage.retry', 'Retry')} />}
        {!q.isPending && !q.isError && q.data && <DataTable<EquipmentUsageTotalRow> embedded rows={rows} columns={columns}
          rowKey={(r) => `${r.project_id}|${r.month}|${r.unit}`} tableId="equipment-usage-totals" accessibleName={t('equipment:usage.cardTitle', 'Usage')}
          state={rows.length === 0 ? 'empty' : undefined} emptyTitle={t('equipment:usage.totalsEmpty', 'No usage in the last 12 months')}
          emptySub={t('equipment:usage.totalsEmptySub', 'Logged hours show here by month and project once approved.')} />}
      </CardPad>
    </Card>
  );
};

/** Equipment → asset detail: usage, the costing setting with history and preview, and the allocation table with its drill-down (FR-EQU-071). */
const EquipmentAssetDetail: React.FC = () => {
  const { t } = useTranslation();
  const { assetId } = useParams<{ assetId: string }>();
  const navigate = useNavigate();
  const may = usePermission();
  const assets = useEquipmentAssets();
  const projects = useProjects();
  const today = toIso(new Date());
  const asset = assets.data?.rows.find((a) => a.id === assetId);
  const byId = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p])), [projects.data]);
  const projectName = (id: string) => { const p = byId.get(id); return p ? projectDisplayName(p) : '—'; };
  // A project row carries its own currency; a pool with no project (unallocated) has none, so it prints as a plain number.
  const money = (amount: number, projectId: string | null) => {
    const currency = projectId ? byId.get(projectId)?.currency : null;
    return currency ? formatCurrencyAuto(amount, currency) : formatNumberMax2(amount);
  };

  if (assets.isPending) return <ListState variant="loading" rows={4} />;
  if (assets.isError || !assets.data) return <ListState variant="error" title={t('equipment:assets.error', "Couldn't load equipment assets")}
    sub={t('equipment:assets.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void assets.refetch()} retryLabel={t('equipment:usage.retry', 'Retry')} />;
  if (!asset) return <ListState variant="empty" title={t('equipment:assets.notFound', 'This asset was not found')}
    sub={t('equipment:assets.notFoundSub', 'It may have been archived.')} action={{ label: t('equipment:assets.backToList', 'Back to assets'), onClick: () => navigate('/equipment/assets') }} />;
  return (
    <div>
      <RecordHeader icon="$" name={asset.name}
        status={<StatusPill variant="progress">{asset.code}</StatusPill>}
        meta={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{t('equipment:assets.unitLine', 'Logged in {{unit}}', { unit: unitLabel(t, asset.default_unit) })}</span>
          {asset.external_ref && <span>{t('equipment:assets.refLine', 'ERP reference {{ref}}', { ref: asset.external_ref })}</span>}
        </span>} />
      <UsageCard assetId={asset.id} today={today} projectName={projectName} />
      {may('view', 'equipmentCosting') && <CostingCard asset={asset} assetRow={asset} projectName={projectName} money={money} />}
      {may('view', 'equipmentUsage') && <AllocationsCard assetId={asset.id} today={today} projectName={projectName} money={money} />}
    </div>
  );
};
export default EquipmentAssetDetail;
