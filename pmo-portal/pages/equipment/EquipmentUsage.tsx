import { ReturnedBanner } from '@/src/components/ui/ReturnedBanner';
import { mapBoundedSettled } from '@/src/lib/pagedRead';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import {
  Button, Combobox, ConfirmDialog, DataTable, Icon, ListPage, ListState, ReasonDialog, SelectField, StatusPill, Tabs, TextField, tabId, tabPanelId, useToast, useUrlFilters,
  type Column,
} from '@/src/components/ui';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import {
  useApproveWeek, useArchiveUsage, useEquipmentAssetPages, useEquipmentUsage, useInvalidateUsage, useSaveUsage, useTransitionUsage,
} from '@/src/hooks/useEquipment';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { useLatestStatusDays } from '@/src/hooks/useEquipmentAvailability';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import { isDownStatus, type EquipmentStatus } from '@/src/lib/equipmentMetrics';
import { statusLabel } from './equipmentStatusLabels';
import { useUsers } from '@/src/hooks/useUsers';
import { type EquipmentAssetRow, type EquipmentUsageWithRejecter as EquipmentUsageRow, type UsageInput } from '@/src/lib/db/equipment';
import { classifyMutationError, joinSentences } from '@/src/lib/classifyMutationError';
import { formatDay, formatNumberMax2, formatWeekdayDay } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { addDays, fromIso, mondayOf, toIso, weekDays } from './equipmentWeek';
import { CostAttributionFields } from '@/src/components/workOrders/CostAttributionFields';
import { NO_ATTRIBUTION, type CostAttribution } from '@/src/lib/repositories/workOrderCosts';

type Field = 'quantity' | 'fuel_litres' | 'trips';
type Kind = 'work' | 'standby';
/** One grid line: an (asset, project, kind, work order, discipline) slot, or a fuel/trips line opened under it. */
interface GridRow { key: string; assetId: string; projectId: string; kind: Kind; field: Field; attribution: CostAttribution }
type Tab = 'log' | 'approvals';
type Pending = { id: string; label: string } | null;

const rowKey = (assetId: string, projectId: string, kind: string, attribution: CostAttribution) => `${assetId}|${projectId}|${kind}|${attribution.workOrderId ?? ''}|${attribution.disciplineId ?? ''}`;
const entryAttribution = (e: EquipmentUsageRow): CostAttribution => ({ workOrderId: e.work_order_id ?? null, disciplineId: e.discipline_id ?? null });
const cellKey = (assetId: string, projectId: string, kind: string, date: string, attribution: CostAttribution) => `${rowKey(assetId, projectId, kind, attribution)}|${date}`;
const dayLabel = (iso: string) => formatDay(fromIso(iso));
/** Column heading: weekday and day number only, so seven days fit beside the totals. The cell's accessible name keeps the full date. */
const dayHead = (iso: string) => formatWeekdayDay(fromIso(iso));
const isEditable = (e: EquipmentUsageRow | undefined) => !e || e.status === 'Draft' || e.status === 'Rejected';

/** One grid input. Saves on blur or Enter, and only when the text changed; the stored value re-syncs after a refetch. */
const UsageCell: React.FC<{ label: string; stored: string; disabled: boolean; onCommit: (text: string) => void }> = ({ label, stored, disabled, onCommit }) => {
  const [text, setText] = useState(stored);
  useEffect(() => setText(stored), [stored]);
  const commit = () => { if (text.trim() !== stored) onCommit(text); };
  return (
    <TextField label={label} hideLabel inputMode="decimal" value={text} onChange={setText} disabled={disabled}
      onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      className="w-14 px-1.5 text-right tabular-nums" />
  );
};

/** The work order and discipline a row's hours are charged to, shown on the row so a person sees where the hours go. */
const RowAttribution: React.FC<{ projectId: string; attribution: CostAttribution }> = ({ projectId, attribution }) =>
  attribution.workOrderId || attribution.disciplineId ? <RowAttributionLine projectId={projectId} attribution={attribution} /> : null;
