import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  Button, Combobox, ConfirmDialog, DataTable, Icon, ListPage, ListState, SelectField, StatusPill, Tabs, TextField, useToast,
  type Column, type StatusVariant,
} from '@/src/components/ui';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import {
  useApproveWeek, useArchiveUsage, useEquipmentAssets, useEquipmentUsage, useSaveUsage, useTransitionUsage,
} from '@/src/hooks/useEquipment';
import { useProjects } from '@/src/hooks/useProjects';
import { useUsers } from '@/src/hooks/useUsers';
import { LIST_LIMIT, type EquipmentAssetRow, type EquipmentUsageRow, type UsageInput } from '@/src/lib/db/equipment';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatNumberMax2, formatWeekdayMonthDay } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { addDays, fromIso, mondayOf, toIso, weekDays } from './equipmentWeek';

type Field = 'quantity' | 'fuel_litres' | 'trips';
type Kind = 'work' | 'standby';
/** One grid line: an (asset, project, kind) pair, or a fuel/trips line opened under it. */
interface GridRow { key: string; assetId: string; projectId: string; kind: Kind; field: Field }
type Tab = 'log' | 'approvals';
type Status = 'Draft' | 'Submitted' | 'Approved' | 'Rejected';
type Pending = { id: string; label: string } | null;

const STATUS_VARIANT: Record<Status, StatusVariant> = {
  Draft: 'draft', Submitted: 'warn', Approved: 'won', Rejected: 'lost',
};
const cellKey = (assetId: string, projectId: string, kind: string, date: string) => `${assetId}|${projectId}|${kind}|${date}`;
const rowKey = (assetId: string, projectId: string, kind: string) => `${assetId}|${projectId}|${kind}`;
const dayLabel = (iso: string) => formatWeekdayMonthDay(fromIso(iso));
const isEditable = (e: EquipmentUsageRow | undefined) => !e || e.status === 'Draft' || e.status === 'Rejected';

/** One grid input. Saves on blur or Enter, and only when the text changed; the stored value re-syncs after a refetch. */
const UsageCell: React.FC<{ label: string; stored: string; disabled: boolean; onCommit: (text: string) => void }> = ({ label, stored, disabled, onCommit }) => {
  const [text, setText] = useState(stored);
  useEffect(() => setText(stored), [stored]);
  const commit = () => { if (text.trim() !== stored) onCommit(text); };
  return (
    <TextField label={label} hideLabel inputMode="decimal" value={text} onChange={setText} disabled={disabled}
      onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      className="w-16 text-right tabular-nums" />
  );
};

