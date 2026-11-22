import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  DataTable,
  StatusPill,
  Button,
  Icon,
  Card,
  CardPad,
  DateField,
  SelectField,
  ListState,
  type Column,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import {
  useIssueClosingReport,
  useIssueClosingReportSettings,
} from '@/src/hooks/useIssueClosingReport';
import { formatClosingDuration } from '@/src/lib/incidents/closingDuration';
import type { IssueClosingTimeReportRow } from '@/src/lib/db/issueClosingReport';
import EffectiveHoursPanel from './EffectiveHoursPanel';

type DatePreset = '30d' | '90d' | 'ytd' | 'all' | 'custom';

function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function computeDateRange(preset: DatePreset, customFrom?: string, customTo?: string): { from?: string; to?: string } {
  const now = new Date();
  if (preset === '30d') {
    const from = new Date(now);
    from.setDate(now.getDate() - 30);
    return { from: toIsoDate(from), to: toIsoDate(now) };
  }
  if (preset === '90d') {
    const from = new Date(now);
    from.setDate(now.getDate() - 90);
    return { from: toIsoDate(from), to: toIsoDate(now) };
  }
  if (preset === 'ytd') {
    const from = new Date(now.getFullYear(), 0, 1);
    return { from: toIsoDate(from), to: toIsoDate(now) };
  }
  if (preset === 'custom') {
    return { from: customFrom || undefined, to: customTo || undefined };
  }
  return {};
}

