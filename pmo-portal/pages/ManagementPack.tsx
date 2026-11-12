import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/src/components/ui/Avatar';
import { EarnedAgainstContract, EarnedInvoicedTrend } from '@/src/components/reports/ReportCharts';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  Button, DataTable, Icon, ListPage, ListState, MenuButton, ProgressBar, StatusPill, TextField, Toolbar, type Column,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { FinanceAccessDenied } from '@/src/components/finance/FinanceAccessDenied';
import { useFinanceAccess } from '@/src/components/finance/useFinanceAccess';
import { useAuth } from '@/src/auth/useAuth';
import { useManagementPack } from '@/src/hooks/useManagementPack';
import { useProjectsDelivery } from '@/src/hooks/useProjectsDelivery';
import { useProjects } from '@/src/hooks/useProjects';
import { useRevenuePerProject } from '@/src/hooks/useRevenue';
import { useExport } from '@/src/components/export/useExport';
import { RecordProgressModal } from '@/src/components/reports/RecordProgressModal';
import { BoardPackAction } from '@/src/components/reports/BoardPackAction';
import {
  fromCents,
  leftToBillAt,
  selectBilledWorkCumulative,
  selectBilledWorkInPeriod,
  selectBilledWorkOpening,
  type BilledWorkTotal,
  type PackMonth,
  type PackRow,
  type PackTotalsMonth,
} from '@/src/lib/reports/managementPack';
import {
  buildManagementPackExport, managementPackFileStem, type ManagementPackExportLabels,
} from '@/src/lib/reports/managementPackExport';
import { monthInputToIso } from '@/src/lib/reports/months';
import { formatMonthYearShort, formatNumberMax2, formatTableMoney } from '@/src/lib/format';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { moneyTileProps } from '@/src/components/finance/moneyTile';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import { useFigureReport, type HiddenFigure } from '@/src/components/ui/useFigureScope';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { PROGRESS_RECORDABLE_PROJECT_STATUSES } from '@/src/lib/dashboardConstants';

type Measure = 'recognisedToDate' | 'invoicedToDate' | 'unbilled' | 'backlog';
type TotalsMeasure = 'planned' | 'recognised' | 'invoiced' | 'unbilled' | 'backlog';
type TotalsRow = PackTotalsMonth & { currency: string };

const ManagementPackFigureReasons: React.FC<{ figures: HiddenFigure[] }> = ({ figures }) => {
  useFigureReport(figures);
  return null;
};

const TOTALS_MEASURES: TotalsMeasure[] = ['planned', 'recognised', 'invoiced', 'unbilled', 'backlog'];
const monthLabel = (iso: string) => formatMonthYearShort(iso);
const money = (cents: number | null, currency: string) =>
  cents === null ? '—' : formatTableMoney(fromCents(cents), currency) ?? '—';

const shortMonth = (iso: string) => monthLabel(iso).split(/\s+/)[0] ?? monthLabel(iso);

interface ActionCellProps {
  row: PackRow;
  canRecord: (row: PackRow) => boolean;
  onExportRow: (row: PackRow) => void;
  navigate: (to: string) => void;
  setProgressFor: (row: PackRow) => void;
  ariaLabel: string;
  labels: {
    openProject: string;
    viewInvoices: string;
    recordProgress: string;
    exportRow: string;
  };
}

const ActionCell: React.FC<ActionCellProps> = React.memo(({
  row,
  canRecord,
  onExportRow,
  navigate,
  setProgressFor,
  ariaLabel,
  labels,
}) => {
  const items = useMemo(() => [
    ...(row.projectId ? [{ label: labels.openProject, onClick: () => navigate(`/projects/${row.projectId}`) }] : []),
    { label: labels.viewInvoices, onClick: () => navigate(row.projectId ? `/finance/receivables?project=${encodeURIComponent(row.projectId)}` : '/finance/receivables?attribution=unassigned') },
    ...(canRecord(row) ? [{ label: labels.recordProgress, onClick: () => setProgressFor(row) }] : []),
    { label: labels.exportRow, onClick: () => onExportRow(row) },
  ], [row, canRecord, onExportRow, navigate, setProgressFor, labels]);

  return <MenuButton ariaLabel={ariaLabel} items={items} />;
});

type InvoiceCountStatus = 'error' | 'loading' | 'success';

