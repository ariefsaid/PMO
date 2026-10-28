import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ListPage,
  SearchMini,
  ViewToggle,
  ListState,
  StatusPill,
  LifecycleStepper,
  Button,
  Icon,
  ProjectNameLink,
  MobileToolbarDisclosure,
  Card,
  type Column,
} from '@/src/components/ui';
import { ExportButton, withCurrencyColumn } from '@/src/components/export';
import { ImportButton } from '@/src/components/import';
import { ProcurementCycleImportWizard } from '@/src/components/import/procurementCycle/ProcurementCycleImportWizard';
import { makeProcurementImportDescriptor, makeRefLookup } from '@/src/lib/import';
import { useProjectOptions, useVendorOptions } from '@/src/hooks/useFkOptions';
import { useProcurementStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useErpOrphans } from '@/src/hooks/useErpPurchases';
import { useProjects } from '@/src/hooks/useProjects';
import { trackProcurementDetailOpened, trackFilterApplied, trackEmptyStateSeen } from '@/src/lib/analytics';
import { ProcurementBlock } from '@/src/components/procurement';
import { ProcurementKpiRow, type ProcurementTab } from './procurement/list/ProcurementKpiRow';
import { formatCurrency, formatWeekdayMonthDay } from '@/src/lib/format';
import { externalRefsOf, type ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import ProcurementBoard from '../components/ProcurementBoard';
import { readProcurementView, writeProcurementView } from '@/src/hooks/useProcurementView';
import type { ProcurementView } from '@/src/hooks/useProcurementView';
import { useListWorkingSet, useUrlSearchInput } from '@/src/hooks/useListWorkingSet';
import { useListReturn } from '@/src/hooks/useListReturn';
import { lifecycleSteps, pillVariantForStatus } from '../components/procurement';
import { ErpOrphansSection } from './procurement/ErpOrphansSection';
import { needsYou, type NeedsYouResult } from './procurement/blocks/needsYou';
import type { StageKey } from './procurement/blocks/stage';
import { matchesStage, type ProcurementListRole } from './procurement/list/model';
import { ProcurementGroupedView } from './procurement/list/ProcurementGroupedView';

type StatusFilter = 'All' | 'Needs approval' | 'Open' | 'Ordered' | 'Vendor Invoiced' | 'Paid';
type ProcurementRouteView = ProcurementView | 'grouped';

const OPEN_STATUSES = new Set<string>(['Draft', 'Requested', 'Approved', 'Vendor Quoted', 'Quote Selected']);
const ORDERED_STATUSES = new Set<string>(['Ordered', 'Received', 'Vendor Invoiced']);
const STATUS_FILTERS: StatusFilter[] = ['All', 'Needs approval', 'Open', 'Ordered', 'Vendor Invoiced', 'Paid'];
const APPROVAL_ROLES = new Set(['Admin', 'Executive', 'Project Manager', 'Finance']);
const STAGE_KEYS: StageKey[] = ['request', 'order', 'receive', 'pay'];

function matchesFilter(status: string, filter: StatusFilter): boolean {
  switch (filter) {
    case 'Needs approval': return status === 'Requested';
    case 'Open': return OPEN_STATUSES.has(status);
    case 'Ordered': return ORDERED_STATUSES.has(status);
    case 'Vendor Invoiced': return status === 'Vendor Invoiced';
    case 'Paid': return status === 'Paid';
    default: return true;
  }
}

function matchesWorkingSetStatus(status: string, workingSet: { status: string; statusMode: 'exact' | 'group' }): boolean {
  if (workingSet.statusMode === 'exact') return status === workingSet.status;
  return matchesFilter(status, workingSet.status as StatusFilter);
}

function stageFromSearch(search: string): StageKey | null {
  const value = new URLSearchParams(search).get('stage');
  return STAGE_KEYS.includes(value as StageKey) ? value as StageKey : null;
}

function tabFromSearch(search: string, needsCount: number, canSeeOrphans: boolean): ProcurementTab {
  const params = new URLSearchParams(search);
  const requested = params.get('tab');
  if (requested === 'all') return 'all';
  if (requested === 'needs-you') return 'needs-you';
  if (requested === 'orphans' && canSeeOrphans) return 'orphans';
  // A status/stage dashboard drill must stay visible in All even when a separate queue has work.
  if (requested === null && (params.has('status') || params.has('stage'))) return 'all';
  return needsCount > 0 ? 'needs-you' : 'all';
}

function routeViewFromSearch(search: string, fallback: ProcurementView): ProcurementRouteView {
  const value = new URLSearchParams(search).get('view');
  return value === 'table' || value === 'board' || value === 'grouped' ? value : fallback;
}

function reasonCopy(result: NeedsYouResult, t: (key: string, options?: Record<string, unknown>) => string): string {
  const days = Math.max(0, Math.floor((Date.now() - result.since.getTime()) / 86_400_000));
  const age = days === 1
    ? t('age.oneDay', { defaultValue: '1 day' })
    : t('age.days', { count: days, defaultValue: '{{count}} days' });
  if (result.reason === 'approve') return t('needsYou.approve', { age, defaultValue: 'Waiting for your approval · {{age}}' });
  if (result.reason === 'pay') return t('needsYou.pay', { age, defaultValue: 'Unpaid · {{age}} outstanding' });
  const orderedDate = formatWeekdayMonthDay(result.since);
  return t('needsYou.receive', { date: orderedDate, age, defaultValue: 'Waiting for receipt · ordered {{date}} · {{age}}' });
}

function distinctOptions<T extends string>(entries: Array<{ value: T | null; label: string | null | undefined }>) {
  const options = new Map<T, string>();
  for (const entry of entries) {
    if (entry.value && entry.label) options.set(entry.value, entry.label);
  }
  return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

const ProcurementPage: React.FC = () => {
  const { t } = useTranslation('procurementList');
  const navigate = useNavigate();
  const location = useLocation();
  const statusLabel = useProcurementStatusLabel();
  const { realRole } = useEffectiveRole();
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  const may = usePermission();

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (query.get('create') === '1') {
      query.delete('create');
      navigate(`/procurement/new${query.size ? `?${query}` : ''}`, { replace: true });
    }
  }, [location.search, navigate]);

  const isEngineer = realRole === 'Engineer';
  const isProjectManager = realRole === 'Project Manager';
  const canSeeOrphans = realRole === 'Finance' || realRole === 'Admin';
  const canApprove = realRole != null && APPROVAL_ROLES.has(realRole);
  const canCreate = may('create', 'procurement');
  const canViewOrphans = canSeeOrphans && may('view', 'procurement');

  const { data, isPending, isError, refetch } = useProcurements({ withRefs: true, withSharedDetails: true });
  const projectQuery = useProjectOptions();
  const supplierQuery = useVendorOptions();
  const { data: projectOptions = [] } = projectQuery;
  const { data: supplierOptions = [] } = supplierQuery;

  const projectRefs = useMemo(() => projectOptions.map((option) => ({ id: option.value, name: option.label })), [projectOptions]);
  const supplierRefs = useMemo(() => supplierOptions.map((option) => ({ id: option.value, name: option.label })), [supplierOptions]);
  const importDescriptor = useMemo(
    () => makeProcurementImportDescriptor(projectRefs, supplierRefs, userId ?? ''),
    [projectRefs, supplierRefs, userId],
  );
  const cycleProjectLookup = useMemo(() => makeRefLookup(projectRefs, 'Project'), [projectRefs]);
  const cycleSupplierLookup = useMemo(() => makeRefLookup(supplierRefs, 'Supplier'), [supplierRefs]);

  const { workingSet, setWorkingSet } = useListWorkingSet('procurement', { sessionView: readProcurementView() });
  const updateQuery = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const next = params.toString();
    navigate(`${location.pathname}${next ? `?${next}` : ''}`, { replace: true, state: location.state });
  }, [location.pathname, location.search, location.state, navigate]);
  const [search, setSearch] = useUrlSearchInput(workingSet.q, (q) => updateQuery({ q: q || null }));
  const { openRecord } = useListReturn({ list: 'procurement', contentReady: !isPending && !isError });
  const [showCycleImport, setShowCycleImport] = useState(false);

  const all = useMemo(() => {
    const rows = data ?? [];
    if (isEngineer) return userId ? rows.filter((row) => row.requested_by_id === userId) : [];
    // A PM sees projects they manage plus every request they raised themselves (incl. overhead).
    if (isProjectManager) return userId ? rows.filter((row) => row.requested_by_id === userId || row.project?.project_manager_id === userId) : [];
    return rows;
  }, [data, isEngineer, isProjectManager, userId]);

  const needsYouRows = useMemo(() => all.flatMap((row) => {
    const result = needsYou(row, { role: realRole, userId });
    return result ? [{ row, result }] : [];
  }).sort((a, b) => a.result.since.getTime() - b.result.since.getTime()), [all, realRole, userId]);
  const needsById = useMemo(() => new Map(needsYouRows.map((item) => [item.row.id, item])), [needsYouRows]);
  const needsYouReasons = useMemo(() => new Map(needsYouRows.map(({ row, result }) => [
    row.id,
    { result: result.reason, text: reasonCopy(result, t) },
  ])), [needsYouRows, t]);

  const tab = tabFromSearch(location.search, needsYouRows.length, canSeeOrphans);
  const selectedStage = stageFromSearch(location.search);
  const currentView = routeViewFromSearch(location.search, workingSet.view);
  const selectedStageLabel = selectedStage === null ? null : (() => {
    switch (selectedStage) {
      case 'request': return t('stage.request', 'Request');
      case 'order': return t('stage.order', 'Order');
      case 'receive': return t('stage.receive', 'Receive');
      case 'pay': return t('stage.pay', 'Pay');
    }
  })();
  const searchParams = new URLSearchParams(location.search);
  const projectId = searchParams.get('project') ?? '';
  const supplierId = searchParams.get('supplier') ?? '';
  const raisedById = searchParams.get('raisedBy') ?? '';
  const scopedIds = useMemo(() => new Set(all.map((row) => row.id)), [all]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const rowFilter = useCallback((row: ProcurementWithRefs) => {
    return scopedIds.has(row.id)
      && (tab !== 'needs-you' || needsById.has(row.id))
      && matchesWorkingSetStatus(row.status, workingSet)
      && (!normalizedSearch
        || row.title.toLocaleLowerCase().includes(normalizedSearch)
        || (row.code ?? '').toLocaleLowerCase().includes(normalizedSearch)
        || externalRefsOf(row).some((reference) => reference.toLocaleLowerCase().includes(normalizedSearch)))
      && (!projectId || row.project_id === projectId)
      && (!supplierId || row.vendor_id === supplierId)
      && (!raisedById || row.requested_by_id === raisedById)
      && matchesStage(row, selectedStage);
  }, [needsById, normalizedSearch, projectId, raisedById, scopedIds, selectedStage, supplierId, tab, workingSet]);
  const needsYouOrder = useCallback((a: ProcurementWithRefs, b: ProcurementWithRefs) =>
    (needsById.get(a.id)?.result.since.getTime() ?? 0) - (needsById.get(b.id)?.result.since.getTime() ?? 0),
  [needsById]);

  const setTab = (next: ProcurementTab) => updateQuery({ tab: next });
  const onViewChange = (next: ProcurementRouteView) => {
    if (next === 'grouped') {
      updateQuery({ view: next });
      return;
    }
    writeProcurementView(next);
    setWorkingSet((current) => ({ ...current, view: next }));
  };

  const tabRows = tab === 'needs-you' ? needsYouRows.map(({ row }) => row) : all;
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return tabRows
      .filter((row) => matchesWorkingSetStatus(row.status, workingSet))
      .filter((row) => !query
        || row.title.toLocaleLowerCase().includes(query)
        || (row.code ?? '').toLocaleLowerCase().includes(query)
        || externalRefsOf(row).some((reference) => reference.toLocaleLowerCase().includes(query)))
      .filter((row) => !projectId || row.project_id === projectId)
      .filter((row) => !supplierId || row.vendor_id === supplierId)
      .filter((row) => !raisedById || row.requested_by_id === raisedById)
      .filter((row) => matchesStage(row, selectedStage))
      .sort((a, b) => tab === 'needs-you'
        ? (needsById.get(a.id)?.result.since.getTime() ?? 0) - (needsById.get(b.id)?.result.since.getTime() ?? 0)
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [needsById, projectId, raisedById, search, selectedStage, supplierId, tab, tabRows, workingSet]);

  const onOpen = (row: ProcurementWithRefs) => {
    trackProcurementDetailOpened('/procurement/:procurementId', 'card');
    openRecord(`/procurement/${row.id}`);
  };

  const columns: Column<ProcurementWithRefs>[] = [
    {
      key: 'request',
      header: t('column.procurement', 'Procurement'),
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate font-semibold" title={row.title}>{row.title}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{row.code ?? row.id.slice(0, 8)}</div>
        </div>
      ),
      exportValue: (row) => row.title,
    },
    {
      key: 'project',
      header: t('column.project', 'Project'),
      cell: (row) => <ProjectNameLink projectId={row.project_id} name={row.project ? projectDisplayName(row.project) : undefined} legalName={row.project?.name} className="text-muted-foreground" />,
      exportValue: (row) => row.project?.name ?? '',
    },
    {
      key: 'requester',
      header: t('column.raisedBy', 'Raised by'),
      cell: (row) => (
        <span className="flex items-center gap-2">
          <span aria-hidden className="grid size-[22px] shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground">
            {(row.requested_by?.full_name ?? '?').trim().charAt(0).toUpperCase() || '?'}
          </span>
          <span className="truncate">{row.requested_by?.full_name ?? t('unknownRequester', 'Unknown')}</span>
        </span>
      ),
      exportValue: (row) => row.requested_by?.full_name ?? '',
    },
    {
      key: 'value',
      header: t('column.value', 'Value'),
      align: 'num',
      cell: (row) => formatCurrency(row.total_value, row.currency),
      exportValue: (row) => row.total_value,
    },
    {
      key: 'lifecycle',
      header: t('column.lifecycle', 'Lifecycle'),
      cell: (row) => <LifecycleStepper variant="inline" steps={lifecycleSteps(row.status as ProcurementStatus)} aria-label={`${t('column.lifecycle', 'Lifecycle')}: ${statusLabel(row.status as ProcurementStatus)}`} />,
      exportValue: (row) => statusLabel(row.status as ProcurementStatus),
    },
    {
      key: 'status',
      header: t('column.status', 'Status'),
      cell: (row) => <StatusPill variant={pillVariantForStatus(row.status as ProcurementStatus)}>{statusLabel(row.status as ProcurementStatus)}</StatusPill>,
      exportValue: (row) => statusLabel(row.status as ProcurementStatus),
    },
  ];
  const exportColumns: Column<ProcurementWithRefs>[] = [
    ...withCurrencyColumn(columns, 'value', (row) => row.currency),
    { key: 'external-refs', header: t('column.externalReferences', 'External references'), cell: (row) => externalRefsOf(row).join(', '), exportValue: (row) => externalRefsOf(row).join(', ') },
  ];

  const projectFilters = distinctOptions(all.map((row) => ({ value: row.project_id, label: row.project ? projectDisplayName(row.project) : null })));
  const supplierFilters = distinctOptions(all.map((row) => ({ value: row.vendor_id, label: row.vendor?.name })));
  const raisedByFilters = distinctOptions(all.map((row) => ({ value: row.requested_by_id, label: row.requested_by?.full_name })));
  const statusOptions: Array<{ value: string; label: string }> = STATUS_FILTERS
    .filter((filter) => filter !== 'Needs approval' || canApprove)
    .map((filter) => ({
      value: filter === 'Ordered' ? 'group:Ordered' : filter,
      label: t(`statusFilter.${filter === 'Vendor Invoiced' ? 'supplierInvoiced' : filter === 'Needs approval' ? 'needsApproval' : filter.toLowerCase()}`, filter === 'Vendor Invoiced' ? 'Supplier invoiced' : filter),
    }));
  const statusValue = workingSet.statusMode === 'exact'
    ? `exact:${workingSet.status}`
    : workingSet.status === 'Ordered' ? 'group:Ordered' : workingSet.status;
  if (workingSet.statusMode === 'exact' && !statusOptions.some(({ value }) => value === statusValue)) {
    statusOptions.push({ value: statusValue, label: statusLabel(workingSet.status as ProcurementStatus) });
  }
  const clearFilters = () => {
    setSearch('');
    const params = new URLSearchParams(location.search);
    for (const key of ['q', 'status', 'project', 'supplier', 'raisedBy', 'stage']) params.delete(key);
    const next = params.toString();
    navigate(`${location.pathname}${next ? `?${next}` : ''}`, { replace: true, state: location.state });
  };
  const changeStatusFilter = (value: string) => {
    const status = value.startsWith('exact:') ? value.slice('exact:'.length) : value;
    updateQuery({ status: status === 'All' ? null : status });
    trackFilterApplied('status', statusOptions.length, 'procurement');
  };

  const filterControls = (withRaisedBy = true) => (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="procurement-project-filter">{t('filter.project', 'Project')}</label>
      <select id="procurement-project-filter" aria-label={t('filter.project', 'Project')} value={projectId} onChange={(event) => updateQuery({ project: event.target.value || null })} className="h-8 max-w-48 rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <option value="">{t('filter.project', 'Project')}</option>
        {projectFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <label className="sr-only" htmlFor="procurement-supplier-filter">{t('filter.supplier', 'Supplier')}</label>
      <select id="procurement-supplier-filter" aria-label={t('filter.supplier', 'Supplier')} value={supplierId} onChange={(event) => updateQuery({ supplier: event.target.value || null })} className="h-8 max-w-48 rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <option value="">{t('filter.supplier', 'Supplier')}</option>
        {supplierFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {withRaisedBy && <>
      <label className="sr-only" htmlFor="procurement-raised-by-filter">{t('filter.raisedBy', 'Raised by')}</label>
      <select id="procurement-raised-by-filter" aria-label={t('filter.raisedBy', 'Raised by')} value={raisedById} onChange={(event) => updateQuery({ raisedBy: event.target.value || null })} className="h-8 max-w-48 rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <option value="">{t('filter.raisedBy', 'Raised by')}</option>
        {raisedByFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      </>}
      <label className="sr-only" htmlFor="procurement-status-filter">{t('filter.status', 'Status')}</label>
      <select id="procurement-status-filter" aria-label={t('filter.status', 'Status')} value={statusValue} onChange={(event) => changeStatusFilter(event.target.value)} className="h-8 max-w-48 rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );

  const orphanQuery = useErpOrphans(undefined, { enabled: canViewOrphans });
  const projectQueryForOrphans = useProjects({ enabled: canViewOrphans && tab === 'orphans' });
  const projectNames = useMemo(() => new Map((projectQueryForOrphans.data ?? []).map((project) => [project.id, project.name])), [projectQueryForOrphans.data]);
  const orphanRows = orphanQuery.data ?? [];
  const reasonText = tab === 'needs-you'
    ? new Map([...needsYouReasons].map(([id, value]) => [id, value.text]))
    : new Map<string, string>();

  const title = isEngineer ? t('title.engineer', 'Your procurements') : t('title.default', 'Procurement');
  const description = isEngineer
    ? t('description.engineer', 'Track the procurements you raised, from request through payment.')
    : isProjectManager
      ? t('description.projectManager', 'Procurements for projects you manage, from request through payment.')
      : t('description.default', 'Procurements across your organization, from request through payment.');
  const primaryAction = (
    <div className="flex shrink-0 items-center gap-2">
      <MobileToolbarDisclosure
        label={t('more', 'More')}
        className="relative shrink-0"
        panelClassName="absolute right-0 top-full z-30 mt-1 flex w-auto min-w-48 flex-col gap-1 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md"
      >
        <ExportButton rows={filtered} columns={exportColumns} entity="Procurement" label={t('moreTools.exportList', 'Export list')} className="w-full justify-start" />
        {userId && <ImportButton entity="procurement" descriptor={importDescriptor} onImported={() => void refetch()} label={t('moreTools.importProcurements', 'Import procurements')} className="w-full justify-start" />}
        {userId && canCreate && <Button variant="outline" onClick={() => setShowCycleImport(true)} className="w-full justify-start"><Icon name="upload" />{t('moreTools.importCycle', 'Import cycle data')}</Button>}
      </MobileToolbarDisclosure>
      {canCreate && <span className="hidden sm:block"><Button variant="primary" onClick={() => navigate('/procurement/new')}><Icon name="plus" />{t('newProcurement', 'New procurement')}</Button></span>}
    </div>
  );

  const ready = !isPending && !isError && data !== undefined;
  useEffect(() => {
    if (ready && all.length === 0 && realRole) {
      trackEmptyStateSeen('procurement-empty', realRole, 'procurement');
    }
  }, [all.length, ready, realRole]);
  const routeViewOptions: Array<{ value: ProcurementRouteView; label: string; icon: 'table' | 'cols' | 'grid' }> = [
    { value: 'table', label: t('view.table', 'Table'), icon: 'table' },
    { value: 'grouped', label: t('view.grouped', 'Grouped'), icon: 'grid' },
    { value: 'board', label: t('view.board', 'Board'), icon: 'cols' },
  ];
  const currentNeedsReasons = tab === 'needs-you' ? needsYouReasons : new Map<string, { result: NeedsYouResult['reason']; text: string }>();
  const tabs: Array<{ key: ProcurementTab; label: string; count: number }> = [
    { key: 'needs-you', label: t('tab.needsYou', 'Needs you'), count: needsYouRows.length },
    { key: 'all', label: t('tab.all', 'All'), count: all.length },
    ...(canSeeOrphans ? [{ key: 'orphans' as const, label: t('tab.orphans', 'Not in a procurement'), count: orphanRows.length }] : []),
  ];

  return (
    // L6: the All tab carries the total, so the title has no second count.
    <ListPage title={title} description={description} primaryAction={primaryAction}>
      <div className="space-y-4 pb-20 sm:pb-0">
        <div role="tablist" aria-label={t('tabs.label', 'Procurement lists')} className="flex min-w-0 gap-5 overflow-x-auto border-b border-border scroll-fade-x">
          {tabs.map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls="procurement-tab-panel"
              tabIndex={tab === key ? 0 : -1}
              onClick={() => setTab(key)}
              className={`touch-target shrink-0 border-b-2 px-0.5 py-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              {label}<span className="ml-1.5 tabular text-muted-foreground">{count}</span>
            </button>
          ))}
        </div>

        {ready && (
          <ProcurementKpiRow
            rows={all}
            needsYouRows={needsYouRows}
            orphans={canViewOrphans ? orphanRows : undefined}
            tab={tab}
            role={realRole as ProcurementListRole}
            onSelectTab={setTab}
          />
        )}

        {tab !== 'orphans' && ready && currentView === 'table' && (
          <div className="flex justify-end">
            <ViewToggle<ProcurementRouteView> options={routeViewOptions} value={currentView} onChange={onViewChange} ariaLabel={t('view.label', 'Procurement view')} />
          </div>
        )}

        {tab !== 'orphans' && ready && currentView !== 'table' && (
          <div className="space-y-3" data-testid="list-page-toolbar">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SearchMini
                placeholder={t('search.placeholder', 'Search title, number or reference…')}
                aria-label={t('search.label', 'Search procurements')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                searchSurface="procurement-list"
                module="procurement"
                resultCount={filtered.length}
                containerClassName="min-w-[220px] flex-1 max-sm:basis-full max-sm:w-full max-sm:min-w-0"
              />
              <div className="hidden min-w-0 flex-wrap items-center gap-2 md:flex">{filterControls()}</div>
              <MobileToolbarDisclosure
                label={t('filter.filters', 'Filters')}
                count={[projectId, supplierId, raisedById, statusValue !== 'All' ? statusValue : '', selectedStage ?? ''].filter(Boolean).length || undefined}
                className="relative md:hidden"
                panelClassName="absolute left-0 top-full z-30 mt-1 flex w-[min(330px,calc(100vw-2rem))] flex-col gap-2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
              >
                <div className="flex flex-col gap-2">{filterControls()}</div>
              </MobileToolbarDisclosure>
              <span aria-live="polite" className="ml-auto whitespace-nowrap text-[12px] text-muted-foreground">
                {t(filtered.length === 1 ? 'result.one' : 'result.many', { count: filtered.length, defaultValue: `${filtered.length} ${filtered.length === 1 ? 'result' : 'results'}` })}
              </span>
              <ViewToggle<ProcurementRouteView>
                options={routeViewOptions}
                value={currentView}
                onChange={onViewChange}
                ariaLabel={t('view.label', 'Procurement view')}
              />
            </div>
            {selectedStageLabel && <div className="flex items-center gap-2 text-[12px] text-muted-foreground">{t('stage.filterActive', { stage: selectedStageLabel, defaultValue: '{{stage}} stage' })}<Button variant="ghost" size="sm" onClick={() => updateQuery({ stage: null })}>{t('clear', 'Clear')}</Button></div>}
          </div>
        )}

        <div id="procurement-tab-panel" role="tabpanel" aria-label={tab === 'orphans' ? t('tab.orphans', 'Not in a procurement') : tab === 'needs-you' ? t('tab.needsYou', 'Needs you') : t('tab.all', 'All')}>
          {isPending && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={6} /></div>}

          {(isError || (!isPending && !data)) && (
            <ListState variant="error" title={t('error.title', "Couldn't load procurements")} sub={t('error.sub', 'Reload the list to try again.')} onRetry={() => void refetch()} />
          )}

          {ready && tab === 'orphans' && (
            orphanQuery.isPending ? <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={5} /></div>
              : orphanQuery.isError ? <ListState variant="error" title={t('orphans.error', "Couldn't load documents not in a procurement")} onRetry={() => void orphanQuery.refetch()} />
                : orphanRows.length === 0 ? <ListState variant="empty" icon="table" title={t('orphans.empty.title', 'Every accounting-system document is in a procurement')} sub={t('orphans.empty.sub', 'New documents appear here after the next sync.')} />
                  : <Card className="overflow-hidden"><ErpOrphansSection rows={orphanRows} canLink={may('create', 'erpPurchaseLink')} projectNames={projectNames} /></Card>
          )}

          {ready && tab !== 'orphans' && all.length === 0 && (
            <ListState
              variant="empty"
              icon="cart"
              title={isEngineer ? t('empty.engineer.title', "You haven't raised any procurements yet") : t('empty.title', 'No procurements yet')}
              sub={t('empty.sub', 'New procurements will appear here as they are raised.')}
              action={canCreate ? { label: t('newProcurement', 'New procurement'), onClick: () => navigate('/procurement/new') } : undefined}
            />
          )}

          {ready && tab === 'needs-you' && all.length > 0 && tabRows.length === 0 && (
            <ListState variant="empty" icon="check" title={t('needsYou.empty.title', 'Nothing needs your attention')} sub={t('needsYou.empty.sub', 'You are up to date on the procurements in your scope.')} action={{ label: t('tab.all', 'All procurements'), onClick: () => setTab('all') }} />
          )}

          {ready && tab !== 'orphans' && currentView !== 'table' && all.length > 0 && tabRows.length > 0 && filtered.length === 0 && (
            <ListState variant="empty" title={t('noMatch.title', 'No procurements match these filters')} sub={t('noMatch.sub', 'Clear a filter or change the search to see more procurements.')} action={{ label: t('noMatch.clear', 'Clear filters'), onClick: clearFilters }} />
          )}

          {ready && tab !== 'orphans' && filtered.length > 0 && currentView === 'board' && (
            <ProcurementBoard procurements={filtered} onOpen={onOpen} viewerRole={realRole as ProcurementListRole} needsYouReasons={currentNeedsReasons} />
          )}

          {ready && tab !== 'orphans' && filtered.length > 0 && currentView === 'grouped' && (
            <ProcurementGroupedView rows={filtered} role={realRole as ProcurementListRole} reasonText={reasonText} />
          )}

          {ready && tab !== 'orphans' && tabRows.length > 0 && currentView === 'table' && (
            <ProcurementBlock rowFilter={rowFilter} rowOrder={tab === 'needs-you' ? needsYouOrder : undefined} showCreate={false} toolbarExtra={filterControls(Boolean(raisedById))} onClearFilters={clearFilters} />
          )}
        </div>

        {showCycleImport && userId && (
          <ProcurementCycleImportWizard
            requestedById={userId}
            projectLookup={cycleProjectLookup}
            vendorLookup={cycleSupplierLookup}
            onClose={(didImport) => {
              setShowCycleImport(false);
              if (didImport) void refetch();
            }}
          />
        )}
      </div>
      {canCreate && <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 p-3 shadow-sm sm:hidden"><Button variant="primary" className="w-full" onClick={() => navigate('/procurement/new')}><Icon name="plus" />{t('newProcurement', 'New procurement')}</Button></div>}
    </ListPage>
  );
};

export default ProcurementPage;
