import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Button, Card, DataTable, Icon, KPITile, ListPage, ListState, StatusPill, TextField, type Column,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useManagementPack } from '@/src/hooks/useManagementPack';
import { useProjectsDelivery } from '@/src/hooks/useProjectsDelivery';
import { useExport } from '@/src/components/export/useExport';
import { RecordProgressModal } from '@/src/components/reports/RecordProgressModal';
import { fromCents, type PackMonth, type PackRow, type PackTotalsMonth } from '@/src/lib/reports/managementPack';
import {
  buildManagementPackExport, managementPackFileStem, type ManagementPackExportLabels,
} from '@/src/lib/reports/managementPackExport';
import { monthInputToIso } from '@/src/lib/reports/months';
import { formatCurrencyAuto, formatCurrencyCents, formatUtcMonthYear } from '@/src/lib/format';

type Measure = 'recognisedToDate' | 'invoicedToDate' | 'unbilled' | 'backlog';
type TotalsMeasure = 'planned' | 'recognised' | 'invoiced' | 'unbilled';
type TotalsRow = PackTotalsMonth & { currency: string };

const KPI_MEASURES: Measure[] = ['recognisedToDate', 'invoicedToDate', 'unbilled', 'backlog'];
const TOTALS_MEASURES: TotalsMeasure[] = ['planned', 'recognised', 'invoiced', 'unbilled'];
const monthLabel = (iso: string) => formatUtcMonthYear(new Date(`${iso}T00:00:00Z`));
const money = (cents: number | null, currency: string) =>
  cents === null ? '—' : formatCurrencyCents(fromCents(cents), currency);