/** Equipment → Usage: a week grid to log, submit and approve (FR-EQU-071). RPCs enforce; `can()` only hides. */
const EquipmentUsagePage: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const may = usePermission();
  // A view-as (impersonation) session is read-only: nothing here writes while the effective role is not the real one.
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  const writeCtx = { record: { viewOnly } };
  const canLog = may('create', 'equipmentUsage', writeCtx);
  const userId = useAuth().currentUser?.id ?? null;
  const today = toIso(new Date());
  // `?week=YYYY-MM-DD` deep-links a week (any day in it); otherwise the grid opens on this week.
  const [params] = useSearchParams();
  const [weekStart, setWeekStart] = useState(() => mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(params.get('week') ?? '') ? params.get('week')! : today));
  const [tab, setTab] = useState<Tab>('log');
  const [assetFilter, setAssetFilter] = useState<string | null>(null);
  const [added, setAdded] = useState<Array<{ assetId: string; projectId: string; kind: Kind }>>([]);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [draftRow, setDraftRow] = useState<{ assetId: string | null; projectId: string | null; kind: Kind }>({ assetId: null, projectId: null, kind: 'work' });
  const [warnings, setWarnings] = useState<Record<string, number>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Pending>(null);
  const [reason, setReason] = useState('');

  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const weekEnd = days[6];
  const assetsQ = useEquipmentAssets();
  const usageQ = useEquipmentUsage({ from: weekStart, to: weekEnd });
  const projectsQ = useProjects();
  const usersQ = useUsers();
  const save = useSaveUsage();
  const transition = useTransitionUsage();
  const approveWeek = useApproveWeek();
  const archive = useArchiveUsage();

  const assets = useMemo(() => assetsQ.data?.rows ?? [], [assetsQ.data]);
  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data]);
  const assetById = useMemo(() => new Map<string, EquipmentAssetRow>(assets.map((a) => [a.id, a])), [assets]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const userName = useMemo(() => new Map((usersQ.data ?? []).map((u) => [u.id, u.full_name])), [usersQ.data]);
  const assetOptions = useMemo(() => assets.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })), [assets]);
  const projectOptions = useMemo(() => projects.map((p) => ({ value: p.id, label: projectDisplayName(p) })), [projects]);
  const assetName = (id: string) => assetById.get(id)?.name ?? '—';
  const projectName = (id: string) => { const p = projectById.get(id); return p ? projectDisplayName(p) : '—'; };

  const entries = useMemo(
    () => (usageQ.data?.rows ?? []).filter((e) => !e.archived_at && (!assetFilter || e.asset_id === assetFilter)) as EquipmentUsageRow[],
    [usageQ.data, assetFilter],
  );
  const mine = useMemo(() => entries.filter((e) => e.author_id === userId), [entries, userId]);
  const byCell = useMemo(() => new Map(mine.map((e) => [cellKey(e.asset_id, e.project_id, e.kind, e.work_date), e])), [mine]);

  // Rows: every (asset, project, kind) with an entry this week, plus the ones added by hand; fuel/trips lines open beneath their row.
  const gridRows = useMemo(() => {
    const seen = new Map<string, GridRow>();
    for (const e of mine) seen.set(rowKey(e.asset_id, e.project_id, e.kind), { key: rowKey(e.asset_id, e.project_id, e.kind), assetId: e.asset_id, projectId: e.project_id, kind: e.kind as Kind, field: 'quantity' });
    for (const a of added) if (!assetFilter || a.assetId === assetFilter) seen.set(rowKey(a.assetId, a.projectId, a.kind), { key: rowKey(a.assetId, a.projectId, a.kind), ...a, field: 'quantity' });
    const base = [...seen.values()].sort((a, b) =>
      assetName(a.assetId).localeCompare(assetName(b.assetId)) || projectName(a.projectId).localeCompare(projectName(b.projectId)) || a.kind.localeCompare(b.kind));
    return base.flatMap((r) => (opened.has(r.key)
      ? [r, { ...r, key: `${r.key}|fuel_litres`, field: 'fuel_litres' as Field }, { ...r, key: `${r.key}|trips`, field: 'trips' as Field }]
      : [r]));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the name lookups derive from assets/projects, already deps
  }, [mine, added, opened, assetFilter, assets, projects]);

  const fail = (err: unknown) => {
    const c = classifyMutationError(err);
    setProblem(`${c.headline}. ${c.detail}`);
  };

  const commit = async (row: GridRow, date: string, text: string) => {
    const entry = byCell.get(cellKey(row.assetId, row.projectId, row.kind, date));
    const asset = assetById.get(row.assetId);
    const unit = entry?.unit ?? asset?.default_unit ?? 'hours';
    const raw = text.trim().replace(',', '.');
    setProblem(null);
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
        : { asset_id: row.assetId, project_id: row.projectId, work_date: date, quantity: value ?? 0, unit: unit as UsageInput['unit'], kind: row.kind };
      const result = await save.mutateAsync(input);
      setWarnings((w) => {
        const next = { ...w };
        if (result.over_24h) next[date] = result.day_total_hours; else delete next[date];
        return next;
      });
    } catch (err) { fail(err); }
  };

  const submitWeek = async () => {
    setProblem(null);
    let sent = 0;
    try {
      for (const e of mine) {
        if (e.status === 'Rejected') await transition.mutateAsync({ id: e.id, to: 'Draft' });
        if (e.status === 'Draft' || e.status === 'Rejected') { await transition.mutateAsync({ id: e.id, to: 'Submitted' }); sent += 1; }
      }
      if (sent > 0) toast(t('equipment:usage.submitted', '{{count}} entries submitted for approval', { count: sent }), undefined, 'success');
    } catch (err) { fail(err); }
  };
  const submittable = canLog && mine.some((e) => e.status === 'Draft' || e.status === 'Rejected');

  const columns: Column<GridRow>[] = [
    { key: 'asset', header: t('equipment:usage.columns.equipment', 'Equipment'), kind: 'primary', rowHeader: true, stickyLeft: true,
      cell: (r) => r.field === 'quantity'
        ? <span className="font-medium">{assetName(r.assetId)}{r.kind === 'standby' && <span className="ml-1 text-xs font-normal text-muted-foreground">{t('equipment:usage.standby', 'standby')}</span>}</span>
        : <span className="pl-3 text-xs text-muted-foreground">{r.field === 'fuel_litres' ? t('equipment:usage.fuel', 'Fuel (litres)') : t('equipment:usage.trips', 'Trips')}</span> },
    { key: 'project', header: t('equipment:usage.columns.project', 'Project'),
      cell: (r) => r.field === 'quantity'
        ? <span className="flex items-center gap-1">
          <span>{projectName(r.projectId)}</span>
          <Button variant="ghost" size="sm" aria-expanded={opened.has(r.key)}
            aria-label={t('equipment:usage.fuelTripsToggle', 'Fuel and trips for {{asset}} · {{project}}', { asset: assetName(r.assetId), project: projectName(r.projectId) })}
            onClick={() => setOpened((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })}>
            <Icon name="chev" />
          </Button>
        </span> : null },
    ...days.map<Column<GridRow>>((d) => ({
      key: d, header: <span className={d === today ? 'font-semibold text-foreground' : undefined}>{dayLabel(d)}</span>, align: 'num',
      cell: (r) => {
        const entry = byCell.get(cellKey(r.assetId, r.projectId, r.kind, d));
        const unit = entry?.unit ?? assetById.get(r.assetId)?.default_unit ?? 'hours';
        const suffix = r.field === 'quantity' ? unit : r.field === 'fuel_litres' ? t('equipment:usage.fuelUnit', 'fuel litres') : t('equipment:usage.trips', 'Trips').toLowerCase();
        const stored = !entry ? '' : r.field === 'quantity' ? String(Number(entry.quantity)) : entry[r.field] == null ? '' : String(Number(entry[r.field]));
        const locked = !canLog || !isEditable(entry) || d > today || (r.field !== 'quantity' && !entry);
        return <UsageCell label={`${assetName(r.assetId)} · ${projectName(r.projectId)} · ${dayLabel(d)}, ${suffix}`} stored={stored} disabled={locked}
          onCommit={(text) => void commit(r, d, text)} />;
      } })),
    { key: 'total', header: t('equipment:usage.columns.total', 'Total'), align: 'num',
      cell: (r) => {
        if (r.field !== 'quantity') return null;
        const rowEntries = mine.filter((e) => rowKey(e.asset_id, e.project_id, e.kind) === r.key);
        const unit = rowEntries[0]?.unit ?? assetById.get(r.assetId)?.default_unit ?? 'hours';
        return <span className="whitespace-nowrap tabular-nums">{formatNumberMax2(rowEntries.reduce((s, e) => s + Number(e.quantity), 0))} {unit}</span>;
      } },
    { key: 'status', header: t('equipment:usage.columns.status', 'Status'),
      cell: (r) => {
        if (r.field !== 'quantity') return null;
        const states = [...new Set(mine.filter((e) => rowKey(e.asset_id, e.project_id, e.kind) === r.key).map((e) => e.status))];
        if (states.length === 0) return <span className="text-muted-foreground">—</span>;
        return <span className="flex flex-wrap gap-1">{states.map((s) => <StatusPill key={s} variant={STATUS_VARIANT[s as Status]}>{statusLabel(t, s as Status)}</StatusPill>)}</span>;
      } },
  ];

  const addRow = () => {
    if (!draftRow.assetId || !draftRow.projectId) return;
    setAdded((rows) => [...rows, { assetId: draftRow.assetId!, projectId: draftRow.projectId!, kind: draftRow.kind }]);
    setDraftRow({ assetId: null, projectId: null, kind: 'work' });
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
    try { await transition.mutateAsync(notes ? { id, to, notes } : { id, to }); } catch (err) { fail(err); }
  };
  const approveAssetWeek = async (assetId: string) => {
    setProblem(null);
    try {
      const r = await approveWeek.mutateAsync({ assetId, weekStart });
      const parts = [t('equipment:usage.approveWeekDone', '{{count}} approved', { count: r.approved })];
      if (r.skipped_own > 0) parts.push(t('equipment:usage.skippedOwn', '{{count}} skipped (your own)', { count: r.skipped_own }));
      if (r.skipped_not_permitted > 0) parts.push(t('equipment:usage.skippedNotPermitted', '{{count}} skipped (not yours to approve)', { count: r.skipped_not_permitted }));
      toast(parts.join(' · '), undefined, 'success');
    } catch (err) { fail(err); }
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
        if (e.author_id === userId) return <span className="text-xs text-muted-foreground">{t('equipment:usage.ownEntry', 'Your own entry')}</span>;
        if (!mayDecide(e)) return <span className="text-xs text-muted-foreground">{t('equipment:usage.notYours', 'Another manager approves this')}</span>;
        const who = `${assetName(e.asset_id)} · ${projectName(e.project_id)} · ${dayLabel(e.work_date)}`;
        return (
          <span className="flex gap-1">
            <Button variant="outline" size="sm" aria-label={t('equipment:usage.approveEntry', 'Approve {{what}}', { what: who })} onClick={() => void decide(e.id, 'Approved')}>{t('equipment:usage.approve', 'Approve')}</Button>
            <Button variant="ghost" size="sm" aria-label={t('equipment:usage.rejectEntry', 'Reject {{what}}', { what: who })} onClick={() => { setReason(''); setRejecting({ id: e.id, label: who }); }}>{t('equipment:usage.reject', 'Reject')}</Button>
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
          onChange={(v) => setAssetFilter(v)} clearable onClear={() => setAssetFilter(null)} placeholder={t('equipment:usage.allAssets', 'All equipment')} />
      </div>
    </div>
  );

  return (
    <ListPage
      title={t('equipment:usage.title', 'Equipment')}
      description={t('equipment:usage.description', 'Log the hours or days each machine worked on a project, submit the week, and approve what others logged.')}
      primaryAction={tab === 'log' ? <CanWrite entity="equipmentUsage" action="create" ctx={writeCtx}>
        <Button variant="primary" disabled={!submittable || transition.isPending} onClick={() => void submitWeek()}>{t('equipment:usage.submitWeek', 'Submit week')}</Button>
      </CanWrite> : undefined}
      filters={header}
    >
      {canApproveTab && <Tabs items={tabs} value={tab} onChange={setTab} ariaLabel={t('equipment:usage.tabsLabel', 'Equipment usage views')} idBase="equipment-usage" className="mb-3" />}
      {problem && <p role="alert" className="mb-3 text-sm text-destructive-text">{problem}</p>}
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
          {usageQ.data.truncated && <p role="status" className="mb-2 text-sm text-muted-foreground">
            {t('equipment:usage.truncated', 'Showing the first {{count}} entries. Pick one machine to see the rest.', { count: LIST_LIMIT })}</p>}
          <DataTable<GridRow> embedded rows={gridRows} columns={columns} rowKey={(r) => r.key} tableId="equipment-usage-grid"
            accessibleName={t('equipment:usage.gridLabel', 'Equipment usage this week')}
            state={gridRows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('equipment:usage.empty', 'No equipment logged this week')}
            emptySub={t('equipment:usage.emptySub', 'Add a row for a machine and a project, then type the hours for each day.')} />
          <CanWrite entity="equipmentUsage" action="create" ctx={writeCtx}>
            <div className="mt-3">
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
                  <Button variant="primary" disabled={!draftRow.assetId || !draftRow.projectId} onClick={addRow}>{t('equipment:usage.addRowConfirm', 'Add')}</Button>
                  <Button variant="ghost" onClick={() => setAdding(false)}>{t('equipment:usage.cancel', 'Cancel')}</Button>
                </div>}
            </div>
          </CanWrite>
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
                {rows.some(mayDecide) && <Button variant="primary" size="sm" disabled={approveWeek.isPending} onClick={() => void approveAssetWeek(assetId)}>{t('equipment:usage.approveWeek', 'Approve week')}</Button>}
              </div>
              <DataTable<EquipmentUsageRow> embedded rows={rows} columns={approvalColumns} rowKey={(e) => e.id} tableId={`equipment-approvals-${assetId}`}
                accessibleName={t('equipment:usage.approvalsLabel', 'Submitted usage for {{asset}}', { asset: assetName(assetId) })} />
            </section>))
      )}
      <ConfirmDialog open={rejecting !== null} tone="destructive" title={t('equipment:usage.rejectTitle', 'Reject this entry?')}
        description={<div className="space-y-2">
          <p>{rejecting?.label}</p>
          <TextField label={t('equipment:usage.rejectReason', 'Reason')} required value={reason} onChange={setReason} />
        </div>}
        confirmLabel={t('equipment:usage.rejectConfirm', 'Reject entry')} confirmDisabled={reason.trim() === ''}
        onCancel={() => setRejecting(null)}
        onConfirm={() => { const r = rejecting; setRejecting(null); if (r) void decide(r.id, 'Rejected', reason.trim()); }} />
    </ListPage>
  );
};

function statusLabel(t: (k: string, d: string) => string, s: Status): string {
  switch (s) {
    case 'Draft': return t('equipment:status.draft', 'Draft');
    case 'Submitted': return t('equipment:status.submitted', 'Submitted');
    case 'Approved': return t('equipment:status.approved', 'Approved');
    case 'Rejected': return t('equipment:status.rejected', 'Rejected');
  }
}

export default EquipmentUsagePage;