const RowAttributionLine: React.FC<{ projectId: string; attribution: CostAttribution }> = ({ projectId, attribution }) => {
  const { t } = useTranslation();
  const workOrders = useProjectWorkOrders(attribution.workOrderId ? projectId : '');
  const disciplines = useCostDisciplines(Boolean(attribution.disciplineId));
  const wo = attribution.workOrderId ? workOrders.data?.find((w) => w.id === attribution.workOrderId) : null;
  const discipline = attribution.disciplineId ? disciplines.data?.find((d) => d.id === attribution.disciplineId) : null;
  const parts = [
    attribution.workOrderId ? t('equipment:usage.workOrderLine', 'Work order {{name}}', { name: wo ? (wo.wo_number ?? wo.title) : '…' }) : null,
    attribution.disciplineId ? t('equipment:usage.disciplineLine', 'Discipline {{name}}', { name: discipline?.name ?? '…' }) : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <span className="block text-sm text-muted-foreground" data-testid="row-attribution">{parts.join(' · ')}</span>;
};

/** Equipment → Usage: a week grid to log, submit and approve (FR-EQU-071). RPCs enforce; `can()` only hides. */
const EquipmentUsagePage: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const may = usePermission();
  // A view-as (impersonation) session is read-only: nothing here writes while the effective role is not the real one.
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  const writeCtx = { record: { viewOnly } };
  const canLog = may('create', 'equipmentUsage', writeCtx);
  const canCreateAsset = may('create', 'equipmentAsset', writeCtx);
  const userId = useAuth().currentUser?.id ?? null;
  const today = toIso(new Date());
  // R2: week/tab/asset are URL-owned (`?week=YYYY-MM-DD`, the same deep-link contract) so
  // Back/refresh return to them; defaults (this week, My usage, all assets) stay out of the URL.
  const { values, setFilter } = useUrlFilters(['week', 'tab', 'asset']);
  const thisWeek = mondayOf(today);
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(values.week) ? mondayOf(values.week) : thisWeek;
  const setWeekStart = (iso: string) => setFilter('week', iso === thisWeek ? '' : iso);
  const tab: Tab = values.tab === 'approvals' ? 'approvals' : 'log';
  const setTab = (next: Tab) => setFilter('tab', next === 'log' ? '' : next);
  const assetFilter = values.asset || null;
  const setAssetFilter = (next: string | null) => setFilter('asset', next ?? '');
  const [added, setAdded] = useState<Array<{ assetId: string; projectId: string; kind: Kind; attribution: CostAttribution }>>([]);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [draftRow, setDraftRow] = useState<{ assetId: string | null; projectId: string | null; kind: Kind; attribution: CostAttribution }>({ assetId: null, projectId: null, kind: 'work', attribution: NO_ATTRIBUTION });
  const [warnings, setWarnings] = useState<Record<string, number>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [approving, setApproving] = useState<Pending>(null);
  const [approvingWeek, setApprovingWeek] = useState<{ assetId: string; count: number } | null>(null);
  const [rejecting, setRejecting] = useState<Pending>(null);
  // A second person logging a machine-day someone else already holds (the unique day-per-machine rule): the typed hours stay in the cell.
  const [clash, setClash] = useState<{ who: string | null; asset: string; project: string; day: string; typed: string; link: string | null } | null>(null);
  const [confirmDown, setConfirmDown] = useState<{ asset: string; status: string } | null>(null);

  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const weekEnd = days[6];
  const assetsQ = useEquipmentAssetPages();
  const usageQ = useEquipmentUsage({ from: weekStart, to: weekEnd, ...(assetFilter ? { assetId: assetFilter } : {}) });
  const projectsQ = useProjectPickerOptions();
  const usersQ = useUsers();
  const save = useSaveUsage();
  const transition = useTransitionUsage();
  const weekTransition = useTransitionUsage({ deferInvalidate: true });
  const invalidateUsage = useInvalidateUsage();
  const [submitting, setSubmitting] = useState(false);
  const approveWeek = useApproveWeek();
  const archive = useArchiveUsage();

  const assets = useMemo(() => assetsQ.data?.pages.flatMap((page) => page.rows) ?? [], [assetsQ.data]);
  // The grid's empty state names WHICH absence it is: an empty machine register is a different
  // dead end (nothing can be logged yet) from a week with no hours, and only it has a fix this
  // screen cannot do itself — the New asset control on the assets page.
  const noMachines = !assetsQ.isPending && !assetsQ.isError && assets.length === 0;
  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data]);
  const latestStatus = useLatestStatusDays(assets.map((a) => a.id), today);
  const downStatus = useMemo(() => {
    const m = new Map<string, EquipmentStatus>();
    for (const row of latestStatus.data ?? []) if (isDownStatus(row.status)) m.set(row.asset_id, row.status);
    return m;
  }, [latestStatus.data]);
  const assetById = useMemo(() => new Map<string, EquipmentAssetRow>(assets.map((a) => [a.id, a])), [assets]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const userName = useMemo(() => new Map((usersQ.data ?? []).map((u) => [u.id, u.full_name])), [usersQ.data]);
  const assetOptions = useMemo(() => assets.map((a) => {
    const down = downStatus.get(a.id);
    return { value: a.id, label: `${a.code} · ${a.name}`, ...(down ? { sub: statusLabel(t, down) } : {}) };
  }), [assets, downStatus, t]);
  const projectOptions = useMemo(() => projects.map((p) => ({ value: p.id, label: projectDisplayName(p) })), [projects]);
  const assetName = (id: string) => assetById.get(id)?.name ?? '—';
  const projectName = (id: string) => { const p = projectById.get(id); return p ? projectDisplayName(p) : '—'; };

  const entries = useMemo(
    () => (usageQ.data?.rows ?? []).filter((e) => !e.archived_at && (!assetFilter || e.asset_id === assetFilter)) as EquipmentUsageRow[],
    [usageQ.data, assetFilter],
  );
  const mine = useMemo(() => entries.filter((e) => e.author_id === userId), [entries, userId]);
  const byCell = useMemo(() => new Map(mine.map((e) => [cellKey(e.asset_id, e.project_id, e.kind, e.work_date, entryAttribution(e)), e])), [mine]);

  // Rows: every (asset, project, kind, work order, discipline) with an entry this week, plus the ones added by hand; fuel/trips lines open beneath their row.
  const gridRows = useMemo(() => {
    const seen = new Map<string, GridRow>();
    // A row's work order and discipline (#2517) come from its entries, or from the Add-row pickers for a new row.
    for (const e of mine) {
      const key = rowKey(e.asset_id, e.project_id, e.kind, entryAttribution(e));
      if (!seen.has(key)) seen.set(key, { key, assetId: e.asset_id, projectId: e.project_id, kind: e.kind as Kind, field: 'quantity',
        attribution: { workOrderId: e.work_order_id ?? null, disciplineId: e.discipline_id ?? null } });
    }
    for (const a of added) {
      const key = rowKey(a.assetId, a.projectId, a.kind, a.attribution);
      if ((!assetFilter || a.assetId === assetFilter) && !seen.has(key)) seen.set(key, { key, ...a, field: 'quantity' });
    }
    const base = [...seen.values()].sort((a, b) =>
      assetName(a.assetId).localeCompare(assetName(b.assetId)) || projectName(a.projectId).localeCompare(projectName(b.projectId)) || a.kind.localeCompare(b.kind));
    return base.flatMap((r) => (opened.has(r.key)
      ? [r, { ...r, key: `${r.key}|fuel_litres`, field: 'fuel_litres' as Field }, { ...r, key: `${r.key}|trips`, field: 'trips' as Field }]
      : [r]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the name lookups derive from assets/projects, already deps
  }, [mine, added, opened, assetFilter, assets, projects]);

  const rowCount = gridRows.filter((r) => r.field === 'quantity').length;

  const classifiedFailure = (err: unknown) => {
    const c = classifyMutationError(err);
    return c.detail ? joinSentences(c.headline, c.detail) : c.headline;
  };
  const fail = (err: unknown) => setProblem(classifiedFailure(err));

  const commit = async (row: GridRow, date: string, text: string) => {
    const entry = byCell.get(cellKey(row.assetId, row.projectId, row.kind, date, row.attribution));
    const asset = assetById.get(row.assetId);
    const unit = entry?.unit ?? asset?.default_unit ?? 'hours';
    const raw = text.trim().replace(',', '.');
    setProblem(null);
    setClash(null);
    try {
      if (row.field === 'quantity' && raw === '') {
        if (entry && isEditable(entry)) await archive.mutateAsync(entry.id);
        return;
      }
      const decimals = row.field === 'trips' ? /^\d+$/ : /^\d+(\.\d{1,2})?$/;
      if (raw !== '' && !decimals.test(raw)) { setProblem(row.field === 'trips' ? t('equipment:usage.errors.trips', 'Trips must be a whole number, zero or more.') : t('equipment:usage.errors.number', 'Enter a number, zero or more, with at most two decimals.')); return; }
      const value = raw === '' ? null : Number(raw);
      if (row.field === 'quantity') {
        const max = unit === 'days' ? 1 : 24;
        if ((value ?? 0) > max) { setProblem(t('equipment:usage.errors.max', 'One entry holds at most {{max}}.', { max: unit === 'days' ? t('equipment:usage.maxDay', '1 day') : t('equipment:usage.maxHours', '24 hours') })); return; }
      }
      const input: UsageInput = entry
        ? { id: entry.id, asset_id: entry.asset_id, project_id: entry.project_id, work_date: entry.work_date, unit: entry.unit as UsageInput['unit'],
          kind: entry.kind as Kind, note: entry.note,
          quantity: row.field === 'quantity' ? value ?? 0 : Number(entry.quantity),
          fuel_litres: row.field === 'fuel_litres' ? value : entry.fuel_litres, trips: row.field === 'trips' ? value : entry.trips }
        : { asset_id: row.assetId, project_id: row.projectId, work_date: date, quantity: value ?? 0, unit: unit as UsageInput['unit'], kind: row.kind, ...(row.attribution.workOrderId || row.attribution.disciplineId ? { work_order_id: row.attribution.workOrderId, discipline_id: row.attribution.disciplineId } : {}) };
      const result = await save.mutateAsync(input);
      setWarnings((w) => {
        const next = { ...w };
        if (result.over_24h) next[date] = result.day_total_hours; else delete next[date];
        return next;
      });
      setClash(null);
      toast(t('equipment:usage.savedCell', 'Saved: {{asset}}, {{day}}', { asset: assetName(row.assetId), day: dayLabel(date) }), undefined, 'success');
    } catch (err) {
      if (classifyMutationError(err).classification === 'duplicate') {
        // Whose entry holds the day: the row's own cell is empty for this person, so it belongs to someone else.
        const other = entries.find((e) => e.asset_id === row.assetId && e.project_id === row.projectId && e.kind === row.kind && e.work_date === date && rowKey(e.asset_id, e.project_id, e.kind, entryAttribution(e)) === rowKey(row.assetId, row.projectId, row.kind, row.attribution) && e.author_id !== userId);
        setProblem(null);
        setClash({
          who: other ? (userName.get(other.author_id) ?? null) : null, asset: assetName(row.assetId), project: projectName(row.projectId),
          day: dayLabel(date), typed: `${text.trim()} ${unit}`,
          link: other && canApproveTab ? `/equipment?tab=approvals&week=${weekStart}&asset=${row.assetId}` : null,
        });
      } else fail(err);
    }
  };

  const submitWeek = async () => {
    setProblem(null);
    setSubmitting(true);
    const drafts = mine.filter((e) => e.status === 'Draft' || e.status === 'Rejected');
    // Entries go out five at a time; each keeps its own Draft→Submitted order. One refresh at the end.
    const results = await mapBoundedSettled(drafts, 5, async (e) => {
      if (e.status === 'Rejected') await weekTransition.mutateAsync({ id: e.id, to: 'Draft' });
      await weekTransition.mutateAsync({ id: e.id, to: 'Submitted' });
    });
    if (drafts.length > 0) invalidateUsage();
    setSubmitting(false);
    const failed = drafts.filter((_, i) => results[i].status === 'rejected')
      .map((e) => `${assetName(e.asset_id)} · ${projectName(e.project_id)} · ${dayLabel(e.work_date)}`);
    const sent = drafts.length - failed.length;
    if (failed.length > 0) {
      setProblem(t('equipment:usage.partialSubmit', '{{submitted}} submitted; {{failed}} failed. Failed entries: {{items}}.', {
        submitted: sent,
        failed: failed.length,
        items: failed.join('; '),
      }));
    } else if (sent > 0) {
      toast(t('equipment:usage.submitted', '{{count}} entries submitted for approval', { count: sent }), undefined, 'success');
    }
  };
  const submittable = canLog && mine.some((e) => e.status === 'Draft' || e.status === 'Rejected');
  const draftsToSubmit = mine.filter((e) => e.status === 'Draft' || e.status === 'Rejected');
  const draftCount = draftsToSubmit.length;
  // Who approves: the project manager of each project the drafts are on; an Admin when a project has none.
  const approverText = useMemo(() => {
    const names = new Set<string>();
    let adminFallback = false;
    for (const e of draftsToSubmit) {
      const pm = projectById.get(e.project_id)?.project_manager_id;
      const name = pm ? userName.get(pm) : null;
      if (name) names.add(name); else adminFallback = true;
    }
    const list = [...names];
    if (adminFallback) list.push(t('equipment:usage.anAdmin', 'an Admin'));
    return list.join(', ');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draftsToSubmit derives from mine
  }, [mine, projectById, userName, t]);
  const columns: Column<GridRow>[] = [
    // Keep this semantic row header at its declared width; the shared `primary` kind enforces a
    // 240px minimum that pushes the Fuel and trips control outside the 1440px usage grid.
    { key: 'asset', header: t('equipment:usage.columns.equipment', 'Equipment'), rowHeader: true, stickyLeft: true, size: 170, minSize: 140,
      cell: (r) => r.field === 'quantity'
        ? <span className="font-medium">{assetName(r.assetId)}{r.kind === 'standby' && <span className="ml-1 text-sm font-normal text-muted-foreground">{t('equipment:usage.standby', 'standby')}</span>}<RowAttribution projectId={r.projectId} attribution={r.attribution} /></span>
        : <span className="pl-3 text-sm text-muted-foreground">{r.field === 'fuel_litres' ? t('equipment:usage.fuel', 'Fuel (litres)') : t('equipment:usage.trips', 'Trips')}</span> },
    { key: 'project', header: t('equipment:usage.columns.project', 'Project'), size: 150, minSize: 110, cell: (r) => r.field === 'quantity' ? <><span>{projectName(r.projectId)}</span></> : null },
    ...days.map<Column<GridRow>>((d) => ({
      key: d, header: <span className={d === today ? 'whitespace-nowrap font-semibold text-foreground' : 'whitespace-nowrap'}>{dayHead(d)}</span>, align: 'num', colClassName: 'px-1', size: 80, minSize: 76,
      cell: (r) => {
        const entry = byCell.get(cellKey(r.assetId, r.projectId, r.kind, d, r.attribution));
        const unit = entry?.unit ?? assetById.get(r.assetId)?.default_unit ?? 'hours';
        const suffix = r.field === 'quantity' ? unit : r.field === 'fuel_litres' ? t('equipment:usage.fuelUnit', 'fuel litres') : t('equipment:usage.trips', 'Trips').toLowerCase();
        const stored = !entry ? '' : r.field === 'quantity' ? String(Number(entry.quantity)) : entry[r.field] == null ? '' : String(Number(entry[r.field]));
        const locked = !canLog || !isEditable(entry) || d > today || (r.field !== 'quantity' && !entry);
        return <UsageCell label={`${assetName(r.assetId)} · ${projectName(r.projectId)} · ${dayLabel(d)}, ${suffix}`} stored={stored} disabled={locked}
          onCommit={(text) => void commit(r, d, text)} />;
      } })),
    { key: 'total', header: t('equipment:usage.columns.total', 'Total'), align: 'num', size: 84,
      cell: (r) => {
        if (r.field !== 'quantity') return null;
        const rowEntries = mine.filter((e) => rowKey(e.asset_id, e.project_id, e.kind, entryAttribution(e)) === r.key);
        const unit = rowEntries[0]?.unit ?? assetById.get(r.assetId)?.default_unit ?? 'hours';
        return <span className="whitespace-nowrap tabular-nums">{formatNumberMax2(rowEntries.reduce((s, e) => s + Number(e.quantity), 0))} {unit}</span>;
      } },
    { key: 'status', header: t('equipment:usage.columns.status', 'Status'), size: 112,
      cell: (r) => {
        if (r.field !== 'quantity') return null;
        const states = [...new Set(mine.filter((e) => rowKey(e.asset_id, e.project_id, e.kind, entryAttribution(e)) === r.key).map((e) => e.status))];
        if (states.length === 0) return <span className="text-muted-foreground">—</span>;
        return <span className="flex flex-wrap gap-1">{states.map((s) => <StatusPill key={s} record="equipmentUsage" state={s} wrap={false} />)}</span>;
      } },
    { key: 'more', size: 48, header: <span className="sr-only">{t('equipment:usage.columns.fuelTrips', 'Fuel · trips')}</span>,
      cell: (r) => r.field !== 'quantity' ? null : (
        <Button variant="ghost" size="sm" aria-expanded={opened.has(r.key)}
          aria-label={t('equipment:usage.fuelTripsToggle', 'Fuel and trips for {{asset}} · {{project}}', { asset: assetName(r.assetId), project: projectName(r.projectId) })}
          onClick={() => setOpened((st) => { const n = new Set(st); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })}>
          <Icon name="chev" />
        </Button>) },
  ];

  const addRow = (confirmed = false) => {
    if (!draftRow.assetId || !draftRow.projectId) return;
    const down = downStatus.get(draftRow.assetId);
    if (down && !confirmed) { setConfirmDown({ asset: assetName(draftRow.assetId), status: statusLabel(t, down) }); return; }
    setAdded((rows) => [...rows, { assetId: draftRow.assetId!, projectId: draftRow.projectId!, kind: draftRow.kind, attribution: draftRow.attribution }]);
    setDraftRow({ assetId: null, projectId: null, kind: 'work', attribution: NO_ATTRIBUTION });
    setAdding(false);
  };

  // ── Approvals: Submitted entries this week, grouped by asset (the unit of "Approve week") ──────
  const canApproveTab = may('view', 'equipmentUsage');
  const waiting = useMemo(() => entries.filter((e) => e.status === 'Submitted'), [entries]);
  const waitingByAsset = useMemo(() => {
    const groups = new Map<string, EquipmentUsageRow[]>();
    for (const e of waiting) groups.set(e.asset_id, [...(groups.get(e.asset_id) ?? []), e]);
    return [...groups.entries()].sort(([a], [b]) => assetName(a).localeCompare(assetName(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assetName derives from assets
  }, [waiting, assets]);
  const mayDecide = (e: EquipmentUsageRow) => may('transition', 'equipmentUsage', {
    currentUserId: userId, record: { author_id: e.author_id, project_manager_id: projectById.get(e.project_id)?.project_manager_id ?? null, viewOnly },
  });
  const decide = async (id: string, to: 'Approved' | 'Rejected', notes?: string) => {
    setProblem(null);
    setDecisionError(null);
    try {
      await transition.mutateAsync(notes ? { id, to, notes } : { id, to });
      return true;
    } catch (err) {
      setDecisionError(classifiedFailure(err));
      return false;
    }
  };
  const approveAssetWeek = async (assetId: string): Promise<boolean> => {
    setProblem(null);
    try {
      const r = await approveWeek.mutateAsync({ assetId, weekStart });
      const parts = [t('equipment:usage.approveWeekDone', '{{count}} approved', { count: r.approved })];
      if (r.skipped_own > 0) parts.push(t('equipment:usage.skippedOwn', '{{count}} skipped (your own)', { count: r.skipped_own }));
      if (r.skipped_not_permitted > 0) parts.push(t('equipment:usage.skippedNotPermitted', '{{count}} skipped (not yours to approve)', { count: r.skipped_not_permitted }));
      toast(parts.join(' · '), undefined, 'success');
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };
  const approvalColumns: Column<EquipmentUsageRow>[] = [
    { key: 'date', header: t('equipment:usage.columns.date', 'Date'), kind: 'primary', rowHeader: true, cell: (e) => dayLabel(e.work_date) },
    { key: 'project', header: t('equipment:usage.columns.project', 'Project'), cell: (e) => projectName(e.project_id) },
    { key: 'author', header: t('equipment:usage.columns.loggedBy', 'Logged by'), cell: (e) => userName.get(e.author_id) ?? '—' },
    { key: 'qty', header: t('equipment:usage.columns.quantity', 'Quantity'), align: 'num',
      cell: (e) => <span className="whitespace-nowrap tabular-nums">{formatNumberMax2(Number(e.quantity))} {e.unit}{e.kind === 'standby' ? ` · ${t('equipment:usage.standby', 'standby')}` : ''}</span> },
    { key: 'measures', header: t('equipment:usage.columns.fuelTrips', 'Fuel · trips'), align: 'num',
      cell: (e) => <span className="tabular-nums">{e.fuel_litres == null ? '—' : formatNumberMax2(Number(e.fuel_litres))} · {e.trips ?? '—'}</span> },
    { key: 'act', header: t('equipment:usage.columns.decision', 'Decision'),
      cell: (e) => {
        if (e.author_id === userId) return <span className="text-sm text-muted-foreground">{t('equipment:usage.ownEntry', 'Your own entry')}</span>;
        if (!mayDecide(e)) return <span className="text-sm text-muted-foreground">{t('equipment:usage.notYours', 'Another manager approves this')}</span>;
        const who = `${assetName(e.asset_id)} · ${projectName(e.project_id)} · ${dayLabel(e.work_date)}`;
        return (
          <span className="flex gap-1">
            <Button variant="outline" size="sm" aria-label={t('equipment:usage.rejectEntry', 'Return {{what}}', { what: who })} onClick={() => { setDecisionError(null); setRejecting({ id: e.id, label: who }); }}>{t('equipment:usage.reject', 'Return')}</Button>
            <Button variant="primary" size="sm" aria-label={t('equipment:usage.approveEntry', 'Approve {{what}}', { what: who })} onClick={() => { setDecisionError(null); setApproving({ id: e.id, label: who }); }}>{t('equipment:usage.approve', 'Approve')}</Button>
          </span>
        );
      } },
  ];

  const tabs = [{ value: 'log' as Tab, label: t('equipment:usage.tabs.log', 'My usage') },
    ...(canApproveTab ? [{ value: 'approvals' as Tab, label: t('equipment:usage.tabs.approvals', 'Approvals') }] : [])];

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" aria-label={t('equipment:usage.prevWeek', 'Previous week')} onClick={() => setWeekStart(addDays(weekStart, -7))}><Icon name="back" /></Button>
      <span className="min-w-40 text-center text-sm font-medium tabular-nums" aria-live="polite">{dayLabel(weekStart)} – {dayLabel(weekEnd)}</span>
      <Button variant="outline" size="sm" aria-label={t('equipment:usage.nextWeek', 'Next week')} onClick={() => setWeekStart(addDays(weekStart, 7))}><Icon name="chev" /></Button>
      <Button variant="ghost" size="sm" onClick={() => setWeekStart(mondayOf(today))}>{t('equipment:usage.thisWeek', 'This week')}</Button>
      <div className="w-64">
        <Combobox label={t('equipment:usage.assetFilter', 'Show equipment')} noun={t('equipment:usage.assetNoun', 'equipment')} value={assetFilter}
          selectedOption={assetOptions.find((o) => o.value === assetFilter) ?? null} loadOptions={() => Promise.resolve(assetOptions)}
          onChange={(v) => setAssetFilter(v)} clearable onClear={() => setAssetFilter(null)} placeholder={t('equipment:usage.allAssets', 'All equipment')} compact />
      </div>
    </div>
  );

  return (
    <ListPage
      title={t('equipment:usage.title', 'Equipment')}
      count={tab === 'log' && !usageQ.isPending && !usageQ.isError && usageQ.data ? rowCount : undefined}
      filters={header}
    >
      <nav aria-label={t('equipment:home.links', 'Equipment pages')} className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        <Link className="touch-target inline-flex items-center text-primary-text underline" to="/equipment">{t('equipment:home.machines', 'Machines and today\'s status')}</Link>
        <Link className="touch-target inline-flex items-center text-primary-text underline" to="/equipment/availability">{t('equipment:availability.title', 'Availability')}</Link>
        <Link className="touch-target inline-flex items-center text-primary-text underline" to="/equipment/expiring">{t('equipment:nav.expiring', 'Expiring documents')}</Link>
      </nav>
      {canApproveTab && <Tabs items={tabs} value={tab} onChange={setTab} ariaLabel={t('equipment:usage.tabsLabel', 'Equipment usage views')} idBase="equipment-usage" className="mb-3" />}
      {/* The machine reads (picker, row names) page through the register: say how many are loaded so
          a machine past the first page is never silently missing from the picker. */}
      {assetsQ.hasNextPage && <ListState variant="partial" className="mb-3"
        title={t('projects:listPage.loadedMoreAvailable', { defaultValue: '{{count}} loaded, more available', count: assets.length })}
        sub={t('equipment:usage.moreAssets', 'Machines past this page are not loaded yet.')}
        action={{ label: t('equipment:assets.loadMore', 'Load more'), onClick: () => void assetsQ.fetchNextPage(), loading: assetsQ.isFetchingNextPage }} />}
      <div {...(canApproveTab ? { id: tabPanelId('equipment-usage', tab), role: 'tabpanel', 'aria-labelledby': tabId('equipment-usage', tab) } : {})}>
      {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
      {clash && <p role="alert" className="mb-3 text-sm text-destructive-text">
        {clash.who
          ? t('equipment:usage.clashNamed', '{{name}} already logged {{asset}} for {{project}} on {{day}}.', { name: clash.who, asset: clash.asset, project: clash.project, day: clash.day })
          : t('equipment:usage.clashUnnamed', 'Someone else already logged {{asset}} for {{project}} on {{day}}.', { asset: clash.asset, project: clash.project, day: clash.day })}{' '}
        {t('equipment:usage.clashKept', 'Your {{typed}} was not saved. It is still in the box, so you can change it or copy it.', { typed: clash.typed })}{' '}
        {clash.link && <Link className="text-primary-text underline" to={clash.link}>{t('equipment:usage.clashLink', 'See their entry')}</Link>}
      </p>}
      {Object.entries(warnings).map(([date, hours]) => (
        <p key={date} role="status" className="mb-2 flex items-center gap-2 text-sm text-warning-foreground">
          <Icon name="alert" />
          {t('equipment:usage.over24', '{{day}}: {{hours}} h logged across projects, more than 24 h. Saved; check it before approval.', { day: dayLabel(date), hours: formatNumberMax2(hours) })}
        </p>
      ))}
      {usageQ.isPending && <ListState variant="loading" rows={4} />}
      {!usageQ.isPending && (usageQ.isError || !usageQ.data) && (
        <ListState variant="error" title={t('equipment:usage.error', "Couldn't load equipment usage")}
          sub={t('equipment:usage.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void usageQ.refetch()}
          retryLabel={t('equipment:usage.retry', 'Retry')} />
      )}
      {!usageQ.isPending && !usageQ.isError && usageQ.data && tab === 'log' && (
        <>
          {!noMachines && <CanWrite entity="equipmentUsage" action="create" ctx={writeCtx}>
            <div className="mb-3">
              {!adding
                ? <Button variant="outline" onClick={() => setAdding(true)}><Icon name="plus" />{t('equipment:usage.addRow', 'Add row')}</Button>
                : <div className="flex flex-wrap items-end gap-2 rounded-card border border-border p-3">
                  <div className="w-64"><Combobox label={t('equipment:usage.rowAsset', 'Equipment')} required noun={t('equipment:usage.assetNoun', 'equipment')}
                    value={draftRow.assetId} selectedOption={assetOptions.find((o) => o.value === draftRow.assetId) ?? null}
                    loadOptions={() => Promise.resolve(assetOptions)} onChange={(v) => setDraftRow((d) => ({ ...d, assetId: v }))} /></div>
                  <div className="w-64"><Combobox label={t('equipment:usage.rowProject', 'Project')} required noun={t('equipment:usage.projectNoun', 'project')}
                    value={draftRow.projectId} selectedOption={projectOptions.find((o) => o.value === draftRow.projectId) ?? null}
                    loadOptions={() => Promise.resolve(projectOptions)} onChange={(v) => setDraftRow((d) => ({ ...d, projectId: v }))} /></div>
                  <div className="w-36"><SelectField label={t('equipment:usage.rowKind', 'Kind')} value={draftRow.kind} onChange={(v) => setDraftRow((d) => ({ ...d, kind: v as Kind }))}
                    options={[{ value: 'work', label: t('equipment:usage.kindWork', 'Work') }, { value: 'standby', label: t('equipment:usage.kindStandby', 'Standby') }]} /></div>
                  <CostAttributionFields idPrefix="equipment-row" itemClassName="w-64" projectId={draftRow.projectId} value={draftRow.attribution}
                    onChange={(attribution) => setDraftRow((d) => ({ ...d, attribution }))} />
                  <Button variant="primary" disabled={!draftRow.assetId || !draftRow.projectId} onClick={() => addRow()}>{t('equipment:usage.addRowConfirm', 'Add')}</Button>
                  <Button variant="ghost" onClick={() => setAdding(false)}>{t('equipment:usage.cancel', 'Cancel')}</Button>
                </div>}
            </div>
          </CanWrite>}
          {mine.filter((e) => e.status === 'Rejected' || (e.status === 'Draft' && !!(e.rejected_at || e.rejected_by || e.decision_notes?.trim()))).map((e) => <div key={e.id} className="mb-3">
            <strong>{assetName(e.asset_id)} · {projectName(e.project_id)} · {dayLabel(e.work_date)}</strong>
            <ReturnedBanner record="equipmentUsage" reason={e.decision_notes} person={e.rejecter?.full_name} at={e.rejected_at} />
          </div>)}
          <DataTable<GridRow> embedded rows={gridRows} columns={columns} rowKey={(r) => r.key} tableId="equipment-usage-grid"
            accessibleName={t('equipment:usage.gridLabel', 'Equipment usage this week')}
            state={gridRows.length === 0 ? 'empty' : undefined}
            emptyTitle={noMachines
              ? t('equipment:usage.noMachines', 'No machines registered')
              : t('equipment:usage.empty', 'No hours logged this week')}
            emptySub={noMachines && !canCreateAsset ? t('equipment:usage.noMachinesSub', 'An Admin or Project Manager adds the machines.') : undefined}
            emptyAction={noMachines && canCreateAsset
              ? { label: t('equipment:assets.new', 'New asset'), onClick: () => navigate('/equipment/assets') }
              : undefined} />
          {submittable && <CanWrite entity="equipmentUsage" action="create" ctx={writeCtx}>
            <section aria-label={t('equipment:usage.submitSection', 'Submit the week')} className="mt-4 rounded-card border border-border p-3">
              <p className="mb-2 text-sm">{t('equipment:usage.submitWhat', 'Submitting sends {{count}} draft {{entries}} for approval. You cannot change them until they are approved or returned. Approver: {{approver}}.', {
                count: draftCount, entries: draftCount === 1 ? t('equipment:usage.entryOne', 'entry') : t('equipment:usage.entryMany', 'entries'), approver: approverText })}</p>
              <Button variant="primary" disabled={transition.isPending || submitting} onClick={() => void submitWeek()}>{t('equipment:usage.submitWeek', 'Submit week')}</Button>
            </section>
          </CanWrite>}
        </>
      )}
      {!usageQ.isPending && !usageQ.isError && usageQ.data && tab === 'approvals' && canApproveTab && (
        waitingByAsset.length === 0
          ? <ListState variant="empty" title={t('equipment:usage.approvalsEmpty', 'Nothing is waiting for approval this week')}
            sub={t('equipment:usage.approvalsEmptySub', 'Submitted entries from the week show here.')} />
          : waitingByAsset.map(([assetId, rows]) => (
            <section key={assetId} className="mb-4" aria-labelledby={`equipment-approvals-${assetId}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 id={`equipment-approvals-${assetId}`} className="text-sm font-semibold">{assetName(assetId)}</h3>
                {rows.some(mayDecide) && <Button variant="primary" size="sm" disabled={approveWeek.isPending} onClick={() => setApprovingWeek({ assetId, count: rows.filter(mayDecide).length })}>{t('equipment:usage.approveWeek', 'Approve week')}</Button>}
              </div>
              <DataTable<EquipmentUsageRow> embedded rows={rows} columns={approvalColumns} rowKey={(e) => e.id} tableId={`equipment-approvals-${assetId}`}
                accessibleName={t('equipment:usage.approvalsLabel', 'Submitted usage for {{asset}}', { asset: assetName(assetId) })} />
            </section>))
      )}
      </div>
      <ConfirmDialog
        open={confirmDown !== null}
        title={t('equipment:usage.downTitle', 'This machine is down')}
        description={t('equipment:usage.downBody', '{{asset}} is marked {{status}}. Log hours against it anyway?', { asset: confirmDown?.asset ?? '', status: confirmDown?.status ?? '' })}
        confirmLabel={t('equipment:usage.downConfirm', 'Log hours anyway')}
        onCancel={() => setConfirmDown(null)}
        onConfirm={() => { setConfirmDown(null); addRow(true); }}
      />
      <ConfirmDialog
        open={approving !== null}
        title={t('equipment:usage.confirmApproveTitle', 'Approve usage entry?')}
        description={approving?.label ?? t('equipment:usage.confirmApproveBody', 'This will approve the logged equipment usage entry.')}
        confirmLabel={t('equipment:usage.approve', 'Approve')}
        loading={transition.isPending}
        error={decisionError}
        onCancel={() => { setApproving(null); setDecisionError(null); }}
        onConfirm={async () => {
          const a = approving;
          if (a && await decide(a.id, 'Approved')) setApproving(null);
        }}
      />
      <ConfirmDialog
        open={approvingWeek !== null}
        title={t('equipment:usage.confirmApproveWeekTitle', 'Approve equipment usage week?')}
        description={t('equipment:usage.confirmApproveWeekBody', 'Approve {{count}} submitted {{entries}} for {{asset}} during {{from}} – {{to}}. Their status will change to Approved. Your own entries and any entry you cannot approve are skipped and stay unchanged.', {
          count: approvingWeek?.count ?? 0,
          entries: approvingWeek?.count === 1 ? 'entry' : 'entries',
          asset: approvingWeek ? assetName(approvingWeek.assetId) : '',
          from: dayLabel(weekStart),
          to: dayLabel(weekEnd),
        })}
        confirmLabel={t('equipment:usage.approveWeek', 'Approve week')}
        loading={approveWeek.isPending}
        onCancel={() => { if (!approveWeek.isPending) setApprovingWeek(null); }}
        onConfirm={() => {
          const pending = approvingWeek;
          if (pending) void approveAssetWeek(pending.assetId).then((succeeded) => {
            if (succeeded) setApprovingWeek(null);
          });
        }}
      />
      <ReasonDialog maxLength={500} open={rejecting !== null} kind="return" subject={t('equipment:usage.entrySubject', 'usage entry')} context={rejecting?.label}
        loading={transition.isPending} error={decisionError} onCancel={() => { setRejecting(null); setDecisionError(null); }}
        onConfirm={async (notes) => { const r = rejecting; if (r && await decide(r.id, 'Rejected', notes)) setRejecting(null); }} />
    </ListPage>
  );
};

export default EquipmentUsagePage;
