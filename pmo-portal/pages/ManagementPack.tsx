import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  Button, DataTable, Icon, ListPage, ListState, MenuButton, ProgressBar, StatusPill, TextField, Toolbar, type Column,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useManagementPack } from '@/src/hooks/useManagementPack';
import { useProjectsDelivery } from '@/src/hooks/useProjectsDelivery';
import { useProjects } from '@/src/hooks/useProjects';
import { useRevenuePerProject } from '@/src/hooks/useRevenue';
import { useExport } from '@/src/components/export/useExport';
import { RecordProgressModal } from '@/src/components/reports/RecordProgressModal';
import { BoardPackAction } from '@/src/components/reports/BoardPackAction';
import { fromCents, type PackMonth, type PackRow, type PackTotalsMonth } from '@/src/lib/reports/managementPack';
import {
  buildManagementPackExport, managementPackFileStem, type ManagementPackExportLabels,
} from '@/src/lib/reports/managementPackExport';
import { monthInputToIso } from '@/src/lib/reports/months';
import { formatCurrency, formatUtcMonthYear } from '@/src/lib/format';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { moneyFigure } from '@/src/lib/dashboardMoney';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { PROGRESS_RECORDABLE_PROJECT_STATUSES } from '@/src/lib/dashboardConstants';

type Measure = 'recognisedToDate' | 'invoicedToDate' | 'unbilled' | 'backlog';
type TotalsMeasure = 'planned' | 'recognised' | 'invoiced' | 'unbilled' | 'backlog';
type TotalsRow = PackTotalsMonth & { currency: string };

const TOTALS_MEASURES: TotalsMeasure[] = ['planned', 'recognised', 'invoiced', 'unbilled', 'backlog'];
const monthLabel = (iso: string) => formatUtcMonthYear(new Date(`${iso}T00:00:00Z`));
const money = (cents: number | null, currency: string) =>
  cents === null ? '—' : formatCurrency(fromCents(cents), currency);

const shortMonth = (iso: string) => monthLabel(iso).split(/\s+/)[0] ?? monthLabel(iso);