export const ClosingTimeReport: React.FC = () => {
  const { t } = useTranslation('incidents');
  const navigate = useNavigate();
  const may = usePermission();
  const canView = may('view', 'incident');

  const { data: settings, isPending: isSettingsPending } = useIssueClosingReportSettings();
  const [preset, setPreset] = useState<DatePreset>('30d');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [groupingMode, setGroupingMode] = useState<'type' | 'department_groups'>('type');

  const dateRange = useMemo(
    () => computeDateRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );

  const reportQuery = useIssueClosingReport(
    {
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      groupingMode,
    },
    { enabled: canView && (settings?.enabled ?? false) },
  );

  const rows = useMemo(() => reportQuery.data ?? [], [reportQuery.data]);

  // Summary figures
  const summary = useMemo(() => {
    let totalIssues = 0;
    let closedIssues = 0;
    let openIssues = 0;
    let overdueIssues = 0;
    let weightedHoursSum = 0;

    for (const r of rows) {
      totalIssues += r.total_issues;
      closedIssues += r.closed_issues;
      openIssues += r.open_issues;
      overdueIssues += r.overdue_issues;
      if (r.avg_closing_hours !== null && r.closed_issues > 0) {
        weightedHoursSum += r.avg_closing_hours * r.closed_issues;
      }
    }

    const overallAvgHours = closedIssues > 0 ? weightedHoursSum / closedIssues : null;
    const closedPercent = totalIssues > 0 ? Math.round((closedIssues / totalIssues) * 100) : 0;

    return {
      totalIssues,
      closedIssues,
      openIssues,
      overdueIssues,
      overallAvgHours,
      closedPercent,
    };
  }, [rows]);

  const columns = useMemo<Column<IssueClosingTimeReportRow>[]>(() => [
    {
      key: 'department',
      header: t('closingReport.col.department', 'Department'),
      cell: (r) => (
        <span className="font-semibold text-foreground">{r.department}</span>
      ),
      exportValue: (r) => r.department,
    },
    {
      key: 'total_issues',
      header: t('closingReport.col.total', 'Total'),
      cell: (r) => <span className="tabular font-medium">{r.total_issues}</span>,
      exportValue: (r) => r.total_issues,
    },
    {
      key: 'closed_issues',
      header: t('closingReport.col.closed', 'Closed'),
      cell: (r) => <span className="tabular text-muted-foreground">{r.closed_issues}</span>,
      exportValue: (r) => r.closed_issues,
    },
    {
      key: 'open_issues',
      header: t('closingReport.col.open', 'Open'),
      cell: (r) => <span className="tabular text-muted-foreground">{r.open_issues}</span>,
      exportValue: (r) => r.open_issues,
    },
    {
      key: 'overdue_issues',
      header: t('closingReport.col.stalled', 'Stalled'),
      cell: (r) =>
        r.overdue_issues > 0 ? (
          <StatusPill variant="warn">{r.overdue_issues}</StatusPill>
        ) : (
          <span className="tabular text-muted-foreground">0</span>
        ),
      exportValue: (r) => r.overdue_issues,
    },
    {
      key: 'avg_closing_hours',
      header: t('closingReport.col.avgClosing', 'Avg closing time'),
      cell: (r) => (
        <span className="tabular font-medium">
          {formatClosingDuration(r.avg_closing_hours, t)}
        </span>
      ),
      exportValue: (r) => (r.avg_closing_hours !== null ? `${r.avg_closing_hours}h` : ''),
    },
    {
      key: 'median_closing_hours',
      header: t('closingReport.col.medianClosing', 'Median closing time'),
      cell: (r) => (
        <span className="tabular text-muted-foreground">
          {formatClosingDuration(r.median_closing_hours, t)}
        </span>
      ),
      exportValue: (r) => (r.median_closing_hours !== null ? `${r.median_closing_hours}h` : ''),
    },
  ], [t]);

  if (isSettingsPending) {
    return (
      <div className="p-4 sm:p-6" data-testid="closing-report-loading">
        <ListState variant="loading" shape="table" rows={6} />
      </div>
    );
  }

  if (!settings?.enabled) {
    return (
      <div className="p-4 sm:p-6 space-y-4" data-testid="closing-report-disabled">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate('/incidents')}>
            <Icon name="back" />
            {t('closingReport.backToRegister', 'Back to register')}
          </Button>
        </div>
        <Card>
          <CardPad className="text-center py-10 space-y-3">
            <Icon name="reports" className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="text-base font-semibold">{t('closingReport.title', 'Issue closing-time report')}</h2>
            <p className="max-w-md mx-auto text-control text-muted-foreground">
              {t('closingReport.disabledMessage', 'The closing-time report is not enabled for this organisation. An administrator can enable it in Administration.')}
            </p>
            <div>
              <Button variant="primary" onClick={() => navigate('/incidents')}>
                {t('closingReport.backToRegister', 'Back to register')}
              </Button>
            </div>
          </CardPad>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6" data-testid="closing-time-report">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Button variant="ghost" size="sm" onClick={() => navigate('/incidents')} aria-label={t('closingReport.backToRegister', 'Back to register')}>
              <Icon name="back" />
              {t('closingReport.backToRegister', 'Back to register')}
            </Button>
          </div>
          <h1 className="text-page-title font-semibold tracking-tight text-foreground">
            {t('closingReport.title', 'Issue closing-time report')}
          </h1>
          <p className="text-control text-muted-foreground mt-1">
            {t('closingReport.subtitle', 'Average and median time to close issues by department, highlighting where site issues stall.')}
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <Card>
        <CardPad className="flex flex-wrap items-end gap-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-control font-medium text-muted-foreground mr-1">
              {t('closingReport.dateRange', 'Date range')}:
            </span>
            <div className="inline-flex rounded-control border border-border p-0.5 bg-muted/40">
              {(['30d', '90d', 'ytd', 'all', 'custom'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreset(p)}
                  className={`px-3 py-1 text-control font-medium rounded-sm transition-colors ${
                    preset === p
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  data-testid={`preset-${p}`}
                >
                  {p === '30d' && t('closingReport.preset30d', 'Last 30 days')}
                  {p === '90d' && t('closingReport.preset90d', 'Last 90 days')}
                  {p === 'ytd' && t('closingReport.presetYtd', 'Year to date')}
                  {p === 'all' && t('closingReport.presetAll', 'All time')}
                  {p === 'custom' && t('closingReport.presetCustom', 'Custom')}
                </button>
              ))}
            </div>
          </div>

          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <DateField
                id="custom-date-from"
                label={t('closingReport.from', 'From')}
                value={customFrom}
                onChange={setCustomFrom}
              />
              <DateField
                id="custom-date-to"
                label={t('closingReport.to', 'To')}
                value={customTo}
                onChange={setCustomTo}
              />
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <span className="text-control font-medium text-muted-foreground mr-1">
              {t('closingReport.grouping', 'Department grouping')}:
            </span>
            <SelectField
              id="report-grouping-mode"
              label={t('closingReport.grouping', 'Department grouping')}
              hideLabel
              value={groupingMode}
              onChange={(val) => setGroupingMode(val as 'type' | 'department_groups')}
              options={[
                { value: 'type', label: t('closingReport.groupByType', 'By issue type') },
                { value: 'department_groups', label: t('closingReport.groupByGroups', 'By department groups') },
              ]}
            />
          </div>
        </CardPad>
      </Card>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="closing-report-kpis">
        <Card>
          <CardPad className="p-4 space-y-1">
            <span className="text-control text-muted-foreground">
              {t('closingReport.cards.totalIssues', 'Total issues')}
            </span>
            <div className="text-metric font-semibold text-foreground">
              {summary.totalIssues}
            </div>
          </CardPad>
        </Card>

        <Card>
          <CardPad className="p-4 space-y-1">
            <span className="text-control text-muted-foreground">
              {t('closingReport.cards.closedIssues', 'Closed issues')}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-metric font-semibold text-foreground">
                {summary.closedIssues}
              </span>
              <span className="text-control text-muted-foreground">
                ({t('closingReport.cards.closedRate', '{{percent}}% of total', { percent: summary.closedPercent })})
              </span>
            </div>
          </CardPad>
        </Card>

        <Card>
          <CardPad className="p-4 space-y-1">
            <span className="text-control text-muted-foreground">
              {t('closingReport.cards.avgClosingTime', 'Avg time to close')}
            </span>
            <div className="text-metric font-semibold text-foreground">
              {formatClosingDuration(summary.overallAvgHours, t)}
            </div>
          </CardPad>
        </Card>

        <Card className={summary.overdueIssues > 0 ? 'border-warning/50' : ''}>
          <CardPad className="p-4 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-control text-muted-foreground">
                {t('closingReport.cards.stalledIssues', 'Stalled issues')}
              </span>
              {summary.overdueIssues > 0 && (
                <StatusPill variant="warn">{summary.overdueIssues}</StatusPill>
              )}
            </div>
            <div className="text-metric font-semibold text-foreground">
              {summary.overdueIssues}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('closingReport.cards.stalledSub', 'Overdue and open')}
            </p>
          </CardPad>
        </Card>
      </div>

      {/* Data Table */}
      {/* A query that never fires stays `pending` forever: only show the skeleton while a read is in flight. */}
      {reportQuery.isPending && reportQuery.fetchStatus !== 'idle' ? (
        <ListState variant="loading" shape="table" rows={5} columns={6} />
      ) : reportQuery.isPending ? (
        <Card>
          <CardPad className="text-center py-10 space-y-2" data-testid="closing-report-not-loaded">
            <h3 className="text-base font-semibold">
              {t('closingReport.notLoaded.title', 'The report cannot be shown')}
            </h3>
            <p className="text-control text-muted-foreground max-w-sm mx-auto">
              {t('closingReport.notLoaded.sub', 'Your role cannot view this report. Ask an administrator for access.')}
            </p>
          </CardPad>
        </Card>
      ) : reportQuery.isError ? (
        <ListState
          variant="error"
          title={t('error.title', "Couldn't load report")}
          sub={t('error.sub', 'The request failed. Check your connection and try again.')}
          onRetry={() => reportQuery.refetch()}
        />
      ) : rows.length === 0 ? (
        <Card>
          <CardPad className="text-center py-10 space-y-2">
            <Icon name="search" className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="text-base font-semibold">
              {t('closingReport.empty.title', 'No issue data in this period')}
            </h3>
            <p className="text-control text-muted-foreground max-w-sm mx-auto">
              {t('closingReport.empty.sub', 'Try expanding the date range or selecting another department grouping.')}
            </p>
          </CardPad>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.department}
          tableId="closing-time-report-table"
        />
      )}

      {/* Effective working hours of one work order per day, beside the closing time (same range, same gate) */}
      <EffectiveHoursPanel from={dateRange.from} to={dateRange.to} />
    </div>
  );
};

export default ClosingTimeReport;