const ManagementPack: React.FC = () => {
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
  const { data: pack, isPending, isError, error } = useManagementPack(range);
  const { exportTable, busy } = useExport();
  const [progressFor, setProgressFor] = useState<PackRow | null>(null);
  const projectIds = useMemo(
    () => (pack?.rows ?? []).filter((r) => r.kind === 'contract' && r.projectId).map((r) => r.projectId as string),
    [pack],
  );
  const { data: delivery } = useProjectsDelivery(projectIds);

  if (!may('view', 'managementPack')) {
    return (
      <div className="flex h-[calc(100vh-var(--header-h))] items-center justify-center px-4">
        <div className="text-center">
          <h2 className="text-heading font-semibold">
            {t('managementPack.noAccessTitle', "You don't have access to the management pack")}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {t('managementPack.noAccessSub', 'The management pack is available to Finance, Project Managers, Executives and Admins.')}
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
  const onExport = (format: 'csv' | 'xlsx') => {
    if (pack) void exportTable(buildManagementPackExport(pack, exportLabels), managementPackFileStem(pack), format);
  };

  const canRecord = (row: PackRow) =>
    row.kind === 'contract' &&
    !!row.projectId &&
    may('edit', 'projectProgress', { currentUserId: currentUser?.id ?? null, record: { project_manager_id: row.projectManagerId } });

  const measureCell = (key: Measure) => (row: PackRow) => {
    const m = at(row);
    const value = m ? m[key] : null;
    return (
      <span data-testid={`pack-cell-${key}`} className="tabular text-right font-mono text-[13px]">
        {money(value, row.currency)}
        {key === 'unbilled' && value !== null && value < 0 && (
          <span className="ml-1 text-xs text-muted-foreground">{t('managementPack.billedAhead', 'billed ahead')}</span>
        )}
      </span>
    );
  };

  const columns: Column<PackRow>[] = [
    {
      key: 'project',
      header: t('managementPack.col.project', 'Project'),
      cell: (row) =>
        row.kind === 'unassigned' ? (
          <StatusPill variant="neutral">{t('managementPack.unassigned', 'Unassigned')}</StatusPill>
        ) : (
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">{row.projectName}</span>
            {row.kind === 'otherCurrency' ? (
              <span className="text-xs text-muted-foreground">
                {t('managementPack.otherCurrency', 'Invoiced in {{currency}}, not the contract currency', { currency: row.currency })}
              </span>
            ) : (
              row.projectNumber && <span className="text-xs text-muted-foreground font-mono">{row.projectNumber}</span>
            )}
          </div>
        ),
    },
    {
      key: 'currency',
      header: t('managementPack.col.currency', 'Currency'),
      cell: (row) => <span className="font-mono text-[13px]">{row.currency}</span>,
    },
    {
      key: 'contract',
      header: t('managementPack.col.contract', 'Contract'),
      align: 'num',
      cell: (row) => (
        <span data-testid="pack-cell-contract" className="tabular text-right font-mono text-[13px]">
          {money(row.contractNet, row.currency)}
        </span>
      ),
    },
    ...KPI_MEASURES.map((k): Column<PackRow> => ({ key: k, header: label[k], align: 'num', cell: measureCell(k) })),
    {
      key: 'basis',
      header: t('managementPack.col.basis', 'Basis'),
      cell: (row) =>
        row.latestProgress
          ? t('managementPack.basis.progress', '{{pct}}% complete', { pct: row.latestProgress.pctComplete })
          : t('managementPack.basis.invoiced', 'Invoiced'),
    },
    {
      key: 'actions',
      header: '',
      cell: (row) =>
        canRecord(row) ? (
          <Button variant="outline" onClick={() => setProgressFor(row)}>
            {t('managementPack.recordProgress', 'Record progress')}
          </Button>
        ) : null,
    },
  ];

  const totalsRows: TotalsRow[] = (pack?.totals ?? []).flatMap((tot) =>
    tot.months.map((m) => ({ ...m, currency: tot.currency })),
  );
  const totalsColumns: Column<TotalsRow>[] = [
    { key: 'month', header: t('managementPack.col.month', 'Month'), cell: (r) => monthLabel(r.month) },
    {
      key: 'currency',
      header: t('managementPack.col.currency', 'Currency'),
      cell: (r) => <span className="font-mono text-[13px]">{r.currency}</span>,
    },
    ...TOTALS_MEASURES.map((k): Column<TotalsRow> => ({
      key: k,
      header: label[k],
      align: 'num',
      cell: (r) => <span className="tabular text-right font-mono text-[13px]">{money(r[k], r.currency)}</span>,
    })),
  ];

  return (
    <ListPage
      title={t('managementPack.title', 'Monthly management pack')}
      description={t('managementPack.description', 'Planned, recognised and invoiced revenue per project and month. All figures exclude tax.')}
      primaryAction={
        <div className="flex gap-2">
          <Button variant="outline" disabled={!pack || busy} onClick={() => onExport('csv')}>
            <Icon name="export" className="size-4 mr-2" />
            {t('managementPack.exportCsv', 'Export CSV')}
          </Button>
          <Button variant="outline" disabled={!pack || busy} onClick={() => onExport('xlsx')}>
            <Icon name="export" className="size-4 mr-2" />
            {t('managementPack.exportXlsx', 'Export XLSX')}
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <TextField
          id="pack-from"
          type="month"
          label={t('managementPack.from', 'From')}
          value={params.get('from') ?? pack?.from.slice(0, 7) ?? ''}
          onChange={(v) => setMonth('from', v)}
        />
        <TextField
          id="pack-as-at"
          type="month"
          label={t('managementPack.asAt', 'As at')}
          value={params.get('to') ?? pack?.to.slice(0, 7) ?? ''}
          onChange={(v) => setMonth('to', v)}
        />
      </div>

      {/* Honest KPI states (NFR-MMP-006): skeletons while loading, "—" on error — never a fabricated 0. */}
      {(state === 'loading' || state === 'error') && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          {KPI_MEASURES.map((k) => (
            <KPITile key={k} label={label[k]} value="—" icon="dollar" tone="blue"
              loading={state === 'loading'} error={state === 'error'} />
          ))}
        </div>
      )}
      {pack && state === undefined && pack.totals.map((tot) => {
        const m = tot.months[tot.months.length - 1];
        return (
          <div key={tot.currency} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            {KPI_MEASURES.map((k) => (
              <KPITile key={k} label={`${label[k]} · ${tot.currency}`}
                value={formatCurrencyAuto(fromCents(m[k]), tot.currency)} icon="dollar" tone="blue" />
            ))}
          </div>
        );
      })}

      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={6} /></div>
      )}
      {state === 'error' && (
        <ListState
          variant="error"
          title={t('managementPack.errorTitle', "Couldn't load the management pack")}
          sub={invalidRange
            ? t('managementPack.invalidRange', 'Choose a start month on or before the as-at month, at most 24 months apart.')
            : t('managementPack.errorSub', 'The request failed. Check your connection and try again.')}
        />
      )}
      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="table"
          title={t('managementPack.emptyTitle', 'No projects to report')}
          sub={t('managementPack.emptySub', 'Won and ongoing projects, and any project invoiced in this period, appear here.')}
        />
      )}

      {pack && state === undefined && (
        <>
          <h2 className="mb-2 text-[15px] font-semibold">
            {t('managementPack.projectsAsAt', 'Projects as at {{month}}', { month: monthLabel(pack.to) })}
          </h2>
          <Card className="overflow-hidden mb-6">
            <DataTable rows={pack.rows} columns={columns} rowKey={(row) => row.key} />
          </Card>
          <h2 className="mb-2 text-[15px] font-semibold">{t('managementPack.monthlyTotals', 'Monthly totals')}</h2>
          <Card className="overflow-hidden">
            <DataTable rows={totalsRows} columns={totalsColumns} rowKey={(r) => `${r.currency}|${r.month}`} />
          </Card>
          {pack.undatedInvoiceCount > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('managementPack.undated', '{{count}} invoices have no date and are not counted', { count: pack.undatedInvoiceCount })}
            </p>
          )}
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