const ManagementPack: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const label: Record<Measure | TotalsMeasure, string> = {
    planned: t('managementPack.col.planned', 'Planned'),
    recognised: t('managementPack.col.recognised', 'Recognised'),
    invoiced: t('managementPack.col.invoiced', 'Invoiced'),
    unbilled: t('managementPack.col.unbilled', 'Unbilled'),
    recognisedToDate: t('managementPack.col.recognisedToDate', 'Recognised to date'),
    invoicedToDate: t('managementPack.col.invoicedToDate', 'Invoiced to date'),
    backlog: t('managementPack.col.backlog', 'Backlog'),
  };
  const range = { from: monthInputToIso(params.get('from') ?? ''), to: monthInputToIso(params.get('to') ?? '') };
  const { data: pack, isPending, isError, error, refetch } = useManagementPack(range);
  const currencyState = useOrgCurrencyState();
  const orgCurrency = currencyState.isResolved ? currencyState.currency : null;
  const { exportTable, busy } = useExport();
  const [progressFor, setProgressFor] = useState<PackRow | null>(null);
  const [monthlyTotalsExpanded, setMonthlyTotalsExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const projectIds = useMemo(
    () => (pack?.rows ?? []).filter((r) => r.kind === 'contract' && r.projectId).map((r) => r.projectId as string),
    [pack],
  );
  const { data: delivery } = useProjectsDelivery(projectIds);
  const { data: projects } = useProjects({ enabled: !!pack });
  const { data: revenueRows, isPending: invoiceCountsPending } = useRevenuePerProject();
  const projectById = useMemo(() => new Map((projects ?? []).map((project) => [project.id, project])), [projects]);
  const invoiceCounts = useMemo(() => new Map((revenueRows ?? []).map((row) => [`${row.project_id ?? ''}|${row.currency}`, row.invoice_count])), [revenueRows]);
  if (!may('view', 'finance')) {
    return (
      <div className="flex h-[calc(100vh-var(--header-h))] items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-heading font-semibold">
            {t('managementPack.noAccessTitle', "You don't have access to Reports")}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {t('managementPack.noAccessSub', 'Finance reports are available to Finance, Executive and Admin roles.')}
          </p>
          <Button variant="outline" onClick={() => navigate('/')} className="mt-4">
            <Icon name="back" className="size-4 mr-2" />
            {t('financeCopy.backToDashboard', 'Back to dashboard')}
          </Button>
        </div>
      </div>
    );
  }

  const last = pack ? pack.months.length - 1 : -1;
  const at = (row: PackRow): PackMonth | null => (last >= 0 ? row.months[last] : null);
  const state: 'loading' | 'error' | 'empty' | undefined = isError
    ? 'error'
    : isPending
      ? 'loading'
      : pack && pack.rows.length === 0
        ? 'empty'
        : undefined;
  const invalidRange = (error as { code?: string } | null)?.code === '22023';
  const backlogReason = t('uxs34.backlogReason', 'A foreign-currency invoice needs reconciliation before this balance can be known.');
  const backlogUnavailable = t('uxs34.backlogUnavailable', 'The foreign-currency invoice backlog needs reconciliation before this balance can be known.');
  const backlogNeedsReview = pack?.totals.some((total) => total.months.some((month) => month.backlog === null)) ?? false;

  const setMonth = (key: 'from' | 'to', value: string) => {
    const next = new URLSearchParams(params);
    if (monthInputToIso(value)) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const exportLabels: ManagementPackExportLabels = {
    month: t('managementPack.col.month', 'Month'),
    projectNumber: t('managementPack.col.projectNumber', 'Project number'),
    project: t('managementPack.col.project', 'Project'),
    client: t('managementPack.col.client', 'Client'),
    currency: t('managementPack.col.currency', 'Currency'),
    taxBasis: t('managementPack.col.taxBasis', 'Tax basis'),
    planned: label.planned,
    recognised: label.recognised,
    invoiced: label.invoiced,
    recognisedToDate: label.recognisedToDate,
    invoicedToDate: label.invoicedToDate,
    unbilled: label.unbilled,
    backlog: label.backlog,
    basis: t('managementPack.col.basis', 'Basis'),
    taxBasisValue: t('tax.basis.exclusive', 'excl. PPN'),
    unassigned: t('managementPack.unassigned', 'Unassigned'),
    total: t('managementPack.total', 'Total'),
    basisInvoiced: t('managementPack.basis.invoiced', 'Invoiced'),
    basisProgress: t('managementPack.basis.progressShort', 'Progress'),
  };
  // One Export (long-format CSV, one row per project × month with its currency and tax basis).
  const onExport = () => {
    if (pack) void exportTable(buildManagementPackExport(pack, exportLabels), managementPackFileStem(pack), 'csv');
  };
  const onExportRow = (row: PackRow) => {
    if (!pack) return;
    void exportTable(buildManagementPackExport({ ...pack, rows: [row], totals: [] }, exportLabels),
      `${managementPackFileStem(pack)}_${row.projectNumber ?? row.projectName ?? 'row'}`, 'csv');
  };

  const canRecord = (row: PackRow) =>
    // R-004: the project's PM records progress too; may('edit','projectProgress') carries that rule.
    row.kind === 'contract' &&
    PROGRESS_RECORDABLE_PROJECT_STATUSES.has(row.projectStatus ?? '') &&
    !!row.projectId &&
    may('edit', 'projectProgress', { currentUserId: currentUser?.id ?? null, record: { project_manager_id: row.projectManagerId } });

  // C4 + Unknowable-Is-Not-Zero: an unknown backlog is an explained dash (reason on hover and for screen
  // readers), never the word "Unavailable" as a value; the page states the reason once with its fix link.
  const backlogUnknown = <span title={backlogReason}>—<span className="sr-only"> {backlogReason}</span></span>;

  const measureCell = (key: Measure) => (row: PackRow) => {
    const m = at(row);
    const value = m ? m[key] : null;
    return (
      <span data-testid={`pack-cell-${key}`} className="tabular text-right text-[13px]">
        {key === 'backlog' && row.kind === 'contract' && value === null ? backlogUnknown : money(value, row.currency)}
        {key === 'unbilled' && value !== null && value < 0 && (
          <span className="ml-1 text-xs text-muted-foreground">{t('managementPack.billedAhead', 'billed ahead')}</span>
        )}
      </span>
    );
  };


  const filteredRows = (pack?.rows ?? []).filter((row) => {
    const project = row.projectId ? projectById.get(row.projectId) : undefined;
    const pmName = project?.pm?.full_name ?? '';
    const haystack = [row.projectName, row.projectNumber, row.clientName, pmName, row.currency].filter(Boolean).join(' ').toLocaleLowerCase();
    return haystack.includes(search.trim().toLocaleLowerCase());
  });
  const latestMonth = (row: PackRow) => row.months[row.months.length - 1] ?? null;
  const invoiceCountFor = (row: PackRow) => invoiceCounts.get(`${row.projectId ?? ''}|${row.currency}`) ?? 0;
  const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  // O11: when no contract row has recorded progress the whole column would read "Invoiced basis";
  // the page says it once instead and the column is left out.
  const anyProgress = (pack?.rows ?? []).some((row) => row.kind === 'contract' && row.latestProgress != null);
  const columns: Column<PackRow>[] = [
    {
      key: 'project',
      header: t('managementPack.col.project', 'Project'),
      kind: 'primary',
      size: 200,
      primaryTitle: (row) => row.kind === 'unassigned' ? t('managementPack.unassigned', 'Unassigned') : row.projectName ?? '',
      cell: (row) =>
        row.kind === 'unassigned' ? (
          <StatusPill variant="neutral">{t('managementPack.unassigned', 'Unassigned')}</StatusPill>
        ) : (
          <span className="flex items-center gap-2">
            {row.projectManagerId && <span role="img" aria-label={projectById.get(row.projectId ?? '')?.pm?.full_name ?? t('financeHub:managementPack.projectManager', 'Project manager')} title={projectById.get(row.projectId ?? '')?.pm?.full_name ?? undefined} className="grid size-[20px] shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-secondary-foreground">{initials(projectById.get(row.projectId ?? '')?.pm?.full_name ?? t('financeHub:managementPack.projectManager', 'Project manager'))}</span>}
            <span>{row.projectName}</span>
          </span>
        ),
      secondaryCell: (row) =>
        row.kind === 'unassigned'
          ? undefined
          : row.kind === 'otherCurrency'
            ? t('managementPack.otherCurrency', 'Invoiced in {{currency}}, not the contract currency', { currency: row.currency })
            : <span className="flex flex-col text-xs text-muted-foreground">
                {row.projectNumber && <span>{row.projectNumber}</span>}
                {row.clientName && <span>{row.clientName}</span>}
              </span>,
    },
    ...(!anyProgress ? [] : [{
      key: 'progress',
      header: t('financeHub:managementPack.col.progress', 'Progress'),
      kind: 'percent',
      size: 120,
      cell: (row) => {
        if (row.kind !== 'contract') return <span className="text-muted-foreground">—</span>;
        const latest = row.latestProgress;
        const missingLatest = latest?.month !== pack?.to;
        return (
          <span className="flex min-w-0 flex-col gap-1">
            {latest ? <ProgressBar value={latest.pctComplete} tone={latest.pctComplete <= 90 ? 'primary' : latest.pctComplete <= 100 ? 'warning' : 'destructive'} compact aria-label={t('financeHub:managementPack.progressValue', 'Progress {{percent}}%', { percent: latest.pctComplete })} /> : <span className="text-xs text-muted-foreground">{t('financeHub:hub.fix.reports.invoicedBasis', 'Invoiced basis')}</span>}
            {latest && <span className="whitespace-nowrap text-xs text-muted-foreground">{Math.round(latest.pctComplete)}% · {shortMonth(latest.month)}</span>}
            {latest && missingLatest && pack?.to && <StatusPill variant="warn">{t('financeHub:hub.fix.reports.noProgressForMonth', { defaultValue: 'No entry for {{month}}', month: shortMonth(pack.to) })}</StatusPill>}
          </span>
        );
      },
    } satisfies Column<PackRow>]),
    {
      key: 'contract',
      header: t('managementPack.col.contract', 'Contract'),
      kind: 'money',
      align: 'num',
      // N2: wide enough for a full IDR figure so neighbouring totals never touch.
      size: 135,
      cell: (row) => (
        <span data-testid="pack-cell-contract" className="tabular text-right text-[13px]">
          {money(row.contractNet, row.currency)}
        </span>
      ),
    },
    ...(['recognisedToDate', 'invoicedToDate', 'unbilled', 'backlog'] as Measure[]).map((k): Column<PackRow> => ({
      key: k,
      header: k === 'recognisedToDate' ? t('financeHub:managementPack.col.earned', 'Earned') : k === 'invoicedToDate' ? t('managementPack.col.invoiced', 'Invoiced') : label[k],
      kind: 'money', align: 'num', size: 135, cell: measureCell(k),
    })),
    {
      key: 'invoiceCount',
      header: t('financeHub:managementPack.col.invoices', 'Invoices'),
      kind: 'number',
      align: 'num',
      size: 70,
      cell: (row) => <span data-testid="pack-cell-invoices" className="tabular">{invoiceCountsPending ? '—' : invoiceCountFor(row)}</span>,
      exportValue: (row) => invoiceCountFor(row),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('managementPack.actions', 'Actions')}</span>,
      kind: 'actions',
      size: 52,
      cell: (row) => <MenuButton ariaLabel={t('financeHub:managementPack.actionsForProject', 'Actions for {{project}}', { project: row.projectName ?? t('managementPack.unassigned', 'Unassigned') })} items={[
        ...(row.projectId ? [{ label: t('financeHub:managementPack.openProject', 'Open project'), onClick: () => navigate(`/projects/${row.projectId}`) }] : []),
        { label: t('financeHub:managementPack.viewInvoices', 'View invoices'), onClick: () => navigate(row.projectId ? `/finance/receivables?project=${encodeURIComponent(row.projectId)}` : '/finance/receivables?attribution=unassigned') },
        ...(canRecord(row) ? [{ label: t('managementPack.recordProgress', 'Record progress'), onClick: () => setProgressFor(row) }] : []),
        { label: t('financeHub:managementPack.exportRow', 'Export row'), onClick: () => onExportRow(row) },
      ]} />,
    },
  ];

  // T10: one total row per currency (never summed across currencies) — cumulative figures at the as-at
  // month from the pack's own per-currency totals; the contract total adds only rows that carry a contract.
  const projectTotals = [...new Set(filteredRows.map((row) => row.currency))].map((currency) => {
    const rows = filteredRows.filter((r) => r.currency === currency);
    const contracts = rows.filter((r) => r.contractNet !== null);
    const ms = rows.map(latestMonth).filter((m): m is PackMonth => !!m);
    const contractTotal = contracts.reduce((sum, r) => sum + (r.contractNet ?? 0), 0);
    const sum = (key: 'recognisedToDate' | 'invoicedToDate' | 'unbilled' | 'invoiceCountToDate') => ms.reduce((total, month) => total + month[key], 0);
    const backlogIsUnknown = contracts.some((row) => latestMonth(row)?.backlog === null);
    return {
      key: currency,
      label: `${t('managementPack.total', 'Total')} · ${currency}`,
      values: {
        contract: contracts.length > 0 ? money(contractTotal, currency) : null,
        recognisedToDate: money(sum('recognisedToDate'), currency),
        invoicedToDate: money(sum('invoicedToDate'), currency),
        unbilled: money(sum('unbilled'), currency),
        backlog: backlogIsUnknown ? backlogUnknown : money(contracts.reduce((total, row) => total + (latestMonth(row)?.backlog ?? 0), 0), currency),
        invoiceCount: invoiceCountsPending ? '—' : filteredRows.reduce((total, row) => total + invoiceCountFor(row), 0),
        // An unknown row makes the currency total unknown too: left out, explained by the note below the table.
      } as Record<string, React.ReactNode>,
    };
  });

  const totalsRows: TotalsRow[] = (pack?.totals ?? []).flatMap((tot) =>
    tot.months.map((m) => ({ ...m, currency: tot.currency })),
  );
  const totalsColumns: Column<TotalsRow>[] = [
    { key: 'month', header: t('managementPack.col.month', 'Month'), kind: 'date', size: 120, cell: (r) => monthLabel(r.month) },
    {
      key: 'currency',
      header: t('managementPack.col.currency', 'Currency'),
      kind: 'text',
      size: 100,
      cell: (r) => r.currency,
    },
    ...TOTALS_MEASURES.map((k): Column<TotalsRow> => ({
      key: k,
      header: label[k],
      kind: 'money',
      align: 'num',
      size: 140,
      cell: (r) => (
        <span className="tabular text-right text-[13px]">
          {k === 'backlog' && r.backlog === null ? backlogUnknown : money(r[k], r.currency)}
        </span>
      ),
    })),
  ];
  const sortedTotals = [...(pack?.totals ?? [])].sort((left, right) => left.currency === orgCurrency ? -1 : right.currency === orgCurrency ? 1 : left.currency.localeCompare(right.currency));
  const latestTotals = sortedTotals.flatMap((tot) => {
    const month = tot.months[tot.months.length - 1];
    return month ? [{ currency: tot.currency, month }] : [];
  });
  /** Whole-unit short figure for a cents amount (F11: tiles short, exact as metadata; C5: no fraction). */
  const shortFigure = (cents: number, currency: string) => moneyFigure(Math.round(fromCents(cents)), currency, '', { code: currency !== orgCurrency });
  const figureSpecs: Array<{
    key: string;
    label: string;
    help: string;
    amount: (month: PackTotalsMonth) => number | null;
    subline?: (month: PackTotalsMonth, currency: string) => string;
  }> = [
    {
      key: 'earnedNotInvoiced',
      label: t('financeHub:managementPack.figures.earnedNotInvoiced', 'Earned, not yet invoiced'),
      help: t('financeHub:managementPack.figures.earnedNotInvoicedHelp', 'Earned to date minus invoiced to date, using the report’s revenue recognition basis.'),
      amount: (month) => month.unbilled,
    },
    {
      key: 'earnedToDate',
      label: t('financeHub:managementPack.figures.earnedToDate', 'Earned to date'),
      help: t('financeHub:managementPack.figures.earnedToDateHelp', 'Cumulative recognized revenue through the as-at month; the subline shows this month’s change.'),
      amount: (month) => month.recognisedToDate,
      subline: (month, currency) => t('financeHub:managementPack.figures.thisMonthDelta', 'This month {{amount}}', { amount: shortFigure(month.recognised, currency).value }),
    },
    {
      key: 'invoicedToDate',
      label: t('financeHub:managementPack.figures.invoicedToDate', 'Invoiced to date'),
      help: t('financeHub:managementPack.figures.invoicedToDateHelp', 'Cumulative dated invoice value and invoice count through the as-at month.'),
      amount: (month) => month.invoicedToDate,
      subline: (month) => t('financeHub:managementPack.figures.invoiceCount', '{{count}} invoices', { count: month.invoiceCountToDate }),
    },
    {
      key: 'backlog',
      label: t('financeHub:managementPack.figures.backlog', 'Backlog of contract total'),
      help: t('financeHub:managementPack.figures.backlogHelp', 'Contract total minus revenue earned to date; unavailable if a foreign-currency invoice needs reconciliation.'),
      amount: (month) => month.backlog,
    },
  ];
  /** One figure per tile: each currency short, joined (never summed); an unknown currency is left out and explained once below. */
  const tileFigure = (spec: (typeof figureSpecs)[number]) => {
    const known = latestTotals.flatMap(({ currency, month }) => {
      const cents = spec.amount(month);
      return cents === null ? [] : [shortFigure(cents, currency)];
    });
    if (known.length === 0) return { value: null, unavailableReason: backlogReason };
    const value = known.map((figure) => figure.value).join(' · ');
    const exactValue = known.map((figure) => figure.exactValue ?? figure.value).join(' · ');
    return { value, exactValue: exactValue === value ? undefined : exactValue };
  };
  const lead = latestTotals[0];
  const backlogUnknownSomewhere = latestTotals.some(({ month }) => month.backlog === null)
    || filteredRows.some((row) => row.kind === 'contract' && latestMonth(row)?.backlog === null);
  const showFigures = Boolean(pack) && !isError && latestTotals.length > 0;

  return (
    <ListPage
      title={t('finance:area.reportTitle', 'Revenue by project and month')}
      headingLevel={embedded ? 2 : 1}
      description={embedded ? undefined : t('managementPack.description', 'Planned, recognised and invoiced revenue per project and month. All figures exclude tax.')}
      primaryAction={!embedded ? <BoardPackAction /> : undefined}
    >
      {isPending && !pack ? (
        <KPIRow aria-label={t('financeHub:managementPack.figures.title', 'Report figures')} className="mb-5 grid-cols-2 xl:grid-cols-4">
          {figureSpecs.map((spec) => <KPITile key={spec.key} loading tone="blue" icon="grid" label={spec.label} value="" />)}
        </KPIRow>
      ) : showFigures && (
        <KPIRow aria-label={t('financeHub:managementPack.figures.title', 'Report figures')} className="mb-5 grid-cols-2 xl:grid-cols-4">
          {figureSpecs.map((spec) => {
            const figure = tileFigure(spec);
            return (
              <KPITile
                key={spec.key}
                icon="grid"
                tone="blue"
                label={spec.label}
                help={spec.help}
                helpLabel={t('financeHub:managementPack.figures.calculationHelp', 'How this figure is calculated')}
                value={figure.value ?? '—'}
                exactValue={figure.exactValue}
                unavailableReason={figure.value === null ? figure.unavailableReason : undefined}
                vs={lead && spec.subline ? spec.subline(lead.month, lead.currency) : undefined}
              />
            );
          })}
        </KPIRow>
      )}

      <div data-testid="management-pack-table-card" className="min-w-0">
      <Toolbar data-testid="management-pack-table-toolbar" className="items-end gap-3">
        <TextField id="pack-from" type="month" label={t('managementPack.from', 'From')} value={params.get('from') ?? pack?.from.slice(0, 7) ?? ''} onChange={(v) => setMonth('from', v)} />
        <TextField id="pack-as-at" type="month" label={t('managementPack.asAt', 'As at')} value={params.get('to') ?? pack?.to.slice(0, 7) ?? ''} onChange={(v) => setMonth('to', v)} />
        <TextField id="pack-search" type="search" label={t('financeHub:managementPack.search', 'Search projects')} value={search} onChange={setSearch} />
        <Button variant="outline" disabled={!pack || busy} onClick={onExport} className="ml-auto"><Icon name="export" className="size-4 mr-2" />{t('finance:area.export', 'Export')}</Button>
      </Toolbar>
      {state === 'loading' && (
        <ListState variant="loading" rows={6} />
      )}
      {state === 'error' && (
        <ListState
          variant="error"
          title={t('managementPack.errorTitle', "Couldn't load Reports")}
          sub={invalidRange
            ? t('managementPack.invalidRange', 'Choose a start month on or before the as-at month, at most 24 months apart.')
            : t('managementPack.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={!invalidRange ? () => { void refetch(); } : undefined}
          retryLabel={t('managementPack.retry', 'Retry')}
        />
      )}
      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="table"
          title={t('managementPack.emptyTitle', 'No projects to report')}
          sub={t('managementPack.emptySub', 'Won and ongoing projects, and any project invoiced in this period, appear here.')}
          action={may('create', 'salesInvoice') ? { label: t('financeHub:hub.newInvoice', 'New invoice'), onClick: () => navigate('/sales-invoices?create=1') } : undefined}
        />
      )}

      {pack && state === undefined && (
        <>
          {/* N6: group spacing between the filter panel and the table it introduces. */}
          <h2 className="mb-2 mt-6 text-[15px] font-semibold">
            {t('managementPack.projectsAsAt', 'Projects as at {{month}}', { month: monthLabel(pack.to) })}
          </h2>
          <DataTable
            rows={filteredRows}
            columns={columns}
            rowKey={(row) => row.key}
            tableId="managementpack-1-table"
            accessibleName={t('managementPack.col.project', 'Project')}
            totals={projectTotals}
            // N6: the heading sits apart from the filter panel, so the table closes its own top edge.
            className="rounded-t-lg"
            state={filteredRows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('financeHub:managementPack.noSearchMatches', 'No projects match your search')}
            emptySub={t('financeHub:managementPack.noSearchMatchesSub', 'Try another project, client or project manager name.')}
          />
        </>
      )}
      </div>

      {pack && state === undefined && (
        <>
          {!anyProgress && pack.rows.some((row) => row.kind === 'contract') && <p className="mt-3 text-sm text-muted-foreground">{t('financeHub:managementPack.noProgressNote', 'No progress is recorded yet, so earned revenue follows what has been invoiced.')}</p>}
          {backlogUnknownSomewhere && <p className="mt-3 text-sm text-muted-foreground">{t('financeHub:managementPack.backlogUnknownNote', 'Backlog is left out where a foreign-currency invoice needs reconciliation before the balance can be known.')}{' '}<Link to="/finance/receivables" className="font-medium text-primary-text underline underline-offset-2">{t('financeHub:managementPack.reviewInvoices', 'Review invoices')}</Link></p>}
          {pack.rows.some((row) => row.kind === 'unassigned') && <p className="mt-3 text-sm text-muted-foreground">{t('financeHub:managementPack.unassignedNote', 'Some invoices are not assigned to a project yet.')}{' '}<Link to="/finance/receivables?attribution=unassigned" className="font-medium text-primary-text underline underline-offset-2">{t('financeHub:managementPack.assignProjects', 'Assign projects')}</Link></p>}
          <button type="button" aria-expanded={monthlyTotalsExpanded} aria-controls="managementpack-monthly-totals" onClick={() => setMonthlyTotalsExpanded((expanded) => !expanded)} className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {monthlyTotalsExpanded ? t('finance:area.hideMonthlyTotals', 'Hide monthly totals') : t('finance:area.showMonthlyTotals', 'Show monthly totals')}
            <span className="text-muted-foreground">{t('finance:area.monthlyTotalsCount', '{{count}} months', { count: pack.months.length })}</span>
          </button>
          {monthlyTotalsExpanded && <div id="managementpack-monthly-totals" className="mt-2"><DataTable rows={totalsRows} columns={totalsColumns} rowKey={(r) => `${r.currency}|${r.month}`} tableId="managementpack-2-table" accessibleName={t('managementPack.monthlyTotals', 'Monthly totals')} /></div>}
          {pack.undatedInvoiceCount > 0 && <p className="mt-3 text-xs text-muted-foreground">{t('managementPack.undated', '{{count}} invoices have no date and are not counted', { count: pack.undatedInvoiceCount })}</p>}
        </>
      )}

      {progressFor && progressFor.projectId && pack && (
        <RecordProgressModal
          open
          onClose={() => setProgressFor(null)}
          projectId={progressFor.projectId}
          projectName={progressFor.projectName ?? ''}
          defaultMonth={pack.to}
          deliveryPct={delivery?.[progressFor.projectId] ?? null}
        />
      )}
    </ListPage>
  );
};

export default ManagementPack;