function getInvoiceCountExportValue(
  status: InvoiceCountStatus,
  count: number,
): number | string {
  return status === 'success' ? count : '';
}

const ManagementPack: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { canView: canViewFinance } = useFinanceAccess();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const label: Record<Measure | TotalsMeasure, string> = useMemo(() => ({
    planned: t('managementPack.col.planned', 'Planned'),
    recognised: t('managementPack.col.recognised', 'Recognised'),
    invoiced: t('managementPack.col.invoiced', 'Billed work in period'),
    unbilled: t('financeHub:managementPack.col.doneNotYetBilled', 'Done, not yet billed'),
    recognisedToDate: t('managementPack.col.recognisedToDate', 'Recognised to date'),
    invoicedToDate: t('managementPack.col.invoicedToDate', 'Invoiced to date'),
    backlog: t('financeHub:managementPack.col.leftToBill', 'Left to bill'),
  }), [t]);
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
  const {
    data: revenueRows,
    isPending: invoiceCountsPending,
    isError: invoiceCountsError,
    refetch: refetchInvoiceCounts,
  } = useRevenuePerProject();
  const invoiceCountStatus: InvoiceCountStatus = invoiceCountsError
    ? 'error'
    : invoiceCountsPending || revenueRows === undefined
      ? 'loading'
      : 'success';
  const projectById = useMemo(() => new Map((projects ?? []).map((project) => [project.id, project])), [projects]);
  const invoiceCounts = useMemo(
    () => (invoiceCountStatus === 'success' && revenueRows
      ? new Map(revenueRows.map((row) => [`${row.project_id ?? ''}|${row.currency}`, row.invoice_count]))
      : new Map<string, number>()),
    [invoiceCountStatus, revenueRows],
  );
  const invoiceCountsUnavailableLabel = t('financeHub:managementPack.invoiceCountsUnavailable', 'Unavailable');
  const invoiceCountsLoadingLabel = t('financeHub:managementPack.invoiceCountsLoading', 'Loading invoice counts');
  const retryInvoiceCountsLabel = t('financeHub:managementPack.retryInvoiceCounts', 'Retry invoice counts');

  const state: 'loading' | 'error' | 'empty' | undefined = isError
    ? 'error'
    : isPending
      ? 'loading'
      : pack && pack.rows.length === 0
        ? 'empty'
        : undefined;
  const invalidRange = (error as { code?: string } | null)?.code === '22023';
  const backlogReason = t('financeHub:managementPack.figures.leftToBillUnknownReason', 'A foreign-currency invoice needs reconciliation before this amount can be known.');

  const setMonth = (key: 'from' | 'to', value: string) => {
    const next = new URLSearchParams(params);
    if (monthInputToIso(value)) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const exportLabels: ManagementPackExportLabels = {
    period: t('financeHub:managementPack.col.period', 'Period'),
    projectNumber: t('managementPack.col.projectNumber', 'Project number'),
    project: t('managementPack.col.project', 'Project'),
    client: t('managementPack.col.client', 'Client'),
    currency: t('managementPack.col.currency', 'Currency'),
    taxBasis: t('managementPack.col.taxBasis', 'Tax basis'),
    planned: label.planned,
    recognised: label.recognised,
    invoicedByMonth: t('financeHub:managementPack.col.billedWorkByMonth', 'Billed work by month'),
    selectedPeriod: t('financeHub:managementPack.figures.billedWorkInPeriod', 'Billed work in period'),
    opening: t('financeHub:managementPack.figures.openingBilledWork', 'Opening billed work'),
    selectedPeriodRow: t('financeHub:managementPack.export.selectedPeriodTotal', 'Selected period total'),
    openingRow: t('financeHub:managementPack.export.opening', 'Opening'),
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
    basisEarned: t('financeHub:managementPack.basisEarned', 'Earned value'),
  };
  // One Export (long-format CSV, one row per project × month with its currency and tax basis).
  const packRef = useRef(pack);
  packRef.current = pack;

  const exportLabelsRef = useRef(exportLabels);
  exportLabelsRef.current = exportLabels;

  const onExport = useCallback(() => {
    const currentPack = packRef.current;
    if (currentPack) void exportTable(buildManagementPackExport(currentPack, exportLabelsRef.current), managementPackFileStem(currentPack), 'csv');
  }, [exportTable]);

  const onExportRow = useCallback((row: PackRow) => {
    const currentPack = packRef.current;
    if (!currentPack) return;
    void exportTable(buildManagementPackExport({ ...currentPack, rows: [row], totals: [] }, exportLabelsRef.current),
      `${managementPackFileStem(currentPack)}_${row.projectNumber ?? row.projectName ?? 'row'}`, 'csv');
  }, [exportTable]);

  const canRecord = useCallback((row: PackRow) =>
    // R-004: the project's PM records progress too; may('edit','projectProgress') carries that rule.
    row.kind === 'contract' &&
    PROGRESS_RECORDABLE_PROJECT_STATUSES.has(row.projectStatus ?? '') &&
    !!row.projectId &&
    may('edit', 'projectProgress', { currentUserId: currentUser?.id ?? null, record: { project_manager_id: row.projectManagerId } }),
    [may, currentUser?.id]);

  // C4 + Unknowable-Is-Not-Zero: an unknown backlog is an explained dash (reason on hover and for screen
  // readers), never the word "Unavailable" as a value; the page states the reason once with its fix link.
  const backlogUnknown = useMemo(
    () => (
      <span title={backlogReason}>
        —<span className="sr-only"> {backlogReason}</span>
      </span>
    ),
    [backlogReason],
  );

  const last = pack ? pack.months.length - 1 : -1;
  const measureCell = useCallback((key: Measure) => (row: PackRow) => {
    const m = last >= 0 ? row.months[last] : null;
    const value = key === 'backlog'
      ? m && row.kind === 'contract' ? leftToBillAt([row], row.currency, m.month) : null
      : m ? m[key] : null;
    return (
      <span data-testid={`pack-cell-${key}`} className="tabular text-right text-control">
        {key === 'backlog' && row.kind === 'contract' && value === null ? backlogUnknown : money(value, row.currency)}
        {key === 'unbilled' && value !== null && value < 0 && (
          <span className="ml-1 text-control text-muted-foreground">{t('managementPack.billedAhead', 'billed ahead')}</span>
        )}
      </span>
    );
  }, [backlogUnknown, t, last]);

  const filteredRows = (pack?.rows ?? []).filter((row) => {
    const project = row.projectId ? projectById.get(row.projectId) : undefined;
    const pmName = project?.pm?.full_name ?? '';
    const haystack = [row.projectName, row.projectNumber, row.clientName, pmName, row.currency].filter(Boolean).join(' ').toLocaleLowerCase();
    return haystack.includes(search.trim().toLocaleLowerCase());
  });
  const latestMonth = (row: PackRow) => row.months[row.months.length - 1] ?? null;
  const invoiceCountFor = useCallback((row: PackRow) => invoiceCounts.get(`${row.projectId ?? ''}|${row.currency}`) ?? 0, [invoiceCounts]);
  // O11: when no contract row has recorded progress the whole column would read "Invoiced basis";
  // the page says it once instead and the column is left out.
  const anyProgress = (pack?.rows ?? []).some((row) => row.kind === 'contract' && row.latestProgress != null);
  const packTo = pack?.to;

  const actionLabels = useMemo(() => ({
    openProject: t('financeHub:managementPack.openProject', 'Open project'),
    viewInvoices: t('financeHub:managementPack.viewInvoices', 'View invoices'),
    recordProgress: t('managementPack.recordProgress', 'Record progress'),
    exportRow: t('financeHub:managementPack.exportRow', 'Export row'),
  }), [t]);

  const columns = useMemo<Column<PackRow>[]>(() => [
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
            {row.projectManagerId && <Avatar name={projectById.get(row.projectId ?? '')?.pm?.full_name ?? t('financeHub:managementPack.projectManager', 'Project manager')} size="xs" />}
            <span>{row.projectName}</span>
          </span>
        ),
      secondaryCell: (row) =>
        row.kind === 'unassigned'
          ? undefined
          : row.kind === 'otherCurrency'
            ? t('managementPack.otherCurrency', 'Invoiced in {{currency}}, not the contract currency', { currency: row.currency })
            : <span className="flex flex-col text-control text-muted-foreground">
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
        const missingLatest = latest?.month !== packTo;
        return (
          <span className="flex min-w-0 flex-col gap-1">
            {latest ? <ProgressBar value={latest.pctComplete} tone={latest.pctComplete <= 90 ? 'primary' : latest.pctComplete <= 100 ? 'warning' : 'destructive'} compact aria-label={t('financeHub:managementPack.progressValue', 'Progress {{percent}}%', { percent: formatNumberMax2(latest.pctComplete) })} /> : <span className="text-control text-muted-foreground">{t('financeHub:hub.fix.reports.invoicedBasis', 'Invoiced basis')}</span>}
            {latest && <span className="whitespace-nowrap text-control text-muted-foreground"><span>{t('financeHub:managementPack.progressComplete', '{{percent}}% complete', { percent: formatNumberMax2(latest.pctComplete) })}</span><span> · {shortMonth(latest.month)}</span></span>}
            {latest && missingLatest && packTo && <StatusPill variant="warn">{t('financeHub:hub.fix.reports.noProgressForMonth', { defaultValue: 'No entry for {{month}}', month: shortMonth(packTo) })}</StatusPill>}
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
        <span data-testid="pack-cell-contract" className="tabular text-right text-control">
          {money(row.contractNet, row.currency)}
        </span>
      ),
    },
    ...(['recognisedToDate', 'invoicedToDate', 'unbilled', 'backlog'] as Measure[]).map((k): Column<PackRow> => ({
      key: k,
      header: k === 'recognisedToDate' ? t('financeHub:managementPack.col.earned', 'Earned') : label[k],
      kind: 'money', align: 'num', size: 135, cell: measureCell(k),
    })),
    {
      key: 'invoiceCount',
      header: t('financeHub:managementPack.col.invoices', 'Invoices'),
      kind: 'number',
      align: 'num',
      size: 96,
      cell: (row) => (
        <span data-testid="pack-cell-invoices" className="tabular">
          {invoiceCountStatus === 'error' ? (
            invoiceCountsUnavailableLabel
          ) : invoiceCountStatus === 'loading' ? (
            <span aria-label={invoiceCountsLoadingLabel}>—</span>
          ) : (
            invoiceCountFor(row)
          )}
        </span>
      ),
      exportValue: (row) => getInvoiceCountExportValue(invoiceCountStatus, invoiceCountFor(row)),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('managementPack.actions', 'Actions')}</span>,
      kind: 'actions',
      size: 52,
      cell: (row) => (
        <ActionCell
          row={row}
          canRecord={canRecord}
          onExportRow={onExportRow}
          navigate={navigate}
          setProgressFor={setProgressFor}
          ariaLabel={t('financeHub:managementPack.actionsForProject', 'Actions for {{project}}', { project: row.projectName ?? t('managementPack.unassigned', 'Unassigned') })}
          labels={actionLabels}
        />
      ),
    },
  ], [
    t,
    projectById,
    anyProgress,
    packTo,
    label,
    measureCell,
    invoiceCountStatus,
    invoiceCountsUnavailableLabel,
    invoiceCountsLoadingLabel,
    invoiceCountFor,
    canRecord,
    onExportRow,
    navigate,
    setProgressFor,
    actionLabels,
  ]);

  // T10: one total row per currency (never summed across currencies) — cumulative figures at the as-at
  // month from the pack's own per-currency totals; the contract total adds only rows that carry a contract.
  const projectTotals = [...new Set(filteredRows.map((row) => row.currency))].map((currency) => {
    const rows = filteredRows.filter((r) => r.currency === currency);
    const contracts = rows.filter((r) => r.contractNet !== null);
    const ms = rows.map(latestMonth).filter((m): m is PackMonth => !!m);
    const contractTotal = contracts.reduce((sum, r) => sum + (r.contractNet ?? 0), 0);
    const sum = (key: 'recognisedToDate' | 'invoicedToDate' | 'unbilled' | 'invoiceCountToDate') => ms.reduce((total, month) => total + month[key], 0);
    const backlogIsUnknown = contracts.some((row) => latestMonth(row)?.backlog === null);
    const month = pack?.months[last];
    const leftToBill = backlogIsUnknown || !month ? null : leftToBillAt(contracts, currency, month);
    return {
      key: currency,
      label: `${t('managementPack.total', 'Total')} · ${currency}`,
      values: {
        contract: contracts.length > 0 ? money(contractTotal, currency) : null,
        recognisedToDate: money(sum('recognisedToDate'), currency),
        invoicedToDate: money(sum('invoicedToDate'), currency),
        unbilled: money(sum('unbilled'), currency),
        backlog: leftToBill === null ? backlogUnknown : money(leftToBill, currency),
        invoiceCount:
          invoiceCountStatus === 'error' ? (
            invoiceCountsUnavailableLabel
          ) : invoiceCountStatus === 'loading' ? (
            <span aria-label={invoiceCountsLoadingLabel}>—</span>
          ) : (
            filteredRows.reduce((total, row) => total + invoiceCountFor(row), 0)
          ),
        // An unknown row makes the currency total unknown too: left out, explained by the note below the table.
      } as Record<string, React.ReactNode>,
    };
  });

  const totalsRows: TotalsRow[] = (pack?.totals ?? []).flatMap((tot) =>
    tot.months.map((m) => ({ ...m, backlog: leftToBillAt(pack?.rows ?? [], tot.currency, m.month), currency: tot.currency })),
  );
  const earnedBars = (pack && last >= 0 ? filteredRows : []).flatMap((row) => {
    const m = row.months[last];
    return row.kind === 'contract' && row.contractNet != null && m ? [{ key: row.key, name: row.projectName ?? row.projectNumber ?? '—', currency: row.currency, contract: row.contractNet, earned: m.recognisedToDate }] : [];
  });
  const trendCurrencies = (pack?.totals ?? []).filter((tot) => tot.months.length >= 3);
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
        <span className="tabular text-right text-control">
          {k === 'backlog' && r.backlog === null ? backlogUnknown : money(r[k], r.currency)}
        </span>
      ),
    })),
  ];
  const sortedTotals = [...(pack?.totals ?? [])].sort((left, right) => left.currency === orgCurrency ? -1 : right.currency === orgCurrency ? 1 : left.currency.localeCompare(right.currency));
  const latestTotals = sortedTotals.flatMap((tot) => {
    const month = tot.months[tot.months.length - 1];
    if (!month) return [];
    const leftToBill = leftToBillAt(pack?.rows ?? [], tot.currency, month.month);
    return [{ currency: tot.currency, month: { ...month, backlog: leftToBill } }];
  });
  const homeCurrency = orgCurrency ?? 'IDR';
  const selectedPeriod = selectBilledWorkInPeriod(pack, pack?.from.slice(0, 7) ?? null, pack?.to.slice(0, 7) ?? null);
  const cumulativeBilledWork = selectBilledWorkCumulative(pack, pack?.to.slice(0, 7) ?? null);
  const openingBilledWork = selectBilledWorkOpening(pack, pack?.from.slice(0, 7) ?? null);
  const figureSpecs: Array<{
    key: string;
    label: string;
    help: string;
    amount?: (month: PackTotalsMonth) => number | null;
    reading?: readonly BilledWorkTotal[];
    caption?: (month: PackTotalsMonth, currency: string) => string;
  }> = [
    {
      key: 'earnedNotInvoiced',
      label: t('financeHub:managementPack.figures.doneNotYetBilled', 'Done, not yet billed'),
      help: t('financeHub:managementPack.figures.doneNotYetBilledHelp', 'Earned to date minus invoiced to date, using the report’s revenue recognition basis.'),
      amount: (month) => month.unbilled,
    },
    {
      key: 'earnedToDate',
      label: t('financeHub:managementPack.figures.earnedToDate', 'Earned to date'),
      help: t('financeHub:managementPack.figures.earnedToDateHelp', 'Cumulative recognized revenue through the as-at month; the caption shows this month’s change.'),
      amount: (month) => month.recognisedToDate,
      caption: (month, currency) => t('financeHub:managementPack.figures.thisMonthDelta', 'This month {{amount}}', { amount: formatTableMoney(Math.round(fromCents(month.recognised)), currency) ?? '—' }),
    },
    {
      key: 'billedWorkInPeriod',
      label: t('financeHub:managementPack.figures.billedWorkInPeriod', 'Billed work in period'),
      help: t('financeHub:managementPack.figures.billedWorkInPeriodHelp', 'Billed-work value dated inside the selected from and as-at months, before tax.'),
      reading: selectedPeriod,
    },
    {
      key: 'invoicedToDate',
      label: t('financeHub:managementPack.figures.invoicedToDate', 'Invoiced to date'),
      help: t('financeHub:managementPack.figures.invoicedToDateHelp', 'Cumulative billed-work value from all history through the as-at month, before tax. The table lists the invoice count per project.'),
      amount: (month) => month.invoicedToDate,
      reading: cumulativeBilledWork,
    },
    {
      key: 'openingBilledWork',
      label: t('financeHub:managementPack.figures.openingBilledWork', 'Opening billed work'),
      help: t('financeHub:managementPack.figures.openingBilledWorkHelp', 'All-history billed work before the selected from month, before tax.'),
      reading: openingBilledWork,
    },
    {
      key: 'backlog',
      label: t('financeHub:managementPack.figures.leftToBill', 'Left to bill'),
      help: t('financeHub:managementPack.figures.leftToBillHelp', 'Signed contract value minus invoiced to date; unavailable if a foreign-currency invoice needs reconciliation.'),
      amount: (month) => month.backlog,
    },
  ];
  /** One row of four tiles: the home currency is the figure, another currency a second line; unknown in the home currency hides the tile. */
  const tileFor = (spec: (typeof figureSpecs)[number]) => {
    const byCurrency: Record<string, number> = {};
    for (const { currency, month } of latestTotals) {
      const reading = spec.reading?.find((row) => row.currency === currency)?.amount;
      const cents = spec.reading
        ? reading === undefined ? null : Math.round(reading * 100)
        : spec.amount?.(month) ?? null;
      if (cents === null) { if (currency === homeCurrency) return null; continue; }
      byCurrency[currency] = Math.round(cents);
    }
    return Object.keys(byCurrency).length > 0 ? moneyTileProps(byCurrency, homeCurrency) : null;
  };
  const homeMonth = latestTotals.find(({ currency }) => currency === homeCurrency)?.month ?? latestTotals[0]?.month;
  const backlogUnknownSomewhere = latestTotals.some(({ month }) => month.backlog === null)
    || filteredRows.some((row) => row.kind === 'contract' && latestMonth(row)?.backlog === null);
  const showFigures = Boolean(pack) && !isError && latestTotals.length > 0;
  const backlogFigure = figureSpecs.find((spec) => spec.key === 'backlog');
  const backlogFigureHidden = backlogFigure ? tileFor(backlogFigure) === null : false;
  const leftToBillReason = t('financeHub:managementPack.leftToBillUnknownNote', 'Left to bill excludes unreconciled foreign-currency invoices; their amounts are unknown.');
  const reviewInvoices = { to: '/finance/receivables', label: t('financeHub:managementPack.reviewInvoices', 'Review invoices') };
  const figureReasons: HiddenFigure[] = [
    ...(!anyProgress && pack?.rows.some((row) => row.kind === 'contract')
      ? [{ label: t('financeHub:managementPack.figures.earnedToDate', 'Earned to date'), reason: t('financeHub:managementPack.noProgressNote', 'Without progress assessments, earned revenue follows invoiced revenue.') }]
      : []),
    ...(backlogUnknownSomewhere && !backlogFigureHidden
      ? [{ label: t('financeHub:managementPack.figures.leftToBill', 'Left to bill'), reason: leftToBillReason, link: reviewInvoices }]
      : []),
    ...(pack && pack.undatedInvoiceCount > 0
      ? [{ label: t('finance:receivables.invoiceDate', 'Invoice date'), reason: t('managementPack.undated', '{{count}} undated invoices are excluded', { count: pack.undatedInvoiceCount }) }]
      : []),
  ];

  if (!canViewFinance) return <FinanceAccessDenied surface="reports" />;

  return (
    <FigureScope>
    <ListPage
      title={embedded
        ? t('finance:area.reportTitle', 'Revenue by project and month')
        : t('finance:area.reports', 'Reports')}
      help={<p>{t('managementPack.description', 'Planned, recognised and invoiced revenue per project and month. All figures exclude tax.')}</p>}
      count={pack ? filteredRows.length : undefined}
      total={pack ? pack.rows.length : undefined}
      headingLevel={embedded ? 2 : 1}
      primaryAction={!embedded ? <BoardPackAction /> : undefined}
    >
      <div className="mb-3"><FigureHiddenLine compact /></div>
      {isPending && !pack ? (
        <KPIRow aria-label={t('financeHub:managementPack.figures.title', 'Report figures')} className="mb-5 grid-cols-2 xl:grid-cols-6">
          {figureSpecs.map((spec) => <KPITile key={spec.key} loading tone="blue" icon="grid" label={spec.label} value="" />)}
        </KPIRow>
      ) : showFigures && homeMonth && (
        <KPIRow aria-label={t('financeHub:managementPack.figures.title', 'Report figures')} className="mb-5 grid-cols-2 xl:grid-cols-6">
          {figureSpecs.map((spec) => {
            const tile = tileFor(spec);
            return (
              <KPITile
                key={spec.key}
                icon="grid"
                tone="blue"
                label={spec.label}
                help={spec.help}
                value={tile?.value ?? null}
                exactValue={tile?.exactValue}
                caption={spec.caption && tile ? spec.caption(homeMonth, homeCurrency) : undefined}
                unavailableReason={tile ? undefined : spec.key === 'backlog' ? leftToBillReason : t('financeHub:managementPack.figures.unknownReason', 'a foreign-currency invoice needs reconciliation')}
                hiddenLink={spec.key === 'backlog' ? reviewInvoices : { to: '/finance/receivables', label: t('financeHub:managementPack.figures.reconcile', 'Open invoices') }}
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
          action={may('create', 'salesInvoice') ? { label: t('financeHub:hub.newInvoice', 'New invoice'), onClick: () => navigate('/finance/receivables?create=1') } : undefined}
        />
      )}

      {pack && state === undefined && (
        <div className="flex flex-col">
          {/* Comparison across projects and the earned/invoiced trend. On a phone the table comes first. */}
          {(earnedBars.length > 1 || trendCurrencies.length > 0) && (
            <div className="order-last mt-6 grid min-w-0 gap-6 lg:order-none lg:grid-cols-2">
              <EarnedAgainstContract rows={earnedBars} />
              {trendCurrencies.map((tot) => <EarnedInvoicedTrend key={tot.currency} currency={tot.currency} months={tot.months.map((m) => ({ month: m.month, earnedToDate: m.recognisedToDate, invoicedToDate: m.invoicedToDate }))} />)}
            </div>
          )}
          {/* N6: group spacing between the filter panel and the table it introduces. */}
          <h2 className="mb-2 mt-6 text-[16px] font-semibold">
            {t('managementPack.projectsAsAt', 'Projects as at {{month}}', { month: monthLabel(pack.to) })}
            <span className="ml-2 text-control font-normal text-muted-foreground">{t('finance:managementPack.exclTax', 'excl. tax')}</span>
          </h2>
          {invoiceCountStatus === 'error' && (
            <div
              role="status"
              aria-label={invoiceCountsUnavailableLabel}
              className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive-text"
            >
              <span>{invoiceCountsUnavailableLabel}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { void refetchInvoiceCounts(); }}
                className="h-8"
              >
                {retryInvoiceCountsLabel}
              </Button>
            </div>
          )}
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
        </div>
      )}
      </div>

      {pack && state === undefined && (
        <>
          <ManagementPackFigureReasons figures={figureReasons} />
          {pack.rows.some((row) => row.kind === 'unassigned') && <p className="mt-3 text-sm text-muted-foreground">{t('financeHub:managementPack.unassignedNote', 'Some invoices lack project assignments.')}{' '}<Link to="/finance/receivables?attribution=unassigned" className="font-medium text-primary-text underline underline-offset-2">{t('financeHub:managementPack.assignProjects', 'Assign projects')}</Link></p>}
          <button type="button" aria-expanded={monthlyTotalsExpanded} aria-controls="managementpack-monthly-totals" onClick={() => setMonthlyTotalsExpanded((expanded) => !expanded)} className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {monthlyTotalsExpanded ? t('finance:area.hideMonthlyTotals', 'Hide monthly totals') : t('finance:area.showMonthlyTotals', 'Show monthly totals')}
            <span className="text-muted-foreground">{t('finance:area.monthlyTotalsCount', '{{count}} months', { count: pack.months.length })}</span>
          </button>
          {monthlyTotalsExpanded && <div id="managementpack-monthly-totals" className="mt-2"><DataTable rows={totalsRows} columns={totalsColumns} rowKey={(r) => `${r.currency}|${r.month}`} tableId="managementpack-2-table" accessibleName={t('managementPack.monthlyTotals', 'Monthly totals')} /></div>}
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
    </FigureScope>
  );
};

export default ManagementPack;
